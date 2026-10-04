import { Bot, InlineKeyboard } from 'grammy';
import { generateTicket, createTicketKeyboard, checkWin, checkWinDetails, checkWinFreshness, getNumberName, getColumnEmoji, BingoTicket } from './bingo';
import { prisma } from '../db';
import { deductFee } from '../bonus';

export interface PlayerCard {
    boardNumber: number;
    ticket: BingoTicket;
    daubed: Set<number>;
    isBlocked?: boolean;
}

export interface Player {
    userId: bigint;
    cards: PlayerCard[];
    ticket: BingoTicket;
    daubed: Set<number>;
    ticketMessageId?: number;
    boardNumber?: number;
    fee: number;
    bonusUsed?: number;
    firstName?: string;
    username?: string;
    lastSeen: number;
    isBlocked?: boolean;
}

export interface WinnerRecord {
    userId: string;
    firstName: string;
    username: string | null;
    amount: number;
    boardNumber?: number;
    ticket?: BingoTicket;
    daubed?: number[];
    winningCells?: { row: number; col: number }[];
    at: string;
}

export interface WinnerCandidate {
    player: Player;
    boardNumber: number;
    ticket: BingoTicket;
    daubed: Set<number>;
    winningCells: { row: number; col: number }[];
}

export class GameManager {
    public players: Player[] = [];
    public drawnNumbers: Set<number> = new Set();
    public recentWinners: WinnerRecord[] = [];
    public currentWinner: WinnerRecord | null = null;
    public currentWinners: WinnerRecord[] = [];
    public gameId: string = '';
    private allNumbers: number[] = [];
    public state: 'WAITING' | 'PLAYING' = 'WAITING';
    private gameLoopInterval: NodeJS.Timeout | null = null;
    private startTimeout: NodeJS.Timeout | null = null;
    private pendingWinners: WinnerCandidate[] = [];
    private resolutionTimeout: NodeJS.Timeout | null = null;
    
    // Auto-start Lobby Timer Variables
    public lobbyCountdown: number = 0;
    private lobbyInterval: NodeJS.Timeout | null = null;

    constructor(private bot: Bot) {}

    async selectBoards(userId: bigint, boardNumbers: number[], feePerBoard: number = 10): Promise<{ success: boolean; msg: string; boards: number[] }> {
        if (this.state !== 'WAITING') {
            return { success: false, msg: 'A game is already in progress. Please wait.', boards: [] };
        }
        if (!Array.isArray(boardNumbers) || boardNumbers.length === 0) {
            await this.removePlayer(userId, false);
            return { success: true, msg: 'Boards deselected and fee refunded.', boards: [] };
        }
        if (boardNumbers.length > 2) {
            return { success: false, msg: 'You can select up to 2 boards maximum.', boards: [] };
        }
        if (boardNumbers.length === 2 && boardNumbers[0] === boardNumbers[1]) {
            return { success: false, msg: 'Please choose two different boards.', boards: [] };
        }

        // Validate board numbers 1-500
        for (const bn of boardNumbers) {
            if (bn < 1 || bn > 500) {
                return { success: false, msg: 'Board numbers must be between 1 and 500.', boards: [] };
            }
            const takenByOther = this.players.find(p => p.userId !== userId && (p.cards ? p.cards.some(c => c.boardNumber === bn) : p.boardNumber === bn));
            if (takenByOther) {
                return { success: false, msg: `Board #${bn} is already taken by another player.`, boards: [] };
            }
        }

        const existingPlayer = this.players.find(p => p.userId === userId);
        const prevCount = existingPlayer ? (existingPlayer.cards?.length || 1) : 0;
        const newCount = boardNumbers.length;
        const countDiff = newCount - prevCount;

        if (countDiff > 0 && feePerBoard > 0) {
            const addFee = countDiff * feePerBoard;
            const res = await deductFee(userId, addFee);
            if (!res.success) {
                return {
                    success: false,
                    msg: `You need at least ${addFee} Birr to select ${countDiff === 1 ? 'an additional board' : 'these boards'}.`,
                    boards: existingPlayer && existingPlayer.cards ? existingPlayer.cards.map(c => c.boardNumber) : []
                };
            }
        } else if (countDiff < 0 && feePerBoard > 0) {
            // Refund unselected board
            const refundAmount = Math.abs(countDiff) * feePerBoard;
            try {
                await prisma.user.update({
                    where: { id: userId },
                    data: { balance: { increment: refundAmount } }
                });
            } catch (e) {}
        }

        const cards: PlayerCard[] = boardNumbers.map(bn => ({
            boardNumber: bn,
            ticket: generateTicket(bn),
            daubed: new Set<number>()
        }));

        if (existingPlayer) {
            existingPlayer.cards = cards;
            existingPlayer.boardNumber = cards[0].boardNumber;
            existingPlayer.ticket = cards[0].ticket;
            existingPlayer.daubed = cards[0].daubed;
            existingPlayer.fee = newCount * feePerBoard;
            existingPlayer.lastSeen = Date.now();
        } else {
            const user = await prisma.user.findUnique({ where: { id: userId } });
            this.players.push({
                userId,
                cards,
                ticket: cards[0].ticket,
                daubed: cards[0].daubed,
                boardNumber: cards[0].boardNumber,
                fee: newCount * feePerBoard,
                firstName: user?.firstName ?? undefined,
                username: user?.username ?? undefined,
                lastSeen: Date.now()
            });

            if (this.players.length >= 1 && !this.lobbyInterval) {
                this.startLobbyTimer();
            }
        }

        // If all 500 boards are taken, start the game right away
        const totalCards = this.players.reduce((sum, p) => sum + (p.cards?.length || 1), 0);
        if (totalCards >= 500) {
            setTimeout(() => this.startGame(), 1000);
        }

        return {
            success: true,
            msg: `Selected ${newCount} board${newCount > 1 ? 's' : ''}: ${boardNumbers.map(n => '#' + n).join(', ')}`,
            boards: boardNumbers
        };
    }

    async joinGame(userId: bigint, boardNumber?: number, fee: number = 10): Promise<{ success: boolean; msg: string; keyboard?: InlineKeyboard }> {
        if (boardNumber !== undefined) {
            const res = await this.selectBoards(userId, [boardNumber], fee);
            const p = this.players.find(p => p.userId === userId);
            return {
                success: res.success,
                msg: res.msg,
                keyboard: p ? createTicketKeyboard(p.ticket, p.daubed, userId) : undefined
            };
        }
        return { success: false, msg: 'Invalid board number' };
    }

    getBoards(): { number: number; taken: boolean }[] {
        const boards = [];
        for (let i = 1; i <= 500; i++) {
            const taken = this.players.some(p => p.cards ? p.cards.some(c => c.boardNumber === i) : p.boardNumber === i);
            boards.push({ number: i, taken });
        }
        return boards;
    }


    getPot(): number {
        return this.players.reduce((sum, p) => sum + p.fee, 0);
    }

    private startLobbyTimer() {
        this.lobbyCountdown = 30; // 30 seconds wait
        console.log(`[Game] Auto-start timer started for 30s (${this.players.length} player(s) in lobby)`);
        
        if (this.lobbyInterval) clearInterval(this.lobbyInterval);

        this.lobbyInterval = setInterval(async () => {
            this.lobbyCountdown -= 1;
            
            if (this.lobbyCountdown <= 0) {
                clearInterval(this.lobbyInterval!);
                this.lobbyInterval = null;
                this.lobbyCountdown = 0;
                
                if (this.players.length >= 1) {
                    console.log(`[Game] Lobby 30s timer expired! Auto-starting with ${this.players.length} player(s)`);
                    await this.startGame();
                } else {
                    console.log('[Game] Not enough players to auto-start.');
                    this.state = 'WAITING';
                }
            }
        }, 1000); // 1-second ticks for accurate 30-second countdown
    }

    setPlayerMessageId(userId: bigint, messageId: number) {
        const p = this.players.find(p => p.userId === userId);
        if (p) {
            p.ticketMessageId = messageId;
            console.log(`[Game] Saved messageId ${messageId} for user ${userId}`);
        }
    }

    // Mark a player as active (called on web polling / interactions)
    touch(userId: bigint) {
        const p = this.players.find(p => p.userId === userId);
        if (p) p.lastSeen = Date.now();
    }

    async forceReset(): Promise<{ success: boolean; msg: string }> {
        if (this.startTimeout) clearTimeout(this.startTimeout);
        if (this.gameLoopInterval) clearInterval(this.gameLoopInterval);
        if (this.lobbyInterval) clearInterval(this.lobbyInterval);
        if (this.resolutionTimeout) clearTimeout(this.resolutionTimeout);
        this.startTimeout = null;
        this.gameLoopInterval = null;
        this.lobbyInterval = null;
        this.resolutionTimeout = null;
        this.pendingWinners = [];
        this.lobbyCountdown = 0;
        this.drawnNumbers.clear();
        await this.refundAll();
        this.players = [];
        this.currentWinner = null;
        this.currentWinners = [];
        this.state = 'WAITING';
        this.gameId = '';
        return { success: true, msg: 'Game reset to waiting lobby.' };
    }

    // Explicitly leave the lobby before the game starts (fee is refunded).
    async leaveGame(userId: bigint): Promise<{ success: boolean; msg: string }> {
        if (this.state === 'PLAYING') {
            return { success: false, msg: 'A game is already in progress. You cannot leave now.' };
        }
        return this.removePlayer(userId, true);
    }

    // Auto-remove players who haven't been seen recently (closed the page/app) while waiting.
    async removeStalePlayers(maxIdleMs: number = 120000): Promise<number> {
        if (this.state !== 'WAITING') return 0;
        const now = Date.now();
        const stale = this.players.filter(p => now - p.lastSeen > maxIdleMs);
        let removed = 0;
        for (const p of stale) {
            const res = await this.removePlayer(p.userId, false);
            if (res.success) removed++;
        }
        if (removed > 0) console.log(`[Game] Removed ${removed} stale player(s) from lobby.`);
        return removed;
    }

    private async refundPlayer(p: Player) {
        if (p.fee > 0) {
            try {
                const bonusUsed = p.bonusUsed || 0;
                const balanceRefund = p.fee - bonusUsed;
                await prisma.user.update({
                    where: { id: p.userId },
                    data: {
                        ...(bonusUsed > 0 ? { bonus: { increment: bonusUsed } } : {}),
                        ...(balanceRefund > 0 ? { balance: { increment: balanceRefund } } : {})
                    }
                });
            } catch (e) {
                console.error('[Game] Error refunding player:', e);
            }
        }
    }

    private async refundAll() {
        for (const p of this.players) await this.refundPlayer(p);
    }

    private async removePlayer(userId: bigint, notifyLeaver: boolean): Promise<{ success: boolean; msg: string }> {
        const idx = this.players.findIndex(p => p.userId === userId);
        if (idx === -1) return { success: false, msg: 'You are not in this game.' };
        const [leaver] = this.players.splice(idx, 1);
        if (!leaver) return { success: false, msg: 'You are not in this game.' };

        await this.refundPlayer(leaver);

        const remaining = this.players.length;

        // Not enough players to ever start: refund everyone left and reset the lobby.
        if (remaining < 2) {
            if (this.lobbyInterval) {
                clearInterval(this.lobbyInterval);
                this.lobbyInterval = null;
            }
            this.lobbyCountdown = 0;
            await this.refundAll();
            for (const other of this.players) {
                await this.editTicketMessage(other, `😔 *Not Enough Players!*\n\nAnother player left the lobby.\n\nYour *${other.fee} Birr* entry fee has been refunded to your wallet.\n\nClick Play Bingo to try again.`);
            }
            this.players = [];
        } else {
            // Still enough players - keep the lobby alive and notify the rest.
            for (const other of this.players) {
                await this.editTicketMessage(other, `👥 *Players: ${this.players.length}*\n\nA player left the lobby. ${this.lobbyCountdown > 0 ? `⏳ Auto-starting in *${this.lobbyCountdown} seconds*...` : '⏳ Waiting for more players...'}\n\n👇 Your board:`);
            }
        }

        if (notifyLeaver) {
            try {
                if (leaver.ticketMessageId) {
                    await this.bot.api.editMessageText(
                        Number(leaver.userId),
                        leaver.ticketMessageId,
                        `👋 *You left the lobby.*\n\n💳 Entry fee refunded. You can re-join anytime.`
                    );
                }
            } catch (e) {}
        }

        return { success: true, msg: 'You left the game lobby. Entry fee refunded.' };
    }

    private async editTicketMessage(p: Player, text: string) {
        if (!p.ticketMessageId) return;
        try {
            await this.bot.api.editMessageText(
                Number(p.userId),
                p.ticketMessageId,
                text,
                {
                    parse_mode: 'Markdown',
                    reply_markup: createTicketKeyboard(p.ticket, p.daubed, p.userId),
                }
            );
        } catch (e: any) {
            console.error(`[Game] editTicketMessage failed for ${p.userId}:`, e?.message);
        }
    }

    async startGame() {
        if (this.state === 'PLAYING') {
            console.log('[Game] Already playing, ignoring startGame.');
            return;
        }
        if (this.players.length < 1) {
            console.log('[Game] At least 1 player is needed to start.');
            return;
        }

        // Clear lobby timer if someone forced a start manually
        if (this.lobbyInterval) {
            clearInterval(this.lobbyInterval);
            this.lobbyInterval = null;
            this.lobbyCountdown = 0;
        }

        console.log(`[Game] ✅ Starting with ${this.players.length} player(s)`);
        this.state = 'PLAYING';
        if (this.resolutionTimeout) {
            clearTimeout(this.resolutionTimeout);
            this.resolutionTimeout = null;
        }
        this.pendingWinners = [];
        this.currentWinner = null;
        this.currentWinners = [];
        this.gameId = Math.random().toString(36).slice(2, 10).toUpperCase();
        this.drawnNumbers.clear();
        this.allNumbers = Array.from({ length: 75 }, (_, i) => i + 1).sort(() => Math.random() - 0.5);
        const pot = this.getPot();

        // Step 1: Notify all players via ticket edit (guaranteed to work since we know ticketMessageId works)
        const startMsg = `🎮 *GAME IS STARTING!*\n\n👥 Players: ${this.players.length} | 💰 Pot: *${pot} Birr*\n\n⏳ First number drawing in 3 seconds...\n\n👇 Your board — tap numbers when called:`;
        for (const p of this.players) {
            p.isBlocked = false;
            if (p.cards) {
                for (const c of p.cards) c.isBlocked = false;
            }
            await this.editTicketMessage(p, startMsg);
        }

        // Step 2: Short delay then start drawing
        if (this.startTimeout) clearTimeout(this.startTimeout);
        this.startTimeout = setTimeout(async () => {
            await this.drawNumber();
            this.gameLoopInterval = setInterval(() => this.drawNumber(), 6000);
        }, 3000);
    }

    /**
     * Checks if drawing candidateNum would cause ANY active player card to achieve a winning pattern.
     * Used during draws 1-16 to ensure suspense builds naturally without an early win.
     */
    private wouldCauseWin(candidateNum: number): boolean {
        // A win requires at least 4 drawn numbers (3 + Free space)
        if (this.drawnNumbers.size < 3) return false;

        const simulatedDrawn = new Set(this.drawnNumbers);
        simulatedDrawn.add(candidateNum);

        for (const p of this.players) {
            const cards = p.cards && p.cards.length > 0
                ? p.cards
                : [{ boardNumber: p.boardNumber || 0, ticket: p.ticket, daubed: p.daubed }];

            for (const card of cards) {
                // Check if candidateNum is even on this card
                let hasNum = false;
                for (let r = 0; r < 5; r++) {
                    for (let c = 0; c < 5; c++) {
                        if (card.ticket[r][c] === candidateNum) {
                            hasNum = true;
                            break;
                        }
                    }
                    if (hasNum) break;
                }

                if (hasNum) {
                    const winRes = checkWinDetails(card.ticket, simulatedDrawn);
                    if (winRes.hasWon) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    /**
     * Counts how many distinct players would achieve a winning pattern if candidateNum is drawn.
     */
    private countSimulatedWinners(candidateNum: number): number {
        const simulatedDrawn = new Set(this.drawnNumbers);
        simulatedDrawn.add(candidateNum);
        let winningPlayerCount = 0;
        for (const p of this.players) {
            const cards = p.cards && p.cards.length > 0
                ? p.cards
                : [{ boardNumber: p.boardNumber || 0, ticket: p.ticket, daubed: p.daubed }];
            let playerWon = false;
            for (const card of cards) {
                if (checkWinDetails(card.ticket, simulatedDrawn).hasWon) {
                    playerWon = true;
                    break;
                }
            }
            if (playerWon) winningPlayerCount++;
        }
        return winningPlayerCount;
    }

    private async drawNumber() {
        if (this.allNumbers.length === 0 || this.state !== 'PLAYING') {
            clearInterval(this.gameLoopInterval!);
            await this.endGame(null);
            return;
        }

        let num: number;
        // For draws 1-14 (size < 14), select a safe ball that does not complete a winning line for anyone
        if (this.drawnNumbers.size < 14 && this.players.length > 0) {
            const safeIndices: number[] = [];
            for (let i = 0; i < this.allNumbers.length; i++) {
                if (!this.wouldCauseWin(this.allNumbers[i])) {
                    safeIndices.push(i);
                }
            }

            if (safeIndices.length > 0) {
                const pickIndex = safeIndices[Math.floor(Math.random() * safeIndices.length)];
                num = this.allNumbers.splice(pickIndex, 1)[0];
            } else {
                num = this.allNumbers.pop()!;
            }
        } else if (this.players.length > 0) {
            // Draw 15+: select candidate balls that cause <= 2 winners (strictly never 3 or more)
            const validIndices: number[] = [];
            for (let i = 0; i < this.allNumbers.length; i++) {
                if (this.countSimulatedWinners(this.allNumbers[i]) <= 2) {
                    validIndices.push(i);
                }
            }

            if (validIndices.length > 0) {
                const pickIndex = validIndices[Math.floor(Math.random() * validIndices.length)];
                num = this.allNumbers.splice(pickIndex, 1)[0];
            } else {
                num = this.allNumbers.pop()!;
            }
        } else {
            // Draw 17+: unrestricted random draw if no active players
            num = this.allNumbers.pop()!;
        }

        this.drawnNumbers.add(num);
        const numName = getNumberName(num);
        const emoji = getColumnEmoji(num);
        const allDrawn = Array.from(this.drawnNumbers).map(n => getNumberName(n));
        const recent = allDrawn.slice(-10).join('  ');

        console.log(`[Game] Drawing: ${numName} (#${this.drawnNumbers.size}) | Players: ${this.players.length}`);

        // Big, bold drawn number with column color
        const text =
            `${emoji} *${numName.replace('-', ' — ')}* ${emoji}\n` +
            `━━━━━━━━━━━━━━━━━━━\n` +
            `📜 *Drawn:* ${recent}\n` +
            `━━━━━━━━━━━━━━━━━━━\n` +
            `👇 Tap the number on your board if you have it!`;

        for (const p of this.players) {
            await this.editTicketMessage(p, text);
        }
    }

    async claimBingo(userId: bigint): Promise<{
        success: boolean;
        msg: string;
        blocked?: boolean;
        late?: boolean;
        winnerName?: string;
        boardNumber?: number;
        winnerTicket?: BingoTicket;
        winnerDaubed?: number[];
        winningCells?: { row: number; col: number }[];
        drawnNumbers?: number[];
        winners?: WinnerRecord[];
    }> {
        const p = this.players.find(p => p.userId === userId);
        if (!p) return { success: false, msg: 'Player not found.' };

        if (this.state !== 'PLAYING') {
            return { success: false, msg: 'No game is currently in progress.' };
        }

        if (p.isBlocked) {
            return { success: false, blocked: true, msg: 'Your cartella is blocked for this game.' };
        }

        const currentBall = Array.from(this.drawnNumbers).at(-1);
        if (currentBall === undefined) {
            p.isBlocked = true;
            if (p.cards) {
                for (const c of p.cards) c.isBlocked = true;
            }
            return {
                success: false,
                blocked: true,
                msg: 'False Bingo! No numbers have been drawn yet. Cartella blocked for the current game.'
            };
        }

        const cards = p.cards && p.cards.length > 0 ? p.cards : [{ boardNumber: p.boardNumber || 0, ticket: p.ticket, daubed: p.daubed }];
        let winningCard: WinnerCandidate | null = null;
        let hasStaleLine = false;

        for (const card of cards) {
            const winRes = checkWinFreshness(card.ticket, this.drawnNumbers, currentBall);
            if (winRes.hasWon) {
                if (winRes.isFresh) {
                    winningCard = {
                        player: p,
                        boardNumber: card.boardNumber,
                        ticket: card.ticket,
                        daubed: new Set([...card.daubed, ...Array.from(this.drawnNumbers)]),
                        winningCells: winRes.winningCells
                    };
                    break;
                } else {
                    hasStaleLine = true;
                }
            }
        }

        if (!winningCard) {
            p.isBlocked = true;
            if (p.cards) {
                for (const c of p.cards) c.isBlocked = true;
            }
            const msg = hasStaleLine
                ? 'Late Bingo! You missed your turn when your winning number was called. Cartella blocked for the current game.'
                : 'False Bingo! You do not have a winning pattern yet. Cartella blocked for the current game.';
            return {
                success: false,
                blocked: true,
                late: hasStaleLine,
                msg
            };
        }

        // If player already claimed in pending pool
        if (this.pendingWinners.some(w => w.player.userId === userId)) {
            return {
                success: true,
                msg: 'BINGO!',
                winnerName: p.firstName || 'Player',
                boardNumber: winningCard.boardNumber,
                winnerTicket: winningCard.ticket,
                winnerDaubed: Array.from(winningCard.daubed),
                winningCells: winningCard.winningCells,
                drawnNumbers: Array.from(this.drawnNumbers),
                winners: this.currentWinners
            };
        }

        // Add player to pending winners (max 2)
        if (this.pendingWinners.length < 2) {
            this.pendingWinners.push(winningCard);
        }

        // Pause ball drawing loop while resolving winner(s)
        if (this.gameLoopInterval) {
            clearInterval(this.gameLoopInterval);
            this.gameLoopInterval = null;
        }

        // If we reached 2 winners, end game immediately and split prize
        if (this.pendingWinners.length >= 2) {
            if (this.resolutionTimeout) {
                clearTimeout(this.resolutionTimeout);
                this.resolutionTimeout = null;
            }
            const toResolve = [...this.pendingWinners];
            this.pendingWinners = [];
            await this.endGame(toResolve);
            return {
                success: true,
                msg: 'BINGO!',
                winnerName: p.firstName || 'Player',
                boardNumber: winningCard.boardNumber,
                winnerTicket: winningCard.ticket,
                winnerDaubed: Array.from(winningCard.daubed),
                winningCells: winningCard.winningCells,
                drawnNumbers: Array.from(this.drawnNumbers),
                winners: this.currentWinners
            };
        }

        // First winner: start a 2.5s window for a second simultaneous winner
        if (!this.resolutionTimeout) {
            this.resolutionTimeout = setTimeout(async () => {
                this.resolutionTimeout = null;
                const toResolve = [...this.pendingWinners];
                this.pendingWinners = [];
                await this.endGame(toResolve);
            }, 2500);
        }

        return {
            success: true,
            msg: 'BINGO!',
            winnerName: p.firstName || 'Player',
            boardNumber: winningCard.boardNumber,
            winnerTicket: winningCard.ticket,
            winnerDaubed: Array.from(winningCard.daubed),
            winningCells: winningCard.winningCells,
            drawnNumbers: Array.from(this.drawnNumbers)
        };
    }

    async daubNumber(userId: bigint, num: number): Promise<{
        success: boolean;
        msg?: string;
        keyboard?: InlineKeyboard;
    }> {
        const p = this.players.find(p => p.userId === userId);
        if (!p) return { success: false, msg: 'You are not in the current game.' };
        p.lastSeen = Date.now();

        if (p.isBlocked) {
            return { success: false, msg: 'Cartella is blocked for this game.' };
        }

        if (!this.drawnNumbers.has(num)) {
            return { success: false, msg: `⛔ ${getNumberName(num)} has not been drawn yet!` };
        }

        p.daubed.add(num);
        const cards = p.cards && p.cards.length > 0 ? p.cards : [{ boardNumber: p.boardNumber || 0, ticket: p.ticket, daubed: p.daubed }];
        for (const card of cards) {
            let hasNum = false;
            for (let r = 0; r < 5; r++) {
                for (let c = 0; c < 5; c++) {
                    if (card.ticket[r][c] === num) hasNum = true;
                }
            }
            if (hasNum) {
                card.daubed.add(num);
            }
        }

        return { success: true, keyboard: createTicketKeyboard(p.ticket, p.daubed, p.userId) };
    }

    private async endGame(winners: WinnerCandidate[] | null) {
        this.state = 'WAITING';
        if (this.resolutionTimeout) {
            clearTimeout(this.resolutionTimeout);
            this.resolutionTimeout = null;
        }
        this.pendingWinners = [];
        const pot = this.getPot();

        if (winners && winners.length > 0) {
            const totalWinnerPayout = Math.floor(pot * 0.8);
            const houseProfit = pot - totalWinnerPayout;
            const winnerCount = Math.min(winners.length, 2);
            const payoutPerWinner = Math.floor(totalWinnerPayout / winnerCount);

            // Log house income
            try {
                await prisma.houseIncome.create({
                    data: {
                        gameType: 'bingo',
                        playerCount: this.players.length,
                        totalCollected: pot,
                        winnerPayout: totalWinnerPayout,
                        houseProfit: houseProfit,
                        winnerId: winners[0].player.userId
                    }
                });
            } catch (e) {
                console.error('Failed to log HouseIncome:', e);
            }

            // Credit winners
            for (let i = 0; i < winnerCount; i++) {
                const w = winners[i];
                try {
                    await prisma.user.update({
                        where: { id: w.player.userId },
                        data: { balance: { increment: payoutPerWinner } }
                    });
                } catch (e) {
                    console.error(`Failed to credit winner ${w.player.userId}:`, e);
                }
            }

            this.currentWinners = winners.slice(0, 2).map(w => ({
                userId: w.player.userId.toString(),
                firstName: w.player.firstName || 'Player',
                username: w.player.username ?? null,
                amount: payoutPerWinner,
                boardNumber: w.boardNumber,
                ticket: w.ticket,
                daubed: Array.from(w.daubed),
                winningCells: w.winningCells || [],
                at: new Date().toISOString()
            }));
            this.currentWinner = this.currentWinners[0] || null;

            for (const cw of this.currentWinners) {
                this.recentWinners.unshift(cw);
            }
            if (this.recentWinners.length > 10) {
                this.recentWinners = this.recentWinners.slice(0, 10);
            }

            const winnerUserIds = new Set(this.currentWinners.map(w => w.userId));
            for (const p of this.players) {
                const isWinner = winnerUserIds.has(p.userId.toString());

                // Record game history
                try {
                    await prisma.gameHistory.create({
                        data: {
                            userId: p.userId,
                            gameType: 'bingo',
                            bet: p.fee,
                            payout: isWinner ? payoutPerWinner : 0,
                            result: isWinner ? 'WON' : 'LOST'
                        }
                    });
                } catch (e) {}

                if (isWinner) {
                    try { await this.bot.api.sendMessage(Number(p.userId), '🎉'); } catch (e) {}
                    try { await this.bot.api.sendMessage(Number(p.userId), '🎊'); } catch (e) {}
                }

                const msg = isWinner
                    ? (winnerCount > 1
                        ? `🏆 *BINGO! (SHARED JACKPOT)* 🏆\n\n👥 2 players got Bingo!\n💰 *${payoutPerWinner} Birr* (equal share) has been added to your wallet!\n\nCongratulations!`
                        : `🏆 *BINGO!!! YOU WON THE JACKPOT!* 🏆\n\n💰 *${totalWinnerPayout} Birr* has been instantly added to your wallet!\n\nCongratulations!`)
                    : `🏁 *Game Over!*\n\n${winnerCount > 1 ? 'Two players shared the Bingo jackpot' : 'Someone got Bingo'}!\nBetter luck next time!\n\nClick Play Bingo to try again.`;

                await this.editTicketMessage(p, msg);
            }
        } else {
            this.currentWinners = [];
            this.currentWinner = null;
            for (const p of this.players) {
                try {
                    await prisma.gameHistory.create({
                        data: {
                            userId: p.userId,
                            gameType: 'bingo',
                            bet: p.fee,
                            payout: 0,
                            result: 'NO_WINNER'
                        }
                    });
                } catch (e) {}
                await this.editTicketMessage(p, `🏁 *Game Over!*\n\nAll 75 numbers drawn — no winner this round.`);
            }
        }

        console.log(`[Game] Game ended (${winners ? winners.length : 0} winner(s)), lobby reset.`);
        this.players = [];
        this.drawnNumbers.clear();

        // Clear lobby interval just in case
        if (this.lobbyInterval) {
            clearInterval(this.lobbyInterval);
            this.lobbyInterval = null;
            this.lobbyCountdown = 0;
        }
    }
}
