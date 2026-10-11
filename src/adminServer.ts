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
import { isValidAdminToken, generateAdminToken, revokeAdminToken, verifyMasterPassword } from './auth';
import { adminLoginLimiter, financialLimiter, generalApiLimiter } from './rateLimiter';
import { requirePlayerOwnership, authenticateCaller } from './playerAuth';
import { getNewUserBonus, getReferralBonus, setBonusSettings } from './bonus';

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
        const ext = path.extname(file.originalname).toLowerCase();
        const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf'];
        const allowedMimes = /^image\/(jpeg|jpg|png|webp|gif)$/.test(file.mimetype) || file.mimetype === 'application/pdf';
        if (allowedExts.includes(ext) && allowedMimes) cb(null, true);
        else cb(new Error('Only valid image (JPG, PNG, WEBP, GIF) or PDF files are allowed.') as any, false);
    }
});

export function startAdminServer(gameRooms: GameRooms, bot: Bot) {
    const app = express();
    app.use(cors());
    app.use(express.json());
    app.use('/api', generalApiLimiter);

    async function notifyAdminNewRequest(id: number, type: string, amount: number, userId: bigint, proof?: string | null, accountText?: string, accountId?: number | null) {
        try {
            const u = await prisma.user.findUnique({ where: { id: userId } });
            const icon = type === 'deposit' ? '💳 DEPOSIT' : '⬆️ WITHDRAW';
            const text =
                `🔔 New **${icon}** request **#${id}**\n\n` +
                `👤 ${u?.firstName || 'Player'} (@\`${u?.username || id}\`)\n` +
                `💰 Amount: *${amount} Birr*\n` +
                (accountText ? `🏦 Paid to: *${accountText}*\n` : '') +
                `\nTap below to approve or reject:`;

            const replyMarkup = new InlineKeyboard()
                .text('✅ Approve', `req_approve_${id}`)
                .text('❌ Reject', `req_reject_${id}`);

            let targetAdminChatId: number | null = null;
            let targetAdminProf: any = null;
            if (type === 'withdraw') {
                const dutyWithdrawalAdmin = await prisma.adminProfile.findFirst({
                    where: { isWithdrawalAdmin: true, isActive: true }
                });
                if (dutyWithdrawalAdmin?.userId) {
                    targetAdminChatId = Number(dutyWithdrawalAdmin.userId);
                }
            } else {
                if (accountId) {
                    const acct = await prisma.paymentAccount.findUnique({
                        where: { id: accountId },
                        include: { admin: true }
                    });
                    if (acct?.admin?.userId && acct.admin.isActive) {
                        targetAdminChatId = Number(acct.admin.userId);
                        targetAdminProf = acct.admin;
                    }
                }
                if (!targetAdminChatId && u?.assignedAdminId) {
                    const adminProf = await prisma.adminProfile.findUnique({
                        where: { id: u.assignedAdminId }
                    });
                    if (adminProf?.userId && adminProf.isActive) {
                        targetAdminChatId = Number(adminProf.userId);
                        targetAdminProf = adminProf;
                    }
                }
            }

            const masterChatId = Number(config.ADMIN_USER_ID);
            const targetChatIds = new Set<number>();
            if (!isNaN(masterChatId) && masterChatId > 0) targetChatIds.add(masterChatId);
            if (targetAdminChatId && !isNaN(targetAdminChatId) && targetAdminChatId > 0) targetChatIds.add(targetAdminChatId);

            const url = proof ? proofUrl(proof) : null;
            for (const chatId of targetChatIds) {
                try {
                    let msgText = text;
                    if (chatId === targetAdminChatId && targetAdminProf && type === 'deposit') {
                        const cur = targetAdminProf.collectedDeposits ? Number(targetAdminProf.collectedDeposits) : 0;
                        const lim = targetAdminProf.depositLimit ? Number(targetAdminProf.depositLimit) : 3000;
                        if (cur >= lim) {
                            msgText += `\n\n⚠️ *APPROVAL PAUSED:* You have approved ${cur.toFixed(0)}/${lim.toFixed(0)} Birr (Limit Reached). Remit collected funds to Super Admin to enable approval.`;
                        }
                    }

                    if (type === 'deposit' && proof) {
                        try {
                            const file = fs.readFileSync(proofPath(proof));
                            await bot.api.sendPhoto(chatId, new InputFile(file), {
                                caption: msgText,
                                parse_mode: 'Markdown',
                                reply_markup: replyMarkup
                            });
                            continue;
                        } catch (e) {
                            console.error(`sendProofPhoto to ${chatId} failed:`, e);
                        }
                    }
                    await bot.api.sendMessage(
                        chatId,
                        proof && type === 'deposit' ? `${msgText}\n📎 Proof: ${url}` : msgText,
                        { parse_mode: 'Markdown', reply_markup: replyMarkup }
                    );
                } catch (sendErr) {
                    console.error(`notifyAdminNewRequest delivery to ${chatId} failed:`, sendErr);
                }
            }
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

    
    // Admin Auth Middleware
    function adminAuthMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
        const authHeader = req.headers['authorization'];
        const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
        const queryToken = typeof req.query.token === 'string' ? req.query.token : null;
        const customToken = req.headers['x-admin-token'] as string | undefined;

        const token = bearerToken || queryToken || customToken;

        if (isValidAdminToken(token)) {
            return next();
        }

        return res.status(401).json({
            success: false,
            error: 'Unauthorized: Admin authentication required',
            loginRequired: true
        });
    }

    // Admin Auth Endpoints
    app.post('/api/admin/login', adminLoginLimiter, (req, res) => {
        const { password } = req.body || {};
        if (!password || !verifyMasterPassword(password)) {
            return res.status(401).json({ success: false, msg: 'Invalid admin password.' });
        }
        const token = generateAdminToken();
        res.json({ success: true, token, msg: 'Login successful.' });
    });

    app.get('/api/admin/verify', (req, res) => {
        const authHeader = req.headers['authorization'];
        const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
        const queryToken = typeof req.query.token === 'string' ? req.query.token : null;
        const token = bearerToken || queryToken || (req.headers['x-admin-token'] as string);

        if (isValidAdminToken(token)) {
            return res.json({ success: true, authenticated: true });
        }
        return res.status(401).json({ success: false, authenticated: false });
    });

    app.post('/api/admin/logout', (req, res) => {
        const authHeader = req.headers['authorization'];
        const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
        const token = bearerToken || (req.headers['x-admin-token'] as string);
        if (token) revokeAdminToken(token);
        res.json({ success: true, msg: 'Logged out successfully.' });
    });

    // Admin stats (Protected)
    app.get('/api/stats', adminAuthMiddleware, async (req, res) => {
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

    // Detailed Active Players list across all rooms (Protected)
    app.get('/api/admin/active-players', adminAuthMiddleware, async (_req, res) => {
        try {
            const rawList = gameRooms.getActivePlayersDetails();
            if (rawList.length === 0) {
                return res.json({ total: 0, players: [] });
            }
            const userIds = Array.from(new Set(rawList.map(r => BigInt(r.player.userId))));
            const dbUsers = await prisma.user.findMany({
                where: { id: { in: userIds } },
                select: { id: true, firstName: true, username: true, phone: true, balance: true, bonus: true }
            });
            const userMap = new Map(dbUsers.map(u => [u.id.toString(), u]));

            const enriched = rawList.map(item => {
                const dbU = userMap.get(item.player.userId);
                const idleSecs = Math.max(0, Math.floor((Date.now() - item.player.lastSeen) / 1000));
                return {
                    ...item,
                    player: {
                        ...item.player,
                        firstName: dbU?.firstName || item.player.firstName || 'Player',
                        username: dbU?.username || item.player.username || null,
                        phone: dbU?.phone || null,
                        balance: dbU ? dbU.balance.toNumber() : 0,
                        bonus: dbU ? dbU.bonus.toNumber() : 0,
                        idleSeconds: idleSecs,
                        isBot: !!item.player.isBot
                    }
                };
            });

            res.json({ total: enriched.length, players: enriched });
        } catch (e: any) {
            console.error('Fetch active players error:', e);
            res.status(500).json({ error: e?.message || 'Failed to fetch active players' });
        }
    });

    // Kick/evict a player from a room lobby (Protected)
    app.post('/api/admin/kick-player', adminAuthMiddleware, async (req, res) => {
        try {
            const { userId, fee, room } = req.body;
            if (!userId) {
                return res.status(400).json({ success: false, msg: 'userId is required' });
            }
            const gm = gameRooms.findPlayer(BigInt(userId)) || gameRooms.getRoom(Number(fee || 10), Number(room || 1));
            const result = await gm.leaveGame(BigInt(userId));
            res.json(result);
        } catch (e: any) {
            console.error('Kick player error:', e);
            res.status(500).json({ success: false, msg: e?.message || 'Failed to kick player' });
        }
    });
    
    // Users management list (Protected)
    const handleGetUsers = async (req: any, res: any) => {
        try {
            const search = req.query.search ? String(req.query.search).trim() : '';
            const where: any = {};
            if (search) {
                const searchLower = search.toLowerCase();
                const numericId = /^\d+$/.test(search) ? BigInt(search) : null;
                where.OR = [
                    { username: { contains: search, mode: 'insensitive' } },
                    { firstName: { contains: search, mode: 'insensitive' } },
                    { phone: { contains: search } }
                ];
                if (numericId !== null) {
                    where.OR.push({ id: numericId });
                }
            }

            const users = await prisma.user.findMany({
                where,
                orderBy: { balance: 'desc' },
                take: 150,
                include: { _count: { select: { referrals: true } } }
            });
            
            const safeUsers = users.map(u => ({
                id: u.id.toString(),
                username: u.username,
                firstName: u.firstName,
                lastName: u.lastName,
                phone: u.phone,
                balance: u.balance.toNumber(),
                bonus: u.bonus.toNumber(),
                banned: u.banned,
                gamesPlayed: u.gamesPlayed,
                wins: u.wins,
                referrals: u._count.referrals,
                createdAt: u.createdAt
            }));
            
            res.json(safeUsers);
        } catch (e: any) {
            console.error('Fetch users error:', e);
            res.status(500).json({ error: 'Failed to fetch users' });
        }
    };
    app.get('/api/users', adminAuthMiddleware, handleGetUsers);
    app.get('/api/admin/users', adminAuthMiddleware, handleGetUsers);

    // Edit user (Protected)
    app.put('/api/admin/user/:userId', adminAuthMiddleware, async (req, res) => {
        const userId = BigInt(req.params.userId);
        const { balance, bonus, phone, username, firstName, banned } = req.body;
        try {
            const data: any = {};
            if (balance !== undefined && !isNaN(Number(balance))) data.balance = Number(balance);
            if (bonus !== undefined && !isNaN(Number(bonus))) data.bonus = Number(bonus);
            if (phone !== undefined) data.phone = phone ? String(phone).trim() : null;
            if (username !== undefined) data.username = username ? String(username).trim().replace(/^@+/, '') : null;
            if (firstName !== undefined) data.firstName = firstName ? String(firstName).trim() : null;
            if (banned !== undefined) data.banned = Boolean(banned);

            const updated = await prisma.user.update({
                where: { id: userId },
                data
            });

            res.json({
                success: true,
                user: {
                    id: updated.id.toString(),
                    username: updated.username,
                    firstName: updated.firstName,
                    lastName: updated.lastName,
                    phone: updated.phone,
                    balance: updated.balance.toNumber(),
                    bonus: updated.bonus.toNumber(),
                    banned: updated.banned
                }
            });
        } catch (e: any) {
            console.error('Update user error:', e);
            res.status(500).json({ success: false, msg: e?.message || 'Failed to update user' });
        }
    });

    // Delete user (Protected)
    app.delete('/api/admin/user/:userId', adminAuthMiddleware, async (req, res) => {
        const userId = BigInt(req.params.userId);
        try {
            const user = await prisma.user.findUnique({ where: { id: userId } });
            if (!user) {
                return res.status(404).json({ success: false, msg: 'User not found' });
            }

            await prisma.user.delete({ where: { id: userId } });
            res.json({ success: true, msg: `User ${userId} deleted successfully.` });
        } catch (e: any) {
            console.error('Delete user error:', e);
            res.status(500).json({ success: false, msg: e?.message || 'Failed to delete user' });
        }
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
                boardCount: gameManager.getTotalBoards(),
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
            boardCount: gameManager.getTotalBoards(),
            pot: gameManager.getPot(),
            gameId: gameManager.gameId,
            winner: (gameManager.state === 'WAITING' && gameManager.currentWinner) ? gameManager.currentWinner : null,
            winners: (gameManager.state === 'WAITING' && gameManager.currentWinners.length > 0) ? gameManager.currentWinners : [],
            winningNumber: (gameManager.state === 'WAITING' && gameManager.currentWinner?.winningNumber) ? gameManager.currentWinner.winningNumber : (Array.from(gameManager.drawnNumbers).at(-1) ?? null)
        });
    });

    // Real-Time Event Stream (SSE) for zero-latency ball calls, countdowns, and winners
    app.get('/api/game-stream/:userId', (req, res) => {
        const userId = BigInt(req.params.userId);
        const fee = parseInt(req.query.bet as string, 10) > 0 ? parseInt(req.query.bet as string, 10) : 10;
        const room = parseInt(req.query.room as string, 10) > 0 ? parseInt(req.query.room as string, 10) : 1;
        const gameManager = gameRooms.findPlayer(userId) || gameRooms.getRoom(fee, room);
        const player = gameManager.players.find(p => p.userId === userId);
        if (player) gameManager.touch(userId);

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        if (typeof res.flushHeaders === 'function') res.flushHeaders();

        const cardsData = (player && player.cards && player.cards.length > 0)
            ? player.cards.map(c => ({
                boardNumber: c.boardNumber,
                ticket: c.ticket,
                daubed: Array.from(c.daubed),
                isBlocked: Boolean(c.isBlocked || player.isBlocked)
            }))
            : player ? [{
                boardNumber: player.boardNumber ?? 0,
                ticket: player.ticket,
                daubed: Array.from(player.daubed),
                isBlocked: Boolean(player.isBlocked)
            }] : [];

        const initialSnapshot = {
            inGame: Boolean(player),
            callerVoice: gameRooms.getCallerVoice(),
            gameState: gameManager.state,
            ticket: player?.ticket || null,
            boardNumber: player?.boardNumber ?? null,
            cards: cardsData,
            boardNumbers: cardsData.map(c => c.boardNumber),
            fee: player?.fee || fee,
            daubed: player ? Array.from(player.daubed) : [],
            isBlocked: Boolean(player?.isBlocked),
            drawnNumbers: Array.from(gameManager.drawnNumbers),
            lastDrawn: Array.from(gameManager.drawnNumbers).at(-1) ?? null,
            lobbyCountdown: gameManager.lobbyCountdown,
            playerCount: gameManager.players.length,
            pot: gameManager.getPot(),
            gameId: gameManager.gameId,
            winner: (gameManager.state === 'WAITING' && gameManager.currentWinner) ? gameManager.currentWinner : null,
            winners: (gameManager.state === 'WAITING' && gameManager.currentWinners.length > 0) ? gameManager.currentWinners : [],
            winningNumber: (gameManager.state === 'WAITING' && gameManager.currentWinner?.winningNumber) ? gameManager.currentWinner.winningNumber : (Array.from(gameManager.drawnNumbers).at(-1) ?? null)
        };

        gameManager.addSSEClient(userId, res, initialSnapshot);
    });

    // Lobby data with real stats (balance, bonus, tiers, winners, status)
    app.get('/api/lobby/:userId', async (req, res) => {
        let balance = 0;
        let bonus = 0;
        let withdrawableBalance = 0;
        try {
            const user = await prisma.user.findUnique({ where: { id: BigInt(req.params.userId) } });
            balance = user ? user.balance.toNumber() : 0;
            bonus = user ? user.bonus.toNumber() : 0;
            withdrawableBalance = user?.withdrawableBalance ? user.withdrawableBalance.toNumber() : 0;
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
            withdrawableBalance,
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
    app.get('/api/profile/:userId', requirePlayerOwnership(req => req.params.userId), async (req, res) => {
        try {
            const user = await prisma.user.findUnique({
                where: { id: BigInt(req.params.userId) },
                include: { _count: { select: { referrals: true } } }
            });
            if (!user) return res.status(404).json({ error: 'User not found' });
            const balanceNum = user.balance.toNumber();
            const bonusNum = user.bonus.toNumber();
            const withdrawableNum = user.withdrawableBalance ? user.withdrawableBalance.toNumber() : 0;
            const totalBalance = balanceNum + bonusNum;
            res.json({
                id: user.id.toString(),
                username: user.username,
                firstName: user.firstName,
                lastName: user.lastName,
                phone: user.phone,
                balance: balanceNum,
                bonus: bonusNum,
                withdrawableBalance: withdrawableNum,
                totalBalance,
                referredBy: user.referredById ? user.referredById.toString() : null,
                referrals: user._count.referrals,
                referralLink: `https://t.me/PlayMyBingoBot?start=${user.id}`,
                createdAt: user.createdAt,
                user: {
                    id: user.id.toString(),
                    username: user.username,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    phone: user.phone,
                    balance: balanceNum,
                    bonus: bonusNum,
                    withdrawableBalance: withdrawableNum,
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
            boardCount: gameManager.getTotalBoards(),
            gameState: gameManager.state,
            pot: gameManager.getPot(),
            lobbyCountdown: gameManager.lobbyCountdown
        });
    });

    // Join a game by picking board numbers or a single boardNumber
    app.post('/api/join', requirePlayerOwnership(req => req.body?.userId), async (req, res) => {
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
    
    app.post('/api/daub', requirePlayerOwnership(req => req.body?.userId), async (req, res) => {
        const { userId, number } = req.body;
        const gameManager = gameRooms.findPlayer(BigInt(userId));
        if (!gameManager) return res.json({ success: false, msg: 'You are not in a game.' });
        const result = await gameManager.daubNumber(BigInt(userId), number);
        res.json(result);
    });

    app.post('/api/claim', requirePlayerOwnership(req => req.body?.userId), async (req, res) => {
        const { userId } = req.body;
        const gameManager = gameRooms.findPlayer(BigInt(userId));
        if (!gameManager) return res.json({ success: false, msg: 'You are not in a game.' });
        const result = await gameManager.claimBingo(BigInt(userId));
        res.json(result);
    });

    // Leave the bingo lobby before the game starts (releases the board, refunds the fee)
    app.post('/api/leave', requirePlayerOwnership(req => req.body?.userId), async (req, res) => {
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
    
    app.post('/api/start-game', adminAuthMiddleware, async (req, res) => {
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
    app.post('/api/request/deposit', financialLimiter, (req, res) => {
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
                // Resolve assigned admin for deposit
                let assignedAdminId: number | null = null;
                if (account?.adminId) {
                    const adm = await prisma.adminProfile.findUnique({ where: { id: account.adminId } });
                    if (adm?.isActive) {
                        assignedAdminId = adm.id;
                    }
                }
                if (!assignedAdminId) {
                    const reqUser = await prisma.user.findUnique({
                        where: { id: BigInt(userId) },
                        select: { assignedAdminId: true }
                    });
                    if (reqUser?.assignedAdminId) {
                        const adm = await prisma.adminProfile.findUnique({ where: { id: reqUser.assignedAdminId } });
                        if (adm?.isActive) {
                            assignedAdminId = adm.id;
                        }
                    }
                }

                const request = await prisma.transactionRequest.create({
                    data: {
                        userId: BigInt(userId),
                        type: 'deposit',
                        amount: numeric,
                        proof: proofFile.filename,
                        status: 'PENDING',
                        accountId: account?.id ?? null,
                        bankName: account ? account.bankName : null,
                        assignedAdminId
                    }
                });
                const accountText = account ? `${account.bankName} (${account.accountNumber})` : undefined;
                notifyAdminNewRequest(request.id, 'deposit', numeric, BigInt(userId), proofFile.filename, accountText, account?.id);
                res.json({ success: true, msg: `Deposit request of ${numeric} Birr submitted with proof. Please wait for admin approval.`, requestId: request.id });
            } catch (e) {
                console.error('Create deposit request error:', e);
                res.status(500).json({ success: false, msg: 'Failed to create request.' });
            }
        });
    });

    // Create a withdraw request (agent will approve manually)
    app.post('/api/request/withdraw', financialLimiter, requirePlayerOwnership(req => req.body?.userId), async (req, res) => {
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
            const withdrawable = user.withdrawableBalance ? user.withdrawableBalance.toNumber() : 0;
            if (numeric > withdrawable) {
                return res.status(400).json({
                    success: false,
                    msg: `You can only withdraw game winnings (${withdrawable.toFixed(2)} Birr available). Deposited funds and bonuses must be played in the game.`
                });
            }
            let assignedAdminId: number | null = null;
            const dutyWithdrawalAdmin = await prisma.adminProfile.findFirst({
                where: { isWithdrawalAdmin: true, isActive: true }
            });
            if (dutyWithdrawalAdmin) {
                assignedAdminId = dutyWithdrawalAdmin.id;
            }

            const request = await prisma.transactionRequest.create({
                data: {
                    userId: BigInt(userId),
                    type: 'withdraw',
                    amount: numeric,
                    phone: finalPhone,
                    status: 'PENDING',
                    accountId: accountId ? parseInt(String(accountId), 10) : null,
                    bankName: targetBankName,
                    assignedAdminId
                }
            });
            notifyAdminNewRequest(request.id, 'withdraw', numeric, BigInt(userId), null, targetBankName ? `${targetBankName} - ${finalPhone}` : finalPhone, accountId ? parseInt(String(accountId), 10) : null);
            res.json({ success: true, msg: `Withdrawal request of ${numeric} Birr submitted. Admin will review and send the money to ${acctStr}.`, requestId: request.id });
        } catch (e) {
            console.error('Create withdraw request error:', e);
            res.status(500).json({ success: false, msg: 'Failed to create request.' });
        }
    });

    // -------------------- PAYMENT ACCOUNTS (bank selection) --------------------

    // Active payout accounts users can send money to (scoped to user's assigned admin)
    app.get('/api/banks', async (req, res) => {
        try {
            const userIdParam = req.query.userId ? String(req.query.userId).trim() : null;
            let assignedAdminId: number | null = null;
            if (userIdParam) {
                try {
                    const u = await prisma.user.findUnique({
                        where: { id: BigInt(userIdParam) },
                        select: { assignedAdminId: true }
                    });
                    if (u?.assignedAdminId) {
                        assignedAdminId = u.assignedAdminId;
                    }
                } catch (err) {}
            }

            let accounts: any[] = [];
            if (assignedAdminId) {
                const adminProf = await prisma.adminProfile.findUnique({
                    where: { id: assignedAdminId }
                });
                // If assigned admin is ACTIVE, show their active payment accounts
                if (adminProf && adminProf.isActive) {
                    accounts = await prisma.paymentAccount.findMany({
                        where: { isActive: true, adminId: assignedAdminId },
                        orderBy: { createdAt: 'asc' }
                    });
                }
            }

            // Fallback: If player's assigned admin is inactive, has no active accounts, or player has no admin assigned,
            // fallback STRICTLY to Super Admin accounts (adminId: null)
            if (accounts.length === 0) {
                accounts = await prisma.paymentAccount.findMany({
                    where: { isActive: true, adminId: null },
                    orderBy: { createdAt: 'asc' }
                });
            }

            // Fallback safety: If Super Admin has no unassigned (adminId: null) accounts configured yet, show any active accounts
            if (accounts.length === 0) {
                accounts = await prisma.paymentAccount.findMany({
                    where: { isActive: true },
                    orderBy: { createdAt: 'asc' }
                });
            }

            res.json(accounts.map(a => ({
                id: a.id,
                bankName: a.bankName,
                accountNumber: a.accountNumber,
                accountName: a.accountName,
                adminId: a.adminId
            })));
        } catch (e) {
            console.error('Fetch banks error:', e);
            res.status(500).json({ error: 'Failed to load accounts' });
        }
    });

    // Admin: list all accounts (including inactive & attached admin info)
    app.get('/api/admin/banks', adminAuthMiddleware, async (_req, res) => {
        try {
            const accounts = await prisma.paymentAccount.findMany({
                orderBy: { createdAt: 'desc' },
                include: {
                    _count: { select: { requests: true } },
                    admin: {
                        select: {
                            id: true,
                            code: true,
                            customName: true,
                            user: {
                                select: {
                                    firstName: true,
                                    username: true
                                }
                            }
                        }
                    }
                }
            });
            res.json(accounts.map(a => ({
                id: a.id,
                bankName: a.bankName,
                accountNumber: a.accountNumber,
                accountName: a.accountName,
                isActive: a.isActive,
                adminId: a.adminId,
                admin: a.admin ? {
                    id: a.admin.id,
                    code: a.admin.code,
                    name: a.admin.customName || a.admin.user?.firstName || a.admin.code,
                    username: a.admin.user?.username
                } : null,
                requestCount: a._count.requests,
                createdAt: a.createdAt
            })));
        } catch (e) {
            console.error('Fetch admin banks error:', e);
            res.status(500).json({ error: 'Failed to load accounts' });
        }
    });

    // Admin: add an account
    app.post('/api/admin/banks', adminAuthMiddleware, async (req, res) => {
        const { bankName, accountNumber, accountName, adminId } = req.body;
        if (!bankName || !accountNumber) {
            return res.status(400).json({ success: false, msg: 'bankName and accountNumber are required.' });
        }
        try {
            const account = await prisma.paymentAccount.create({
                data: {
                    bankName: String(bankName).trim(),
                    accountNumber: String(accountNumber).trim(),
                    accountName: accountName ? String(accountName).trim() : null,
                    adminId: adminId ? parseInt(String(adminId), 10) : null
                }
            });
            res.json({ success: true, account });
        } catch (e) {
            console.error('Add bank error:', e);
            res.status(500).json({ success: false, msg: 'Failed to add account.' });
        }
    });

    // Admin: edit an account
    app.put('/api/admin/banks/:id', adminAuthMiddleware, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ success: false, msg: 'Invalid id.' });
        const { bankName, accountNumber, accountName, isActive, adminId } = req.body;
        try {
            const existing = await prisma.paymentAccount.findUnique({ where: { id } });
            if (!existing) return res.status(404).json({ success: false, msg: 'Account not found.' });

            const updated = await prisma.paymentAccount.update({
                where: { id },
                data: {
                    bankName: bankName !== undefined ? String(bankName).trim() : undefined,
                    accountNumber: accountNumber !== undefined ? String(accountNumber).trim() : undefined,
                    accountName: accountName !== undefined ? (accountName ? String(accountName).trim() : null) : undefined,
                    isActive: isActive !== undefined ? Boolean(isActive) : undefined,
                    adminId: adminId !== undefined ? (adminId ? parseInt(String(adminId), 10) : null) : undefined
                }
            });
            res.json({ success: true, account: updated });
        } catch (e) {
            console.error('Update bank error:', e);
            res.status(500).json({ success: false, msg: 'Failed to update account.' });
        }
    });

    // Admin: toggle active state of an account
    app.delete('/api/admin/banks/:id', adminAuthMiddleware, async (req, res) => {
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

    // -------------------- ADMIN AFFILIATES & LINEAGE --------------------

    // Admin: list all admin affiliates
    app.get('/api/admin/admins', adminAuthMiddleware, async (_req, res) => {
        try {
            const admins = await prisma.adminProfile.findMany({
                orderBy: { id: 'asc' },
                include: {
                    user: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            username: true,
                            phone: true
                        }
                    },
                    paymentAccounts: {
                        orderBy: { id: 'asc' },
                        select: {
                            id: true,
                            bankName: true,
                            accountNumber: true,
                            accountName: true,
                            isActive: true
                        }
                    },
                    _count: {
                        select: {
                            assignedUsers: true
                        }
                    }
                }
            });

            const safeAdmins = admins.map(a => ({
                id: a.id,
                userId: a.userId.toString(),
                code: a.code,
                customName: a.customName,
                isActive: a.isActive,
                isWithdrawalAdmin: a.isWithdrawalAdmin,
                depositLimit: a.depositLimit ? a.depositLimit.toNumber() : 3000,
                collectedDeposits: a.collectedDeposits ? a.collectedDeposits.toNumber() : 0,
                createdAt: a.createdAt,
                assignedUsersCount: a._count.assignedUsers,
                user: {
                    id: a.user.id.toString(),
                    firstName: a.user.firstName,
                    lastName: a.user.lastName,
                    username: a.user.username,
                    phone: a.user.phone
                },
                paymentAccounts: a.paymentAccounts
            }));

            res.json({ admins: safeAdmins });
        } catch (e: any) {
            console.error('Fetch admins error:', e);
            res.status(500).json({ error: 'Failed to fetch administrators' });
        }
    });

    // Admin: create / promote user to administrator
    app.post('/api/admin/admins', adminAuthMiddleware, async (req, res) => {
        try {
            const { userId, code, customName, bankAccountIds, depositLimit } = req.body;
            if (!userId || !code) {
                return res.status(400).json({ success: false, msg: 'User and affiliate code are required.' });
            }

            const cleanCode = String(code).trim().toLowerCase();
            const userBigInt = BigInt(userId);

            const user = await prisma.user.findUnique({ where: { id: userBigInt } });
            if (!user) {
                return res.status(404).json({ success: false, msg: 'Selected user does not exist.' });
            }

            const existing = await prisma.adminProfile.findUnique({ where: { userId: userBigInt } });
            if (existing) {
                return res.status(400).json({ success: false, msg: 'This user is already registered as an administrator.' });
            }

            const codeDup = await prisma.adminProfile.findUnique({ where: { code: cleanCode } });
            if (codeDup) {
                return res.status(400).json({ success: false, msg: `Affiliate code "${cleanCode}" is already in use.` });
            }

            const limitNum = depositLimit !== undefined && !isNaN(Number(depositLimit)) ? Math.max(0, Number(depositLimit)) : 3000.0;
            const admin = await prisma.adminProfile.create({
                data: {
                    userId: userBigInt,
                    code: cleanCode,
                    customName: customName ? String(customName).trim() : null,
                    depositLimit: limitNum,
                    collectedDeposits: 0.0
                }
            });

            // Link selected bank accounts
            if (Array.isArray(bankAccountIds) && bankAccountIds.length > 0) {
                const targetIds = bankAccountIds.map((id: any) => parseInt(id, 10)).filter((n: number) => !isNaN(n));
                if (targetIds.length > 0) {
                    await prisma.paymentAccount.updateMany({
                        where: { id: { in: targetIds } },
                        data: { adminId: admin.id }
                    });
                }
            }

            res.json({
                success: true,
                admin: {
                    id: admin.id,
                    userId: admin.userId.toString(),
                    code: admin.code,
                    customName: admin.customName,
                    isActive: admin.isActive,
                    depositLimit: admin.depositLimit.toNumber(),
                    collectedDeposits: 0
                }
            });
        } catch (e: any) {
            console.error('Create admin error:', e);
            res.status(500).json({ success: false, msg: e?.message || 'Failed to create administrator profile.' });
        }
    });

    // Admin: update administrator code, custom name, active state, or attached banks
    app.put('/api/admin/admins/:id', adminAuthMiddleware, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            if (isNaN(id)) return res.status(400).json({ success: false, msg: 'Invalid id.' });

            const { code, customName, isActive, bankAccountIds, depositLimit } = req.body;
            const admin = await prisma.adminProfile.findUnique({ where: { id } });
            if (!admin) return res.status(404).json({ success: false, msg: 'Administrator not found.' });

            const dataToUpdate: any = {};
            if (code !== undefined) {
                const cleanCode = String(code).trim().toLowerCase();
                if (!cleanCode) return res.status(400).json({ success: false, msg: 'Code cannot be empty.' });
                if (cleanCode !== admin.code) {
                    const dup = await prisma.adminProfile.findUnique({ where: { code: cleanCode } });
                    if (dup) return res.status(400).json({ success: false, msg: `Code "${cleanCode}" is already taken.` });
                }
                dataToUpdate.code = cleanCode;
            }
            if (customName !== undefined) {
                dataToUpdate.customName = customName ? String(customName).trim() : null;
            }
            if (isActive !== undefined) {
                dataToUpdate.isActive = Boolean(isActive);
                if (!Boolean(isActive) && admin.isWithdrawalAdmin) {
                    dataToUpdate.isWithdrawalAdmin = false;
                }
            }
            if (depositLimit !== undefined && !isNaN(Number(depositLimit))) {
                dataToUpdate.depositLimit = Math.max(0, Number(depositLimit));
            }

            const updated = await prisma.adminProfile.update({
                where: { id },
                data: dataToUpdate
            });

            // Synchronize bank accounts if bankAccountIds array is passed
            if (Array.isArray(bankAccountIds)) {
                const targetIds = bankAccountIds.map((bid: any) => parseInt(bid, 10)).filter((n: number) => !isNaN(n));
                // Unlink any accounts currently linked to this admin that are not in targetIds
                await prisma.paymentAccount.updateMany({
                    where: { adminId: id, id: { notIn: targetIds } },
                    data: { adminId: null }
                });
                // Link the selected accounts to this admin
                if (targetIds.length > 0) {
                    await prisma.paymentAccount.updateMany({
                        where: { id: { in: targetIds } },
                        data: { adminId: id }
                    });
                }
            }

            res.json({
                success: true,
                admin: {
                    id: updated.id,
                    userId: updated.userId.toString(),
                    code: updated.code,
                    customName: updated.customName,
                    isActive: updated.isActive,
                    isWithdrawalAdmin: updated.isWithdrawalAdmin,
                    depositLimit: updated.depositLimit.toNumber(),
                    collectedDeposits: updated.collectedDeposits.toNumber()
                }
            });
        } catch (e: any) {
            console.error('Update admin error:', e);
            res.status(500).json({ success: false, msg: e?.message || 'Failed to update administrator profile.' });
        }
    });

    // Admin: refresh collected deposit limit counter back to 0
    app.post('/api/admin/admins/:id/refresh-limit', adminAuthMiddleware, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            if (isNaN(id)) return res.status(400).json({ success: false, msg: 'Invalid administrator ID.' });

            const admin = await prisma.adminProfile.findUnique({ where: { id }, include: { user: true } });
            if (!admin) return res.status(404).json({ success: false, msg: 'Administrator not found.' });

            const updated = await prisma.adminProfile.update({
                where: { id },
                data: { collectedDeposits: 0.0 }
            });

            const displayName = admin.customName || admin.user.firstName || admin.code;
            res.json({
                success: true,
                msg: `Deposit limit refreshed for ${displayName}! Collected counter reset to 0 / ${updated.depositLimit.toNumber()} Birr.`,
                admin: {
                    id: updated.id,
                    depositLimit: updated.depositLimit.toNumber(),
                    collectedDeposits: 0
                }
            });
        } catch (e: any) {
            console.error('Refresh admin limit error:', e);
            res.status(500).json({ success: false, msg: 'Failed to refresh administrator deposit limit.' });
        }
    });

    // Admin: delete administrator profile
    app.delete('/api/admin/admins/:id', adminAuthMiddleware, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            if (isNaN(id)) return res.status(400).json({ success: false, msg: 'Invalid id.' });

            const admin = await prisma.adminProfile.findUnique({ where: { id } });
            if (!admin) return res.status(404).json({ success: false, msg: 'Administrator not found.' });

            // Disassociate bank accounts
            await prisma.paymentAccount.updateMany({
                where: { adminId: id },
                data: { adminId: null }
            });

            // Disassociate assigned users
            await prisma.user.updateMany({
                where: { assignedAdminId: id },
                data: { assignedAdminId: null }
            });

            await prisma.adminProfile.delete({ where: { id } });
            res.json({ success: true, msg: 'Administrator removed successfully.' });
        } catch (e: any) {
            console.error('Delete admin error:', e);
            res.status(500).json({ success: false, msg: 'Failed to delete administrator.' });
        }
    });

    // Admin: get active duty withdrawal admin
    app.get('/api/admin/withdrawal-admin', adminAuthMiddleware, async (_req, res) => {
        try {
            const dutyAdmin = await prisma.adminProfile.findFirst({
                where: { isWithdrawalAdmin: true, isActive: true },
                include: {
                    user: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            username: true,
                            phone: true
                        }
                    }
                }
            });

            if (!dutyAdmin) {
                return res.json({
                    success: true,
                    withdrawalAdmin: null,
                    masterAdminId: config.ADMIN_USER_ID
                });
            }

            res.json({
                success: true,
                withdrawalAdmin: {
                    id: dutyAdmin.id,
                    userId: dutyAdmin.userId.toString(),
                    code: dutyAdmin.code,
                    customName: dutyAdmin.customName,
                    isActive: dutyAdmin.isActive,
                    isWithdrawalAdmin: true,
                    user: {
                        id: dutyAdmin.user.id.toString(),
                        firstName: dutyAdmin.user.firstName,
                        lastName: dutyAdmin.user.lastName,
                        username: dutyAdmin.user.username,
                        phone: dutyAdmin.user.phone
                    }
                },
                masterAdminId: config.ADMIN_USER_ID
            });
        } catch (e: any) {
            console.error('Fetch duty withdrawal admin error:', e);
            res.status(500).json({ success: false, error: 'Failed to fetch withdrawal admin' });
        }
    });

    // Admin: set or change duty withdrawal admin
    app.post('/api/admin/withdrawal-admin', adminAuthMiddleware, async (req, res) => {
        try {
            const { adminId, clear } = req.body;

            // Reset all profiles
            await prisma.adminProfile.updateMany({
                data: { isWithdrawalAdmin: false }
            });

            if (clear || !adminId) {
                return res.json({
                    success: true,
                    msg: 'Duty withdrawal admin reset to Master Admin.',
                    withdrawalAdmin: null
                });
            }

            const targetId = parseInt(String(adminId), 10);
            if (isNaN(targetId)) {
                return res.status(400).json({ success: false, msg: 'Invalid administrator ID.' });
            }

            const targetAdmin = await prisma.adminProfile.findUnique({
                where: { id: targetId },
                include: { user: true }
            });

            if (!targetAdmin) {
                return res.status(404).json({ success: false, msg: 'Administrator not found.' });
            }

            if (!targetAdmin.isActive) {
                return res.status(400).json({ success: false, msg: 'Cannot assign an inactive administrator to withdrawal duty.' });
            }

            await prisma.adminProfile.update({
                where: { id: targetId },
                data: { isWithdrawalAdmin: true }
            });

            const displayName = targetAdmin.customName || targetAdmin.user.firstName || targetAdmin.code;
            res.json({
                success: true,
                msg: `Duty withdrawal admin updated to ${displayName} (@${targetAdmin.user.username || targetAdmin.code}).`,
                withdrawalAdmin: {
                    id: targetAdmin.id,
                    userId: targetAdmin.userId.toString(),
                    code: targetAdmin.code,
                    customName: targetAdmin.customName
                }
            });
        } catch (e: any) {
            console.error('Set duty withdrawal admin error:', e);
            res.status(500).json({ success: false, msg: 'Failed to update withdrawal admin.' });
        }
    });

    // List current user's requests (wallet page)
    app.get('/api/requests/:userId', requirePlayerOwnership(req => req.params.userId), async (req, res) => {
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

    // Period Range Helper (UTC+3 East Africa Time)
    function getPeriodRange(period: string = 'today', startDate?: string, endDate?: string) {
        const now = new Date();
        const EAT_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC+3
        const eatNow = new Date(now.getTime() + EAT_OFFSET_MS);

        let start: Date | null = null;
        let end: Date = now;

        if (period === 'today') {
            const y = eatNow.getUTCFullYear();
            const m = eatNow.getUTCMonth();
            const d = eatNow.getUTCDate();
            start = new Date(Date.UTC(y, m, d) - EAT_OFFSET_MS);
        } else if (period === 'yesterday') {
            const y = eatNow.getUTCFullYear();
            const m = eatNow.getUTCMonth();
            const d = eatNow.getUTCDate();
            start = new Date(Date.UTC(y, m, d - 1) - EAT_OFFSET_MS);
            end = new Date(Date.UTC(y, m, d) - EAT_OFFSET_MS);
        } else if (period === '7d' || period === 'week') {
            start = new Date(now.getTime() - 7 * 86400000);
        } else if (period === '30d' || period === 'month') {
            start = new Date(now.getTime() - 30 * 86400000);
        } else if (period === 'custom' && startDate) {
            start = new Date(startDate);
            if (endDate) {
                const endD = new Date(endDate);
                endD.setHours(23, 59, 59, 999);
                end = endD;
            }
        } else if (period === 'all') {
            start = null;
        } else {
            const y = eatNow.getUTCFullYear();
            const m = eatNow.getUTCMonth();
            const d = eatNow.getUTCDate();
            start = new Date(Date.UTC(y, m, d) - EAT_OFFSET_MS);
        }

        return { start, end };
    }

    // List all requests (admin) with optional status & period filters
    app.get('/api/requests', adminAuthMiddleware, async (req, res) => {
        const status = req.query.status as string | undefined;
        const period = req.query.period as string | undefined;
        const startDate = req.query.startDate as string | undefined;
        const endDate = req.query.endDate as string | undefined;

        let where: any = {};
        if (status && status !== 'ALL') {
            where.status = status;
        }
        if (period && period !== 'all') {
            const { start, end } = getPeriodRange(period, startDate, endDate);
            if (start) {
                where.createdAt = { gte: start, lte: end };
            }
        }

        try {
            const requests = await prisma.transactionRequest.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take: 200,
                include: {
                    user: { select: { firstName: true, username: true, balance: true } },
                    account: { select: { bankName: true, accountNumber: true } },
                    assignedAdmin: {
                        select: {
                            id: true,
                            code: true,
                            customName: true,
                            user: { select: { firstName: true, username: true } }
                        }
                    },
                    processedByAdmin: {
                        select: {
                            id: true,
                            code: true,
                            customName: true,
                            user: { select: { firstName: true, username: true } }
                        }
                    }
                }
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
                assignedAdminId: r.assignedAdminId,
                assignedAdmin: r.assignedAdmin ? {
                    id: r.assignedAdmin.id,
                    code: r.assignedAdmin.code,
                    name: r.assignedAdmin.customName || r.assignedAdmin.user?.firstName || r.assignedAdmin.code,
                    username: r.assignedAdmin.user?.username
                } : null,
                processedByAdminId: r.processedByAdminId,
                processedByName: r.processedByName,
                actionAt: r.actionAt,
                createdAt: r.createdAt
            })));
        } catch (e) {
            res.status(500).json({ error: 'Failed to load requests' });
        }
    });

    // Approve a request (admin)
    app.post('/api/request/:id/approve', adminAuthMiddleware, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ success: false, msg: 'Invalid id.' });
        try {
            const request = await prisma.transactionRequest.findUnique({ where: { id } });
            if (!request) return res.status(404).json({ success: false, msg: 'Request not found.' });
            if (request.status !== 'PENDING') return res.status(400).json({ success: false, msg: 'Only pending requests can be approved.' });

            if (request.type === 'deposit') {
                let targetAdminId: number | null = null;
                if (request.accountId) {
                    const acct = await prisma.paymentAccount.findUnique({ where: { id: request.accountId } });
                    if (acct?.adminId) targetAdminId = acct.adminId;
                }
                if (!targetAdminId) {
                    const reqUser = await prisma.user.findUnique({ where: { id: request.userId }, select: { assignedAdminId: true } });
                    if (reqUser?.assignedAdminId) targetAdminId = reqUser.assignedAdminId;
                }

                const txOps: any[] = [
                    prisma.user.update({ where: { id: request.userId }, data: { balance: { increment: request.amount } } }),
                    prisma.transactionRequest.update({
                        where: { id },
                        data: {
                            status: 'APPROVED',
                            processedByName: 'Super Admin',
                            processedByAdminId: null,
                            actionAt: new Date()
                        }
                    })
                ];
                if (targetAdminId) {
                    txOps.push(
                        prisma.adminProfile.update({
                            where: { id: targetAdminId },
                            data: { collectedDeposits: { increment: request.amount } }
                        })
                    );
                }
                await prisma.$transaction(txOps);
            } else {
                const user = await prisma.user.findUnique({ where: { id: request.userId } });
                if (!user || user.balance.toNumber() < request.amount.toNumber()) {
                    return res.status(400).json({ success: false, msg: 'User does not have enough balance for this withdrawal.' });
                }
                const currentWithdrawable = user.withdrawableBalance ? user.withdrawableBalance.toNumber() : 0;
                const newWithdrawable = Math.max(0, currentWithdrawable - request.amount.toNumber());
                await prisma.$transaction([
                    prisma.user.update({
                        where: { id: request.userId },
                        data: {
                            balance: { decrement: request.amount },
                            withdrawableBalance: { set: newWithdrawable }
                        }
                    }),
                    prisma.transactionRequest.update({
                        where: { id },
                        data: {
                            status: 'APPROVED',
                            processedByName: 'Super Admin',
                            processedByAdminId: null,
                            actionAt: new Date()
                        }
                    })
                ]);
            }
            res.json({ success: true, msg: `${request.type} request #${id} approved.` });
        } catch (e) {
            res.status(500).json({ success: false, msg: 'Failed to approve request.' });
        }
    });

    // Reject a request (admin)
    app.post('/api/request/:id/reject', adminAuthMiddleware, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ success: false, msg: 'Invalid id.' });
        try {
            const request = await prisma.transactionRequest.findUnique({ where: { id } });
            if (!request) return res.status(404).json({ success: false, msg: 'Request not found.' });
            if (request.status !== 'PENDING') return res.status(400).json({ success: false, msg: 'Only pending requests can be rejected.' });

            await prisma.transactionRequest.update({
                where: { id },
                data: {
                    status: 'REJECTED',
                    processedByName: 'Super Admin',
                    processedByAdminId: null,
                    actionAt: new Date()
                }
            });
            res.json({ success: true, msg: `${request.type} request #${id} rejected.` });
        } catch (e) {
            res.status(500).json({ success: false, msg: 'Failed to reject request.' });
        }
    });

    // Admin: audit statistics per administrator (for Admins Audit tab)
    app.get('/api/admin/audit-stats', adminAuthMiddleware, async (req, res) => {
        try {
            const period = (req.query.period as string) || 'today';
            const startDate = req.query.startDate as string | undefined;
            const endDate = req.query.endDate as string | undefined;

            const { start, end } = getPeriodRange(period, startDate, endDate);
            const wherePeriod: any = {};
            if (start) {
                wherePeriod.createdAt = { gte: start, lte: end };
            }

            const [requests, admins] = await Promise.all([
                prisma.transactionRequest.findMany({
                    where: wherePeriod,
                    select: {
                        id: true,
                        type: true,
                        amount: true,
                        status: true,
                        assignedAdminId: true,
                        processedByAdminId: true,
                        processedByName: true,
                        actionAt: true,
                        createdAt: true
                    }
                }),
                prisma.adminProfile.findMany({
                    orderBy: { id: 'asc' },
                    include: {
                        user: {
                            select: {
                                id: true,
                                firstName: true,
                                lastName: true,
                                username: true,
                                phone: true
                            }
                        }
                    }
                })
            ]);

            function createEmptyMetrics() {
                return {
                    depositsApprovedCount: 0,
                    depositsApprovedAmount: 0,
                    depositsPendingCount: 0,
                    depositsPendingAmount: 0,
                    depositsRejectedCount: 0,
                    depositsRejectedAmount: 0,
                    withdrawalsApprovedCount: 0,
                    withdrawalsApprovedAmount: 0,
                    withdrawalsPendingCount: 0,
                    withdrawalsPendingAmount: 0,
                    withdrawalsRejectedCount: 0,
                    withdrawalsRejectedAmount: 0,
                    totalSettledVolume: 0
                };
            }

            const superAdminMetrics = createEmptyMetrics();
            const adminMetricsMap = new Map<number, ReturnType<typeof createEmptyMetrics>>();
            for (const a of admins) {
                adminMetricsMap.set(a.id, createEmptyMetrics());
            }

            for (const r of requests) {
                const amt = r.amount.toNumber();
                const isDeposit = r.type === 'deposit';

                if (r.status === 'PENDING') {
                    const targetMetrics = (r.assignedAdminId && adminMetricsMap.has(r.assignedAdminId))
                        ? adminMetricsMap.get(r.assignedAdminId)!
                        : superAdminMetrics;

                    if (isDeposit) {
                        targetMetrics.depositsPendingCount++;
                        targetMetrics.depositsPendingAmount += amt;
                    } else {
                        targetMetrics.withdrawalsPendingCount++;
                        targetMetrics.withdrawalsPendingAmount += amt;
                    }
                } else if (r.status === 'APPROVED') {
                    const targetMetrics = (r.processedByAdminId && adminMetricsMap.has(r.processedByAdminId))
                        ? adminMetricsMap.get(r.processedByAdminId)!
                        : superAdminMetrics;

                    if (isDeposit) {
                        targetMetrics.depositsApprovedCount++;
                        targetMetrics.depositsApprovedAmount += amt;
                        targetMetrics.totalSettledVolume += amt;
                    } else {
                        targetMetrics.withdrawalsApprovedCount++;
                        targetMetrics.withdrawalsApprovedAmount += amt;
                        targetMetrics.totalSettledVolume += amt;
                    }
                } else if (r.status === 'REJECTED') {
                    const processorId = r.processedByAdminId ?? r.assignedAdminId;
                    const targetMetrics = (processorId && adminMetricsMap.has(processorId))
                        ? adminMetricsMap.get(processorId)!
                        : superAdminMetrics;

                    if (isDeposit) {
                        targetMetrics.depositsRejectedCount++;
                        targetMetrics.depositsRejectedAmount += amt;
                    } else {
                        targetMetrics.withdrawalsRejectedCount++;
                        targetMetrics.withdrawalsRejectedAmount += amt;
                    }
                }
            }

            const superAdminRow = {
                id: null,
                isSuperAdmin: true,
                displayName: '👑 Super Admin',
                code: 'master',
                username: null,
                userId: config.ADMIN_USER_ID,
                isActive: true,
                isWithdrawalAdmin: false,
                depositLimit: null,
                collectedDeposits: null,
                metrics: superAdminMetrics
            };

            const affiliateRows = admins.map(a => {
                const metrics = adminMetricsMap.get(a.id) || createEmptyMetrics();
                const displayName = a.customName || a.user?.firstName || a.code;
                return {
                    id: a.id,
                    isSuperAdmin: false,
                    displayName,
                    code: a.code,
                    username: a.user?.username || null,
                    userId: a.userId.toString(),
                    isActive: a.isActive,
                    isWithdrawalAdmin: a.isWithdrawalAdmin,
                    depositLimit: a.depositLimit ? a.depositLimit.toNumber() : 3000,
                    collectedDeposits: a.collectedDeposits ? a.collectedDeposits.toNumber() : 0,
                    metrics
                };
            });

            const totals = {
                depositsApprovedCount: superAdminMetrics.depositsApprovedCount + affiliateRows.reduce((s, a) => s + a.metrics.depositsApprovedCount, 0),
                depositsApprovedAmount: superAdminMetrics.depositsApprovedAmount + affiliateRows.reduce((s, a) => s + a.metrics.depositsApprovedAmount, 0),
                depositsPendingCount: superAdminMetrics.depositsPendingCount + affiliateRows.reduce((s, a) => s + a.metrics.depositsPendingCount, 0),
                depositsPendingAmount: superAdminMetrics.depositsPendingAmount + affiliateRows.reduce((s, a) => s + a.metrics.depositsPendingAmount, 0),
                depositsRejectedCount: superAdminMetrics.depositsRejectedCount + affiliateRows.reduce((s, a) => s + a.metrics.depositsRejectedCount, 0),
                depositsRejectedAmount: superAdminMetrics.depositsRejectedAmount + affiliateRows.reduce((s, a) => s + a.metrics.depositsRejectedAmount, 0),

                withdrawalsApprovedCount: superAdminMetrics.withdrawalsApprovedCount + affiliateRows.reduce((s, a) => s + a.metrics.withdrawalsApprovedCount, 0),
                withdrawalsApprovedAmount: superAdminMetrics.withdrawalsApprovedAmount + affiliateRows.reduce((s, a) => s + a.metrics.withdrawalsApprovedAmount, 0),
                withdrawalsPendingCount: superAdminMetrics.withdrawalsPendingCount + affiliateRows.reduce((s, a) => s + a.metrics.withdrawalsPendingCount, 0),
                withdrawalsPendingAmount: superAdminMetrics.withdrawalsPendingAmount + affiliateRows.reduce((s, a) => s + a.metrics.withdrawalsPendingAmount, 0),
                withdrawalsRejectedCount: superAdminMetrics.withdrawalsRejectedCount + affiliateRows.reduce((s, a) => s + a.metrics.withdrawalsRejectedCount, 0),
                withdrawalsRejectedAmount: superAdminMetrics.withdrawalsRejectedAmount + affiliateRows.reduce((s, a) => s + a.metrics.withdrawalsRejectedAmount, 0),

                totalSettledVolume: superAdminMetrics.totalSettledVolume + affiliateRows.reduce((s, a) => s + a.metrics.totalSettledVolume, 0)
            };

            res.json({
                success: true,
                period,
                totals,
                admins: [superAdminRow, ...affiliateRows]
            });
        } catch (e: any) {
            console.error('Audit stats error:', e);
            res.status(500).json({ success: false, msg: 'Failed to calculate admin audit stats.' });
        }
    });

    // Delete a request (admin)
    app.delete('/api/request/:id', adminAuthMiddleware, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ success: false, msg: 'Invalid id.' });
        try {
            const request = await prisma.transactionRequest.findUnique({ where: { id } });
            if (!request) return res.status(404).json({ success: false, msg: 'Request not found.' });

            if (request.status === 'APPROVED') {
                return res.status(400).json({ success: false, msg: 'Approved requests are settled and cannot be deleted.' });
            }

            if (request.proof) {
                try {
                    const filePath = proofPath(request.proof);
                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                } catch (err) {
                    console.error('Failed to unlink proof file:', err);
                }
            }

            await prisma.transactionRequest.delete({ where: { id } });
            res.json({ success: true, msg: `Request #${id} deleted successfully.` });
        } catch (e) {
            console.error('Delete request error:', e);
            res.status(500).json({ success: false, msg: 'Failed to delete request.' });
        }
    });

    // Batch delete requests (admin)
    app.post('/api/requests/batch-delete', adminAuthMiddleware, async (req, res) => {
        const { ids } = req.body || {};
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, msg: 'ids array is required.' });
        }
        const numericIds = ids.map((i: any) => parseInt(String(i), 10)).filter(n => !isNaN(n));
        try {
            const requests = await prisma.transactionRequest.findMany({
                where: { id: { in: numericIds }, status: { in: ['PENDING', 'REJECTED'] } },
                select: { id: true, proof: true }
            });

            for (const r of requests) {
                if (r.proof) {
                    try {
                        const filePath = proofPath(r.proof);
                        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                    } catch (err) {}
                }
            }

            const validIds = requests.map(r => r.id);
            if (validIds.length === 0) {
                return res.json({ success: true, count: 0, msg: 'No eligible pending or rejected requests found to delete.' });
            }

            const result = await prisma.transactionRequest.deleteMany({
                where: { id: { in: validIds } }
            });
            res.json({ success: true, count: result.count, msg: `${result.count} request(s) deleted successfully.` });
        } catch (e) {
            console.error('Batch delete error:', e);
            res.status(500).json({ success: false, msg: 'Failed to batch delete requests.' });
        }
    });

    // Edit a request (admin)
    app.put('/api/request/:id', adminAuthMiddleware, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ success: false, msg: 'Invalid id.' });
        const { amount, phone, bankName, status } = req.body || {};

        try {
            const existing = await prisma.transactionRequest.findUnique({ where: { id } });
            if (!existing) return res.status(404).json({ success: false, msg: 'Request not found.' });

            if (existing.status === 'APPROVED') {
                return res.status(400).json({ success: false, msg: 'Approved requests are settled and cannot be edited.' });
            }

            const newAmount = (amount !== undefined && !isNaN(Number(amount)) && Number(amount) > 0)
                ? Number(amount)
                : existing.amount.toNumber();
            const newStatus = status ? String(status).toUpperCase() : existing.status;
            const newPhone = phone !== undefined ? String(phone).trim() : existing.phone;
            const newBank = bankName !== undefined ? String(bankName).trim() : existing.bankName;

            const oldStatus = existing.status;
            const oldAmount = existing.amount.toNumber();
            const txOps: any[] = [];

            if (oldStatus !== newStatus) {
                // Moving from PENDING/REJECTED to APPROVED: apply balance change
                if (newStatus === 'APPROVED' && oldStatus !== 'APPROVED') {
                    if (existing.type === 'deposit') {
                        txOps.push(prisma.user.update({
                            where: { id: existing.userId },
                            data: { balance: { increment: newAmount } }
                        }));
                    } else if (existing.type === 'withdraw') {
                        txOps.push(prisma.user.update({
                            where: { id: existing.userId },
                            data: {
                                balance: { decrement: newAmount },
                                withdrawableBalance: { decrement: newAmount }
                            }
                        }));
                    }
                }
                // Moving from APPROVED to REJECTED/PENDING: revert balance change
                else if (oldStatus === 'APPROVED' && newStatus !== 'APPROVED') {
                    if (existing.type === 'deposit') {
                        txOps.push(prisma.user.update({
                            where: { id: existing.userId },
                            data: { balance: { decrement: oldAmount } }
                        }));
                    } else if (existing.type === 'withdraw') {
                        txOps.push(prisma.user.update({
                            where: { id: existing.userId },
                            data: {
                                balance: { increment: oldAmount },
                                withdrawableBalance: { increment: oldAmount }
                            }
                        }));
                    }
                }
            } else if (newStatus === 'APPROVED' && oldAmount !== newAmount) {
                const diff = newAmount - oldAmount;
                if (existing.type === 'deposit') {
                    txOps.push(prisma.user.update({
                        where: { id: existing.userId },
                        data: { balance: { increment: diff } }
                    }));
                } else if (existing.type === 'withdraw') {
                    txOps.push(prisma.user.update({
                        where: { id: existing.userId },
                        data: {
                            balance: { decrement: diff },
                            withdrawableBalance: { decrement: diff }
                        }
                    }));
                }
            }

            txOps.push(prisma.transactionRequest.update({
                where: { id },
                data: {
                    amount: newAmount,
                    status: newStatus,
                    phone: newPhone,
                    bankName: newBank
                }
            }));

            await prisma.$transaction(txOps);
            res.json({ success: true, msg: `Request #${id} updated successfully.` });
        } catch (e) {
            console.error('Edit request error:', e);
            res.status(500).json({ success: false, msg: 'Failed to update request.' });
        }
    });

    // Batch approve requests (admin)
    app.post('/api/requests/batch-approve', adminAuthMiddleware, async (req, res) => {
        const { ids } = req.body || {};
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, msg: 'ids array is required.' });
        }
        const numericIds = ids.map((i: any) => parseInt(String(i), 10)).filter(n => !isNaN(n));
        let approved = 0;
        let failed = 0;

        for (const id of numericIds) {
            try {
                const request = await prisma.transactionRequest.findUnique({ where: { id } });
                if (!request || request.status !== 'PENDING') {
                    failed++;
                    continue;
                }
                if (request.type === 'deposit') {
                    await prisma.$transaction([
                        prisma.user.update({ where: { id: request.userId }, data: { balance: { increment: request.amount } } }),
                        prisma.transactionRequest.update({ where: { id }, data: { status: 'APPROVED' } })
                    ]);
                    approved++;
                } else {
                    const user = await prisma.user.findUnique({ where: { id: request.userId } });
                    if (!user || user.balance.toNumber() < request.amount.toNumber()) {
                        failed++;
                        continue;
                    }
                    await prisma.$transaction([
                        prisma.user.update({ where: { id: request.userId }, data: { balance: { decrement: request.amount } } }),
                        prisma.transactionRequest.update({ where: { id }, data: { status: 'APPROVED' } })
                    ]);
                    approved++;
                }
            } catch (err) {
                failed++;
            }
        }
        res.json({ success: true, approvedCount: approved, failedCount: failed, msg: `${approved} approved, ${failed} skipped.` });
    });

    // Batch reject requests (admin)
    app.post('/api/requests/batch-reject', adminAuthMiddleware, async (req, res) => {
        const { ids } = req.body || {};
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, msg: 'ids array is required.' });
        }
        const numericIds = ids.map((i: any) => parseInt(String(i), 10)).filter(n => !isNaN(n));
        try {
            const result = await prisma.transactionRequest.updateMany({
                where: { id: { in: numericIds }, status: 'PENDING' },
                data: { status: 'REJECTED' }
            });
            res.json({ success: true, rejectedCount: result.count, msg: `${result.count} request(s) rejected.` });
        } catch (e) {
            console.error('Batch reject error:', e);
            res.status(500).json({ success: false, msg: 'Failed to batch reject requests.' });
        }
    });

    // House Income Game Report & History API
    app.get('/api/admin/income', adminAuthMiddleware, async (req, res) => {
        const period = (req.query.period as string) || 'today';
        const startDate = req.query.startDate as string | undefined;
        const endDate = req.query.endDate as string | undefined;

        const { start, end } = getPeriodRange(period, startDate, endDate);
        const where: any = start ? { createdAt: { gte: start, lte: end } } : {};

        try {
            const incomes = await prisma.houseIncome.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take: 200
            });

            // Gather winner usernames and names for both winnerId and winner2Id
            const winnerIds: bigint[] = [];
            for (const i of incomes) {
                if (i.winnerId) winnerIds.push(i.winnerId);
                const w2 = (i as any).winner2Id;
                if (w2) winnerIds.push(w2);
            }
            const uniqueWinnerIds = Array.from(new Set(winnerIds));
            const winners = await prisma.user.findMany({
                where: { id: { in: uniqueWinnerIds } },
                select: { id: true, firstName: true, username: true }
            });
            const winnerMap = new Map<string, { id: string; firstName: string | null; username: string | null }>(
                winners.map(w => [w.id.toString(), { id: w.id.toString(), firstName: w.firstName, username: w.username }])
            );

            let totalPlayers = 0;
            let totalPot = 0;
            let totalWinnerPayout = 0;
            let totalHouseProfit = 0;

            const safeIncomes = incomes.map(i => {
                const pot = i.totalCollected.toNumber();
                const payout = i.winnerPayout.toNumber();
                const profit = i.houseProfit.toNumber();
                totalPlayers += i.playerCount;
                totalPot += pot;
                totalWinnerPayout += payout;
                totalHouseProfit += profit;

                const w2Id = (i as any).winner2Id;
                const wCount = (i as any).winnerCount || (w2Id ? 2 : 1);
                const splitPayout = Math.floor(payout / wCount);

                const winner = i.winnerId ? winnerMap.get(i.winnerId.toString()) : null;
                const winner2 = w2Id ? winnerMap.get(w2Id.toString()) : null;

                return {
                    id: i.id,
                    gameType: i.gameType,
                    playerCount: i.playerCount,
                    pot,
                    winnerPayout: payout,
                    splitPayout,
                    winnerCount: wCount,
                    houseProfit: profit,
                    winnerId: i.winnerId ? i.winnerId.toString() : null,
                    winnerName: winner?.firstName || null,
                    winnerUsername: winner?.username || null,
                    winner2Id: w2Id ? w2Id.toString() : null,
                    winner2Name: winner2?.firstName || null,
                    winner2Username: winner2?.username || null,
                    createdAt: i.createdAt
                };
            });

            res.json({
                period,
                start,
                end,
                summary: {
                    totalGames: incomes.length,
                    totalPlayers,
                    totalPot,
                    totalWinnerPayout,
                    totalHouseProfit
                },
                incomes: safeIncomes
            });
        } catch (e) {
            console.error('House income fetch error:', e);
            res.status(500).json({ error: 'Failed to fetch house income data.' });
        }
    });

    // Financial Summary filtered by period (Default: today)
    app.get('/api/admin/financial-summary', adminAuthMiddleware, async (req, res) => {
        const period = (req.query.period as string) || 'today';
        const startDate = req.query.startDate as string | undefined;
        const endDate = req.query.endDate as string | undefined;

        const { start, end } = getPeriodRange(period, startDate, endDate);
        const dateFilter = start ? { createdAt: { gte: start, lte: end } } : {};

        try {
            const [depAgg, wdrAgg, incAgg, newUsers, pendingCount, allUsersCount, allBalanceAgg] = await Promise.all([
                prisma.transactionRequest.aggregate({
                    where: { type: 'deposit', status: 'APPROVED', ...dateFilter },
                    _sum: { amount: true },
                    _count: true
                }),
                prisma.transactionRequest.aggregate({
                    where: { type: 'withdraw', status: 'APPROVED', ...dateFilter },
                    _sum: { amount: true },
                    _count: true
                }),
                prisma.houseIncome.aggregate({
                    where: dateFilter,
                    _sum: { totalCollected: true, winnerPayout: true, houseProfit: true },
                    _count: true
                }),
                prisma.user.count({ where: dateFilter }),
                prisma.transactionRequest.count({ where: { status: 'PENDING' } }),
                prisma.user.count(),
                prisma.user.aggregate({ _sum: { balance: true } })
            ]);

            const totalDeposits = depAgg._sum.amount ? depAgg._sum.amount.toNumber() : 0;
            const totalWithdrawals = wdrAgg._sum.amount ? wdrAgg._sum.amount.toNumber() : 0;
            const netCashFlow = totalDeposits - totalWithdrawals;

            const totalPot = incAgg._sum.totalCollected ? incAgg._sum.totalCollected.toNumber() : 0;
            const totalWinnerPayout = incAgg._sum.winnerPayout ? incAgg._sum.winnerPayout.toNumber() : 0;
            const totalHouseProfit = incAgg._sum.houseProfit ? incAgg._sum.houseProfit.toNumber() : 0;
            const totalGames = incAgg._count || 0;

            const totalPlayerBalance = allBalanceAgg._sum.balance ? allBalanceAgg._sum.balance.toNumber() : 0;

            res.json({
                period,
                start,
                end,
                totalDeposits,
                depositsCount: depAgg._count,
                totalWithdrawals,
                withdrawalsCount: wdrAgg._count,
                netCashFlow,
                totalHouseProfit,
                totalPot,
                totalWinnerPayout,
                totalGames,
                newUsers,
                totalUsers: allUsersCount,
                totalPlayerBalance,
                pendingCount
            });
        } catch (e) {
            console.error('Financial summary error:', e);
            res.status(500).json({ error: 'Failed to calculate financial summary.' });
        }
    });


    // Admin dashboard stats (totals, growth, pending)
    app.get('/api/admin/stats', adminAuthMiddleware, async (req, res) => {
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
    app.post('/api/admin/broadcast', adminAuthMiddleware, async (req, res) => {
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
                        .text('💰 ገንዘብ አስገባ', 'menu_deposit').row();

                    if (config.CHANNEL_URL) userKb.url('📣 Channel', config.CHANNEL_URL);
                    userKb.text('✍️ Feedback', 'menu_feedback');

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
    app.get('/api/admin/voice', adminAuthMiddleware, (_req, res) => {
        res.json({ success: true, voice: gameRooms.getCallerVoice() });
    });

    app.post('/api/admin/voice', adminAuthMiddleware, (req, res) => {
        const { voice } = req.body || {};
        if (voice !== 'male' && voice !== 'female') {
            return res.status(400).json({ success: false, msg: 'Invalid voice option. Must be "male" or "female".' });
        }
        gameRooms.setCallerVoice(voice);
        console.log(`[Admin] Caller voice changed to "${voice}" by admin`);
        res.json({ success: true, voice: gameRooms.getCallerVoice() });
    });

    // Promotional Bonus Admin API
    app.get('/api/admin/bonus', adminAuthMiddleware, (_req, res) => {
        res.json({
            success: true,
            newUserBonus: getNewUserBonus(),
            referralBonus: getReferralBonus()
        });
    });

    app.post('/api/admin/bonus', adminAuthMiddleware, (req, res) => {
        const { newUserBonus, referralBonus } = req.body || {};
        const parsedNewUser = Number(newUserBonus);
        const parsedReferral = Number(referralBonus);

        if (isNaN(parsedNewUser) || parsedNewUser < 0 || isNaN(parsedReferral) || parsedReferral < 0) {
            return res.status(400).json({
                success: false,
                msg: 'Invalid bonus values. Both must be numbers greater than or equal to 0.'
            });
        }

        try {
            const updated = setBonusSettings(parsedNewUser, parsedReferral);
            console.log(`[Admin] Promotional bonus updated: Welcome=${updated.newUserBonus} Birr, Referral=${updated.referralBonus} Birr`);
            res.json({
                success: true,
                newUserBonus: updated.newUserBonus,
                referralBonus: updated.referralBonus
            });
        } catch (e: any) {
            res.status(500).json({ success: false, msg: e?.message || 'Failed to save bonus settings' });
        }
    });

    // Virtual Players (Bot System) Admin Endpoints
    app.get('/api/admin/bots', adminAuthMiddleware, (_req, res) => {
        const settings = gameRooms.botService.getSettings();
        let totalActiveBots = 0;
        for (const gm of gameRooms.roomsList()) {
            totalActiveBots += gm.players.filter(p => p.isBot).length;
        }
        res.json({
            success: true,
            settings,
            totalActiveBots
        });
    });

    app.post('/api/admin/bots/settings', adminAuthMiddleware, (req, res) => {
        try {
            const updated = gameRooms.botService.updateSettings(req.body || {});
            console.log('[Admin] Bot settings updated:', updated);
            res.json({ success: true, settings: updated });
        } catch (e: any) {
            res.status(500).json({ success: false, msg: e?.message || 'Failed to update bot settings' });
        }
    });

    app.post('/api/admin/bots/inject', adminAuthMiddleware, async (req, res) => {
        const { fee = 10, room = 1, count = 5 } = req.body || {};
        const parsedFee = Number(fee) || 10;
        const parsedRoom = Number(room) || 1;
        const parsedCount = Math.max(1, Math.min(30, Number(count) || 5));

        const gm = gameRooms.getRoom(parsedFee, parsedRoom);
        if (gm.state !== 'WAITING') {
            return res.status(400).json({ success: false, msg: 'Cannot add bots while game is playing. Wait for waiting lobby.' });
        }

        const added = await gameRooms.botService.injectBots(gm, parsedCount, parsedFee);
        res.json({
            success: true,
            msg: `Successfully added ${added} fake players to ${parsedFee} Birr room!`,
            added,
            totalPlayers: gm.players.length
        });
    });

    app.post('/api/admin/bots/clear', adminAuthMiddleware, (req, res) => {
        const { fee = 10, room = 1 } = req.body || {};
        const parsedFee = Number(fee) || 10;
        const parsedRoom = Number(room) || 1;

        const gm = gameRooms.getRoom(parsedFee, parsedRoom);
        const removed = gameRooms.botService.clearBots(gm);
        res.json({
            success: true,
            msg: `Cleared ${removed} fake players from ${parsedFee} Birr room.`,
            removed,
            totalPlayers: gm.players.length
        });
    });

    app.listen(Number(config.PORT), () => {
        console.log(`Admin server running on http://localhost:${config.PORT}`);
    });
}