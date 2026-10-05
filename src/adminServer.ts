import fs from 'fs';
import path from 'path';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { Bot, InputFile, InlineKeyboard } from 'grammy';
import { prisma } from './db';
import { UPLOADS_DIR, proofPath, proofUrl } from './uploads';
import { GameRooms } from './game/GameRooms';
import { config } from './config';

const upload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
        filename: (_req, file, cb) => {
            const safe = file.originalname.toLowerCase().replace(/[^a-z0-9.\-_]/g, '_');
            cb(null, `dep-${Date.now()}-${Math.round(Math.random() * 1e6)}-${safe}`);
        }
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const ok = /^image\/(jpeg|jpg|png|webp|gif)$/.test(file.mimetype) || file.mimetype === 'application/pdf';
        if (ok) cb(null, true);
        else cb(new Error('Only image (JPG, PNG, WEBP, GIF) or PDF files are allowed.') as any, false);
    }
});

export function startAdminServer(gameRooms: GameRooms, bot: Bot) {
    const app = express();
    app.use(cors());
    app.use(express.json());

    async function notifyAdminNewRequest(id: number, type: string, amount: number, userId: bigint, proof?: string | null, accountText?: string) {
        try {
            const u = await prisma.user.findUnique({ where: { id: userId } });
            const icon = type === 'deposit' ? '💳 DEPOSIT' : '⬆️ WITHDRAW';
            const text =
                `🔔 New **${icon}** request **#${id}**\n\n` +
                `👤 ${u?.firstName || 'Player'} (@\`${u?.username || id}\`)\n` +
                `💰 Amount: *${amount} Birr*\n` +
                (accountText ? `🏦 Paid to: *${accountText}*\n` : '') +
                `\nRun /requests to approve or reject.`;

            const url = proof ? proofUrl(proof) : null;
            if (type === 'deposit' && proof) {
                try {
                    const file = fs.readFileSync(proofPath(proof));
                    await bot.api.sendPhoto(Number(config.ADMIN_USER_ID), new InputFile(file),
                        { caption: text, parse_mode: 'Markdown' });
                    return;
                } catch (e) { console.error('sendProofPhoto failed', e); }
            }
            await bot.api.sendMessage(Number(config.ADMIN_USER_ID),
                proof && type === 'deposit' ? `${text}\n📎 Proof: ${url}` : text,
                { parse_mode: 'Markdown' });
        } catch (e) { console.error('notifyAdminNewRequest failed', e); }
    }

    // Skip ngrok's browser warning page for all requests
    app.use((req, res, next) => {
        res.setHeader('ngrok-skip-browser-warning', '1');
        next();
    });
    app.use((req, res, next) => {
        res.setHeader('ngrok-skip-browser-warning', '1');
        next();
    });
    
    // Serve static files from public directory
    app.use(express.static(path.join(__dirname, 'public'), {
        setHeaders: (res, filePath) => {
            if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
                res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
            }
        }
    }));

    // Serve uploaded deposit proofs
    app.use('/uploads', express.static(UPLOADS_DIR, {
        setHeaders: (res) => {
            res.setHeader('Cache-Control', 'public, max-age=3600');
        }
    }));

    
    // Admin stats
    app.get('/api/stats', async (req, res) => {
        const usersCount = await prisma.user.count();
        const users = await prisma.user.findMany();
        const totalBalance = users.reduce((acc, u) => acc + u.balance.toNumber(), 0);
        const admin = gameRooms.getAdminStats();
        
        res.json({
            users: usersCount,
            balance: totalBalance,
            activePlayers: admin.activePlayers,
            gameState: admin.gameState,
            pot: admin.pot,
            drawnCount: admin.drawnCount
        });
    });
    
    app.get('/api/users', async (req, res) => {
        const users = await prisma.user.findMany({
            orderBy: { balance: 'desc' },
            take: 50,
            include: { _count: { select: { referrals: true } } }
        });
        
        // Convert BigInt and Decimal to standard JSON types
        const safeUsers = users.map(u => ({
            id: u.id.toString(),
            username: u.username,
            firstName: u.firstName,
            lastName: u.lastName,
            balance: u.balance.toNumber(),
            referrals: u._count.referrals
        }));
        
        res.json(safeUsers);
    });
    
    // Player game state (polled by game.html)
    app.get('/api/game-state/:userId', async (req, res) => {
        const userId = BigInt(req.params.userId);
        const fee = parseInt(req.query.bet as string, 10) > 0 ? parseInt(req.query.bet as string, 10) : 10;
        const room = parseInt(req.query.room as string, 10) > 0 ? parseInt(req.query.room as string, 10) : 1;
        const gameManager = gameRooms.findPlayer(userId) || gameRooms.getRoom(fee, room);
        const player = gameManager.players.find(p => p.userId === userId);
        if (player) gameManager.touch(userId);
        
        if (!player) {
            return res.json({
                inGame: false,
                callerVoice: gameRooms.getCallerVoice(),
                gameState: gameManager.state,
                drawnNumbers: Array.from(gameManager.drawnNumbers),
                lastDrawn: Array.from(gameManager.drawnNumbers).at(-1) ?? null,
                winner: (gameManager.state === 'WAITING' && gameManager.currentWinner) ? gameManager.currentWinner : null,
                winners: (gameManager.state === 'WAITING' && gameManager.currentWinners.length > 0) ? gameManager.currentWinners : [],
                pot: gameManager.getPot(),
                playerCount: gameManager.players.length,
                lobbyCountdown: gameManager.lobbyCountdown
            });
        }

        const cardsData = (player.cards && player.cards.length > 0)
            ? player.cards.map(c => ({
                boardNumber: c.boardNumber,
                ticket: c.ticket,
                daubed: Array.from(c.daubed),
                isBlocked: Boolean(c.isBlocked || player.isBlocked)
            }))
            : [{
                boardNumber: player.boardNumber ?? 0,
                ticket: player.ticket,
                daubed: Array.from(player.daubed),
                isBlocked: Boolean(player.isBlocked)
            }];
        const boardNumbers = cardsData.map(c => c.boardNumber);
        
        res.json({
            inGame: true,
            callerVoice: gameRooms.getCallerVoice(),
            gameState: gameManager.state,
            ticket: player.ticket,
            boardNumber: player.boardNumber ?? null,
            cards: cardsData,
            boardNumbers: boardNumbers,
            fee: player.fee,
            daubed: Array.from(player.daubed),
            isBlocked: Boolean(player.isBlocked),
            drawnNumbers: Array.from(gameManager.drawnNumbers),
            lastDrawn: Array.from(gameManager.drawnNumbers).at(-1) ?? null,
            lobbyCountdown: gameManager.lobbyCountdown,
            playerCount: gameManager.players.length,
            pot: gameManager.getPot(),
            gameId: gameManager.gameId,
            winner: (gameManager.state === 'WAITING' && gameManager.currentWinner) ? gameManager.currentWinner : null,
            winners: (gameManager.state === 'WAITING' && gameManager.currentWinners.length > 0) ? gameManager.currentWinners : []
        });
    });

    // Lobby data with real stats (balance, bonus, tiers, winners, status)
    app.get('/api/lobby/:userId', async (req, res) => {
        let balance = 0;
        let bonus = 0;
        try {
            const user = await prisma.user.findUnique({ where: { id: BigInt(req.params.userId) } });
            balance = user ? user.balance.toNumber() : 0;
            bonus = user ? user.bonus.toNumber() : 0;
        } catch (e) {}

        const stats = gameRooms.getLobbyStats();

        // Which boards are taken by the current user
        let myBoards: number[] = [];
        try {
            const gameManager = gameRooms.findPlayer(BigInt(req.params.userId));
            if (gameManager) {
                const player = gameManager.players.find(p => p.userId === BigInt(req.params.userId));
                if (player) {
                    if (player.cards && player.cards.length > 0) {
                        myBoards = player.cards.map(c => c.boardNumber);
                    } else if (player.boardNumber !== undefined) {
                        myBoards = [player.boardNumber];
                    }
                }
            }
        } catch (e) {}

        res.json({
            balance,
            bonus,
            game: stats,
            myBoards
        });
    });

    // Player game history (polled by history.html)
    app.get('/api/history/:userId', async (req, res) => {
        try {
            const history = await prisma.gameHistory.findMany({
                where: { userId: BigInt(req.params.userId) },
                orderBy: { createdAt: 'desc' },
                take: 50
            });
            res.json(history.map(h => ({
                id: h.id,
                gameType: h.gameType,
                bet: h.bet ? h.bet.toNumber() : 0,
                payout: h.payout ? h.payout.toNumber() : 0,
                result: h.result,
                createdAt: h.createdAt
            })));
        } catch (e) {
            res.json([]);
        }
    });

    // Player profile (polled by profile.html)
    app.get('/api/profile/:userId', async (req, res) => {
        try {
            const user = await prisma.user.findUnique({
                where: { id: BigInt(req.params.userId) },
                include: { _count: { select: { referrals: true } } }
            });
            if (!user) return res.status(404).json({ error: 'User not found' });
            const balanceNum = user.balance.toNumber();
            const bonusNum = user.bonus.toNumber();
            const totalBalance = balanceNum + bonusNum;
            res.json({
                id: user.id.toString(),
                username: user.username,
                firstName: user.firstName,
                lastName: user.lastName,
                phone: user.phone,
                balance: balanceNum,
                bonus: bonusNum,
                totalBalance,
                referredBy: user.referredById ? user.referredById.toString() : null,
                referrals: user._count.referrals,
                createdAt: user.createdAt,
                user: {
                    id: user.id.toString(),
                    username: user.username,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    phone: user.phone,
                    balance: balanceNum,
                    bonus: bonusNum,
                    totalBalance
                }
            });
        } catch (e) {
            res.status(500).json({ error: 'Failed to load profile' });
        }
    });

    // Board selection status for a specific room (polled by boards.html)
    app.get('/api/boards', async (req, res) => {
        const fee = parseInt(req.query.bet as string, 10) > 0 ? parseInt(req.query.bet as string, 10) : 10;
        const room = parseInt(req.query.room as string, 10) > 0 ? parseInt(req.query.room as string, 10) : 1;
        const gameManager = gameRooms.getRoom(fee, room);
        res.json({
            boards: gameManager.getBoards(),
            players: gameManager.players.length,
            gameState: gameManager.state,
            pot: gameManager.getPot(),
            lobbyCountdown: gameManager.lobbyCountdown
        });
    });

    // Join a game by picking board numbers or a single boardNumber
    app.post('/api/join', async (req, res) => {
        const { userId, boardNumber, boards, bet, room } = req.body;
        if (!userId) {
            return res.status(400).json({ success: false, msg: 'userId is required.' });
        }
        const bList: number[] = Array.isArray(boards)
            ? boards.map(Number).filter(n => !isNaN(n))
            : (boardNumber !== undefined && boardNumber !== null && !isNaN(Number(boardNumber)))
                ? [Number(boardNumber)]
                : [];

        if (bList.length === 0 && !Array.isArray(boards)) {
            return res.status(400).json({ success: false, msg: 'boardNumber or boards is required.' });
        }

        const fee = parseInt(bet, 10) > 0 ? parseInt(bet, 10) : 10;
        const rNum = parseInt(room, 10) > 0 ? parseInt(room, 10) : 1;
        const gameManager = gameRooms.getRoom(fee, rNum);
        const result = await gameManager.selectBoards(BigInt(userId), bList, fee);
        res.json(result);
    });
    
    app.post('/api/daub', async (req, res) => {
        const { userId, number } = req.body;
        const gameManager = gameRooms.findPlayer(BigInt(userId));
        if (!gameManager) return res.json({ success: false, msg: 'You are not in a game.' });
        const result = await gameManager.daubNumber(BigInt(userId), number);
        res.json(result);
    });

    app.post('/api/claim', async (req, res) => {
        const { userId } = req.body;
        const gameManager = gameRooms.findPlayer(BigInt(userId));
        if (!gameManager) return res.json({ success: false, msg: 'You are not in a game.' });
        const result = await gameManager.claimBingo(BigInt(userId));
        res.json(result);
    });

    // Leave the bingo lobby before the game starts (releases the board, refunds the fee)
    app.post('/api/leave', async (req, res) => {
        const { userId, bet, room } = req.body;
        if (!userId) {
            return res.status(400).json({ success: false, msg: 'userId is required.' });
        }
        const fee = parseInt(bet, 10) > 0 ? parseInt(bet, 10) : 10;
        const rNum = parseInt(room, 10) > 0 ? parseInt(room, 10) : 1;
        const gameManager = gameRooms.findPlayer(BigInt(userId)) || gameRooms.getRoom(fee, rNum);
        const result = await gameManager.leaveGame(BigInt(userId));
        res.json(result);
    });
    
    app.post('/api/start-game', async (req, res) => {
        const fee = parseInt(req.body?.bet, 10) > 0 ? parseInt(req.body?.bet, 10) : 10;
        const room = parseInt(req.body?.room, 10) > 0 ? parseInt(req.body?.room, 10) : 1;
        const gameManager = gameRooms.getRoom(fee, room);
        if (gameManager.state === 'PLAYING') {
            return res.status(400).json({ error: 'Game already playing' });
        }
        if (gameManager.players.length < 1) {
            return res.status(400).json({ error: 'At least 1 player is needed to start the game' });
        }
        await gameManager.startGame();
        res.json({ success: true, gameState: gameManager.state });
    });

    // -------------------- DEPOSIT / WITHDRAW REQUESTS (manual, until Telebirr) --------------------

    // Create a deposit request (agent will approve manually)
    app.post('/api/request/deposit', (req, res) => {
        upload.single('proof')(req, res, async (err) => {
            if (err) {
                const msg = (err as any).code === 'LIMIT_FILE_SIZE'
                    ? 'The proof file is too large. Maximum size is 10 MB.'
                    : (err as any).message || 'Invalid proof file.';
                return res.status(400).json({ success: false, msg });
            }
            try {
                const { userId, amount, accountId } = req.body;
                if (!userId || !amount || isNaN(Number(amount)) || Number(amount) <= 0) {
                    return res.status(400).json({ success: false, msg: 'A valid amount is required.' });
                }
                const numeric = Number(amount);
                if (numeric < 10) {
                    return res.status(400).json({ success: false, msg: 'Minimum deposit is 10 Birr.' });
                }
                const proofFile = req.file;
                if (!proofFile) {
                    return res.status(400).json({ success: false, msg: 'Please attach a screenshot or receipt of your deposit as proof.' });
                }
                // Resolve the admin payout account the user chose (bank selection)
                let account: { id: number; bankName: string; accountNumber: string; isActive: boolean } | null = null;
                if (accountId) {
                    account = await prisma.paymentAccount.findUnique({
                        where: { id: parseInt(String(accountId), 10) }
                    });
                    if (!account || !account.isActive) {
                        return res.status(400).json({ success: false, msg: 'The selected account is no longer available. Please pick a valid bank.' });
                    }
                }
                const existing = await prisma.transactionRequest.findFirst({
                    where: { userId: BigInt(userId), type: 'deposit', status: 'PENDING' }
                });
                if (existing) {
                    return res.status(400).json({ success: false, msg: `You already have a pending deposit request #${existing.id}. Please wait for the admin to approve or reject it before submitting a new deposit.` });
                }
                const request = await prisma.transactionRequest.create({
                    data: {
                        userId: BigInt(userId), type: 'deposit', amount: numeric, proof: proofFile.filename, status: 'PENDING',
                        accountId: account?.id ?? null,
                        bankName: account ? account.bankName : null
                    }
                });
                const accountText = account ? `${account.bankName} (${account.accountNumber})` : undefined;
                notifyAdminNewRequest(request.id, 'deposit', numeric, BigInt(userId), proofFile.filename, accountText);
                res.json({ success: true, msg: `Deposit request of ${numeric} Birr submitted with proof. Please wait for admin approval.`, requestId: request.id });
            } catch (e) {
                console.error('Create deposit request error:', e);
                res.status(500).json({ success: false, msg: 'Failed to create request.' });
            }
        });
    });

    // Create a withdraw request (agent will approve manually)
    app.post('/api/request/withdraw', async (req, res) => {
        const { userId, amount, phone, accountId, accountName } = req.body;
        if (!userId || !amount || isNaN(Number(amount)) || Number(amount) <= 0) {
            return res.status(400).json({ success: false, msg: 'A valid amount is required.' });
        }
        const numeric = Number(amount);
        if (numeric < 10) {
            return res.status(400).json({ success: false, msg: 'Minimum withdrawal is 10 Birr.' });
        }
        const acctStr = String(phone || '').trim();
        if (acctStr.length < 4) {
            return res.status(400).json({ success: false, msg: 'A valid account/phone number is required.' });
        }
        
        let targetBankName: string | null = null;
        if (accountId) {
            const acc = await prisma.paymentAccount.findUnique({ where: { id: parseInt(String(accountId), 10) } });
            if (acc) targetBankName = acc.bankName;
        }
        
        const finalPhone = accountName ? `${acctStr} (${String(accountName).trim()})` : acctStr;

        try {
            const existing = await prisma.transactionRequest.findFirst({
                where: { userId: BigInt(userId), type: 'withdraw', status: 'PENDING' }
            });
            if (existing) {
                return res.status(400).json({ success: false, msg: `You already have a pending withdrawal request #${existing.id}. Please wait for the admin to approve or reject it before submitting a new withdrawal.` });
            }
            const user = await prisma.user.findUnique({ where: { id: BigInt(userId) } });
            if (!user || user.balance.toNumber() < numeric) {
                return res.status(400).json({ success: false, msg: 'Insufficient balance for this withdrawal.' });
            }
            const request = await prisma.transactionRequest.create({
                data: {
                    userId: BigInt(userId),
                    type: 'withdraw',
                    amount: numeric,
                    phone: finalPhone,
                    status: 'PENDING',
                    accountId: accountId ? parseInt(String(accountId), 10) : null,
                    bankName: targetBankName
                }
            });
            notifyAdminNewRequest(request.id, 'withdraw', numeric, BigInt(userId), null, targetBankName ? `${targetBankName} - ${finalPhone}` : finalPhone);
            res.json({ success: true, msg: `Withdrawal request of ${numeric} Birr submitted. Admin will review and send the money to ${acctStr}.`, requestId: request.id });
        } catch (e) {
            console.error('Create withdraw request error:', e);
            res.status(500).json({ success: false, msg: 'Failed to create request.' });
        }
    });

    // -------------------- PAYMENT ACCOUNTS (bank selection) --------------------

    // Active payout accounts users can send money to (shown on the deposit page)
    app.get('/api/banks', async (_req, res) => {
        try {
            const accounts = await prisma.paymentAccount.findMany({
                where: { isActive: true },
                orderBy: { createdAt: 'asc' }
            });
            res.json(accounts.map(a => ({
                id: a.id,
                bankName: a.bankName,
                accountNumber: a.accountNumber,
                accountName: a.accountName
            })));
        } catch (e) {
            res.status(500).json({ error: 'Failed to load accounts' });
        }
    });

    // Admin: list all accounts (including inactive)
    app.get('/api/admin/banks', async (_req, res) => {
        try {
            const accounts = await prisma.paymentAccount.findMany({
                orderBy: { createdAt: 'desc' },
                include: { _count: { select: { requests: true } } }
            });
            res.json(accounts.map(a => ({
                id: a.id,
                bankName: a.bankName,
                accountNumber: a.accountNumber,
                accountName: a.accountName,
                isActive: a.isActive,
                requestCount: a._count.requests,
                createdAt: a.createdAt
            })));
        } catch (e) {
            res.status(500).json({ error: 'Failed to load accounts' });
        }
    });

    // Admin: add an account
    app.post('/api/admin/banks', async (req, res) => {
        const { bankName, accountNumber, accountName } = req.body;
        if (!bankName || !accountNumber) {
            return res.status(400).json({ success: false, msg: 'bankName and accountNumber are required.' });
        }
        try {
            const account = await prisma.paymentAccount.create({
                data: {
                    bankName: String(bankName).trim(),
                    accountNumber: String(accountNumber).trim(),
                    accountName: accountName ? String(accountName).trim() : null
                }
            });
            res.json({ success: true, account });
        } catch (e) {
            console.error('Add bank error:', e);
            res.status(500).json({ success: false, msg: 'Failed to add account.' });
        }
    });

    // Admin: deactivate an account
    app.delete('/api/admin/banks/:id', async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ success: false, msg: 'Invalid id.' });
        try {
            const account = await prisma.paymentAccount.findUnique({ where: { id } });
            if (!account) return res.status(404).json({ success: false, msg: 'Account not found.' });
            await prisma.paymentAccount.update({ where: { id }, data: { isActive: !account.isActive } });
            res.json({ success: true, msg: `Account #${id} ${account.isActive ? 'deactivated' : 'activated'}.` });
        } catch (e) {
            res.status(500).json({ success: false, msg: 'Failed to update account.' });
        }
    });

    // List current user's requests (wallet page)
    app.get('/api/requests/:userId', async (req, res) => {
        try {
            const requests = await prisma.transactionRequest.findMany({
                where: { userId: BigInt(req.params.userId) },
                orderBy: { createdAt: 'desc' },
                take: 20,
                include: { account: { select: { bankName: true, accountNumber: true } } }
            });
            res.json(requests.map(r => ({
                id: r.id,
                type: r.type,
                amount: r.amount.toNumber(),
                phone: r.phone,
                proof: r.proof,
                status: r.status,
                bankName: r.bankName,
                account: r.account ? `${r.account.bankName} (${r.account.accountNumber})` : null,
                createdAt: r.createdAt
            })));
        } catch (e) {
            res.json([]);
        }
    });

    // List all requests (admin)
    app.get('/api/requests', async (req, res) => {
        const status = req.query.status as string | undefined;
        const where = status ? { status } : {};
        try {
            const requests = await prisma.transactionRequest.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take: 100,
                include: { user: { select: { firstName: true, username: true, balance: true } }, account: { select: { bankName: true, accountNumber: true } } }
            });
            res.json(requests.map(r => ({
                id: r.id,
                userId: r.userId.toString(),
                name: r.user?.firstName || 'Player',
                username: r.user?.username ?? null,
                type: r.type,
                amount: r.amount.toNumber(),
                phone: r.phone,
                proof: r.proof,
                proofUrl: r.proof ? proofUrl(r.proof) : null,
                status: r.status,
                balance: r.user?.balance ? r.user.balance.toNumber() : 0,
                bankName: r.bankName,
                account: r.account ? `${r.account.bankName} (${r.account.accountNumber})` : null,
                createdAt: r.createdAt
            })));
        } catch (e) {
            res.status(500).json({ error: 'Failed to load requests' });
        }
    });

    // Approve a request (admin)
    app.post('/api/request/:id/approve', async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ success: false, msg: 'Invalid id.' });
        try {
            const request = await prisma.transactionRequest.findUnique({ where: { id } });
            if (!request) return res.status(404).json({ success: false, msg: 'Request not found.' });
            if (request.status !== 'PENDING') return res.status(400).json({ success: false, msg: 'Only pending requests can be approved.' });

            if (request.type === 'deposit') {
                await prisma.$transaction([
                    prisma.user.update({ where: { id: request.userId }, data: { balance: { increment: request.amount } } }),
                    prisma.transactionRequest.update({ where: { id }, data: { status: 'APPROVED' } })
                ]);
            } else {
                const user = await prisma.user.findUnique({ where: { id: request.userId } });
                if (!user || user.balance.toNumber() < request.amount.toNumber()) {
                    return res.status(400).json({ success: false, msg: 'User does not have enough balance for this withdrawal.' });
                }
                await prisma.$transaction([
                    prisma.user.update({ where: { id: request.userId }, data: { balance: { decrement: request.amount } } }),
                    prisma.transactionRequest.update({ where: { id }, data: { status: 'APPROVED' } })
                ]);
            }
            res.json({ success: true, msg: `${request.type} request #${id} approved.` });
        } catch (e) {
            res.status(500).json({ success: false, msg: 'Failed to approve request.' });
        }
    });

    // Reject a request (admin)
    app.post('/api/request/:id/reject', async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ success: false, msg: 'Invalid id.' });
        try {
            const request = await prisma.transactionRequest.findUnique({ where: { id } });
            if (!request) return res.status(404).json({ success: false, msg: 'Request not found.' });
            if (request.status !== 'PENDING') return res.status(400).json({ success: false, msg: 'Only pending requests can be rejected.' });

            await prisma.transactionRequest.update({ where: { id }, data: { status: 'REJECTED' } });
            res.json({ success: true, msg: `${request.type} request #${id} rejected.` });
        } catch (e) {
            res.status(500).json({ success: false, msg: 'Failed to reject request.' });
        }
    });


    // Admin dashboard stats (totals, growth, pending)
    app.get('/api/admin/stats', async (req, res) => {
        try {
            const now = new Date();
            const weekAgo = new Date(now.getTime() - 7 * 86400000);
            const twoWeeksAgo = new Date(now.getTime() - 14 * 86400000);

            const [users, newUsers, prevUsers, depAgg, wdrAgg, pendCount, allReq] = await Promise.all([
                prisma.user.count(),
                prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
                prisma.user.count({ where: { createdAt: { gte: twoWeeksAgo, lt: weekAgo } } }),
                prisma.transactionRequest.aggregate({
                    where: { type: 'deposit', status: 'APPROVED' },
                    _sum: { amount: true },
                    _count: true
                }),
                prisma.transactionRequest.aggregate({
                    where: { type: 'withdraw', status: 'APPROVED' },
                    _sum: { amount: true },
                    _count: true
                }),
                prisma.transactionRequest.count({ where: { status: 'PENDING' } }),
                prisma.transactionRequest.findMany({ select: { type: true, status: true } })
            ]);

            const totalDeposits = depAgg._sum.amount ? Number(depAgg._sum.amount) : 0;
            const totalWithdrawals = wdrAgg._sum.amount ? Number(wdrAgg._sum.amount) : 0;
            const net = totalDeposits - totalWithdrawals;

            const statusCounts = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
            for (const r of allReq) statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;

            const depStatus = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
            const wdrStatus = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
            for (const r of allReq) {
                if (r.type === 'deposit') depStatus[r.status] = (depStatus[r.status] || 0) + 1;
                else wdrStatus[r.status] = (wdrStatus[r.status] || 0) + 1;
            }

            // User growth rate: % increase vs previous 7 days (this week vs last week)
            const growthRate = prevUsers > 0 ? Math.round(((newUsers - prevUsers) / prevUsers) * 100) :
                (newUsers > 0 ? 100 : 0);

            const balAgg = await prisma.user.aggregate({ _sum: { balance: true } });
            const totalBalance = balAgg._sum.balance ? Number(balAgg._sum.balance) : 0;

            res.json({
                users, newUsers, prevUsers, growthRate,
                totalDeposits, totalWithdrawals, net, totalBalance,
                pendingCount: pendCount,
                depositsCount: depAgg._count, withdrawalsCount: wdrAgg._count,
                statusCounts, depStatus, wdrStatus
            });
        } catch (e) {
            console.error('Admin stats error:', e);
            res.status(500).json({ error: 'Failed to load stats.' });
        }
    });

    // Admin Broadcast API (send image + caption or text to all registered users)
    app.post('/api/admin/broadcast', async (req, res) => {
        const { imageUrl, caption, text } = req.body;
        const messageText = (caption || text || '').trim();

        if (!messageText && !imageUrl) {
            return res.status(400).json({ success: false, msg: 'Please provide text, a caption, or an image URL.' });
        }

        try {
            const users = await prisma.user.findMany({ select: { id: true } });
            let sent = 0;
            let failed = 0;

            for (const u of users) {
                try {
                    const userKb = new InlineKeyboard()
                        .webApp('🎮 ይጫወቱ', `${config.BINGO_APP_URL}/index.html?userId=${u.id.toString()}`).row()
                        .text('💰 ገንዘብ ማስገባት', 'menu_deposit').row();

                    if (config.CHANNEL_URL) userKb.url('📣 Channel', config.CHANNEL_URL);
                    if (config.SUPPORT_URL) userKb.url('💬 Support', config.SUPPORT_URL);

                    if (imageUrl) {
                        await bot.api.sendPhoto(Number(u.id), imageUrl.trim(), {
                            caption: messageText,
                            parse_mode: 'Markdown',
                            reply_markup: userKb
                        }).catch(async () => {
                            await bot.api.sendPhoto(Number(u.id), imageUrl.trim(), {
                                caption: messageText,
                                reply_markup: userKb
                            });
                        });
                    } else {
                        await bot.api.sendMessage(Number(u.id), messageText, {
                            parse_mode: 'Markdown',
                            reply_markup: userKb
                        }).catch(async () => {
                            await bot.api.sendMessage(Number(u.id), messageText, {
                                reply_markup: userKb
                            });
                        });
                    }
                    sent++;
                    await new Promise(r => setTimeout(r, 35));
                } catch (e) {
                    failed++;
                }
            }

            res.json({ success: true, sent, failed, totalUsers: users.length });
        } catch (e) {
            console.error('API broadcast error:', e);
            res.status(500).json({ success: false, msg: 'Broadcast failed.' });
        }
    });

    // Caller Voice Admin API
    app.get('/api/admin/voice', (_req, res) => {
        res.json({ success: true, voice: gameRooms.getCallerVoice() });
    });

    app.post('/api/admin/voice', (req, res) => {
        const { voice } = req.body || {};
        if (voice !== 'male' && voice !== 'female') {
            return res.status(400).json({ success: false, msg: 'Invalid voice option. Must be "male" or "female".' });
        }
        gameRooms.setCallerVoice(voice);
        console.log(`[Admin] Caller voice changed to "${voice}" by admin`);
        res.json({ success: true, voice: gameRooms.getCallerVoice() });
    });




    app.listen(Number(config.PORT), () => {
        console.log(`Admin server running on http://localhost:${config.PORT}`);
    });
}