import { Bot, InlineKeyboard } from 'grammy';
import { generateTicket, createTicketKeyboard, checkWin, checkWinDetails, checkWinFreshness, getNumberName, getColumnEmoji, BingoTicket } from './bingo';
import { prisma } from '../db';
import { deductFee } from '../bonus';
import { getBoardShuffleSeed, onGameCompletedCheckAutoReshuffle } from '../settings';

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
    withdrawableUsed?: number;
    firstName?: string;
    username?: string;
    lastSeen: number;
    isBlocked?: boolean;
    isBot?: boolean;
    autoPlay?: boolean;
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
    winningNumber?: number;
    fee?: number;
    room?: number;
    at: string;
}

export interface WinnerCandidate {
    player: Player;
    boardNumber: number;
    ticket: BingoTicket;
    daubed: Set<number>;
    winningCells: { row: number; col: number }[];
    winningNumber?: number;
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
    public minCallToWin: number = 15;
    private minCallOffset: number | null = null;
    public winnerSelection: 'natural' | 'real_players' | 'house' = 'natural';
    private gameLoopInterval: NodeJS.Timeout | null = null;
    private gameLoopTimeout: NodeJS.Timeout | null = null;
    private gameStartTime: number = 0;
    private startTimeout: NodeJS.Timeout | null = null;
    private pendingWinners: WinnerCandidate[] = [];
    private resolutionTimeout: NodeJS.Timeout | null = null;
    private isDrawing: boolean = false;
    private sseClients: Set<{ res: any; userId: bigint }> = new Set();
    private heartbeatInterval: NodeJS.Timeout | null = null;
    
    // Auto-start Lobby Timer Variables
    public lobbyCountdown: number = 0;
    private lobbyInterval: NodeJS.Timeout | null = null;
    private lobbyResetTimeout: NodeJS.Timeout | null = null;
    private userLocks: Map<string, Promise<any>> = new Map();
    public pendingReservations: Map<number, string> = new Map();

    private async runWithUserLock<T>(userId: bigint, fn: () => Promise<T>): Promise<T> {
        const key = userId.toString();
        const currentLock = this.userLocks.get(key) || Promise.resolve();
        let releaseLock: () => void;
        const nextLock = new Promise<void>((resolve) => { releaseLock = resolve; });
        this.userLocks.set(key, currentLock.then(() => nextLock).catch(() => nextLock));

        try {
            await currentLock;
            return await fn();
        } finally {
            releaseLock!();
            if (this.userLocks.get(key) === nextLock) {
                this.userLocks.delete(key);
            }
        }
    }

    public sanitizePlayers(): void {
        const seen = new Set<string>();
        const unique: Player[] = [];
        for (const p of this.players) {
            const idStr = p.userId.toString();
            if (!seen.has(idStr)) {
                seen.add(idStr);
                unique.push(p);
            } else {
                console.warn(`[Game] Pruned duplicate entry for user ${idStr}`);
            }
        }
        this.players = unique;
    }

    public getPlayer(userId: bigint): Player | undefined {
        const idStr = userId.toString();
        return this.players.find(p => p.userId.toString() === idStr);
    }

    constructor(private bot: Bot, public botService?: any, public fee: number = 10, public room: number = 1) {
        this.heartbeatInterval = setInterval(() => {
            if (this.sseClients.size === 0) return;
            const toDelete: Array<{ res: any; userId: bigint }> = [];
            for (const client of this.sseClients) {
                try {
                    client.res.write(': ping\n\n');
                    if (typeof client.res.flush === 'function') client.res.flush();
                } catch (e) {
                    toDelete.push(client);
                }
            }
            for (const dead of toDelete) {
                this.sseClients.delete(dead);
            }
        }, 15000).unref();
    }

    addSSEClient(userId: bigint, res: any, initialData?: any) {
        const client = { res, userId };
        this.sseClients.add(client);

        res.on('close', () => {
            this.sseClients.delete(client);
        });

        if (initialData) {
            try {
                res.write(`event: init\ndata: ${JSON.stringify(initialData)}\n\n`);
                if (typeof res.flush === 'function') res.flush();
            } catch (e) {}
        }
    }

    private sseThrottles: Map<string, { timer: NodeJS.Timeout | null; latestProducer: (() => any) | null }> = new Map();

    broadcastSSE(event: string, data: any) {
        if (this.sseClients.size === 0) return;
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        const toDelete: Array<{ res: any; userId: bigint }> = [];
        for (const client of this.sseClients) {
            try {
                client.res.write(payload);
                if (typeof client.res.flush === 'function') client.res.flush();
            } catch (e) {
                toDelete.push(client);
            }
        }
        for (const dead of toDelete) {
            this.sseClients.delete(dead);
        }
    }

    broadcastSSEThrottled(event: string, dataProducer: () => any, minIntervalMs: number = 400) {
        if (this.sseClients.size === 0) return;
        let entry = this.sseThrottles.get(event);
        if (!entry) {
            entry = { timer: null, latestProducer: null };
            this.sseThrottles.set(event, entry);
        }
        entry.latestProducer = dataProducer;
        if (!entry.timer) {
            this.broadcastSSE(event, dataProducer());
            entry.timer = setTimeout(() => {
                if (entry) {
                    entry.timer = null;
                    if (entry.latestProducer) {
                        const data = entry.latestProducer();
                        entry.latestProducer = null;
                        this.broadcastSSE(event, data);
                    }
                }
            }, minIntervalMs).unref();
        }
    }

    async selectBoards(userId: bigint, boardNumbers: number[], feePerBoard: number = 10, autoPlay?: boolean): Promise<{ success: boolean; msg: string; boards: number[] }> {
        return this.runWithUserLock(userId, async () => {
            if (this.lobbyResetTimeout) {
                clearTimeout(this.lobbyResetTimeout);
                this.lobbyResetTimeout = null;
            }
            const userIdStr = userId.toString();
            if (this.state !== 'WAITING') {
                const existingPlayer = this.players.find(p => p.userId.toString() === userIdStr);
                const existingBoards = existingPlayer && existingPlayer.cards ? existingPlayer.cards.map(c => c.boardNumber) : (existingPlayer?.boardNumber ? [existingPlayer.boardNumber] : []);
                return { success: false, msg: 'A game is already in progress. Please wait.', boards: existingBoards };
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
                const takenByOther = this.players.find(p => p.userId.toString() !== userIdStr && (p.cards ? p.cards.some(c => c.boardNumber === bn) : p.boardNumber === bn));
                const reservedByOther = this.pendingReservations.get(bn);
                if (takenByOther || (reservedByOther && reservedByOther !== userIdStr)) {
                    return { success: false, msg: `Board #${bn} is already taken by another player.`, boards: [] };
                }
            }

            // Pre-reserve boards in memory atomically so no other concurrent request can claim them during DB async query
            for (const bn of boardNumbers) {
                this.pendingReservations.set(bn, userIdStr);
            }

            try {
                // Clean up any potential duplicate player records before diffing
                this.sanitizePlayers();

                const existingPlayer = this.players.find(p => p.userId.toString() === userIdStr);
                const prevCount = existingPlayer ? (existingPlayer.cards?.length || 1) : 0;
                const newCount = boardNumbers.length;
                const countDiff = newCount - prevCount;

                let additionalBonusUsed = 0;
                let additionalWithdrawableUsed = 0;
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
                    additionalBonusUsed = res.bonusUsed;
                    additionalWithdrawableUsed = res.withdrawableUsed;
                } else if (countDiff < 0 && feePerBoard > 0) {
                    // Refund unselected board - restore bonus first if bonus was consumed
                    const refundAmount = Math.abs(countDiff) * feePerBoard;
                    const currentBonusUsed = existingPlayer?.bonusUsed || 0;
                    const bonusRefund = Math.min(currentBonusUsed, refundAmount);
                    const balanceRefund = refundAmount - bonusRefund;

                    const currentWithdrawableUsed = existingPlayer?.withdrawableUsed || 0;
                    const withdrawableRefund = Math.min(currentWithdrawableUsed, balanceRefund);

                    if (existingPlayer) {
                        existingPlayer.bonusUsed = Math.max(0, currentBonusUsed - bonusRefund);
                        existingPlayer.withdrawableUsed = Math.max(0, currentWithdrawableUsed - withdrawableRefund);
                    }

                    try {
                        await prisma.user.update({
                            where: { id: userId },
                            data: {
                                ...(balanceRefund > 0 ? { balance: { increment: balanceRefund } } : {}),
                                ...(withdrawableRefund > 0 ? { withdrawableBalance: { increment: withdrawableRefund } } : {}),
                                ...(bonusRefund > 0 ? { bonus: { increment: bonusRefund } } : {})
                            }
                        });
                    } catch (e) {}
                }

                // Defensive check: If room transitioned to PLAYING during async fee DB calls
                if (this.state !== 'WAITING') {
                    if (countDiff > 0 && feePerBoard > 0) {
                        const addFee = countDiff * feePerBoard;
                        try {
                            await prisma.user.update({
                                where: { id: userId },
                                data: {
                                    ...(additionalBonusUsed > 0 ? { bonus: { increment: additionalBonusUsed } } : {}),
                                    ...((addFee - additionalBonusUsed) > 0 ? { balance: { increment: addFee - additionalBonusUsed } } : {}),
                                    ...(additionalWithdrawableUsed > 0 ? { withdrawableBalance: { increment: additionalWithdrawableUsed } } : {})
                                }
                            });
                        } catch (e) {
                            console.error('[Game] Error refunding fee after late race condition:', e);
                        }
                    }
                    const existingPlayer = this.players.find(p => p.userId.toString() === userIdStr);
                    const existingBoards = existingPlayer && existingPlayer.cards ? existingPlayer.cards.map(c => c.boardNumber) : (existingPlayer?.boardNumber ? [existingPlayer.boardNumber] : []);
                    return { success: false, msg: 'A game is already in progress. Please wait.', boards: existingBoards };
                }

                const cards: PlayerCard[] = boardNumbers.map(bn => ({
                    boardNumber: bn,
                    ticket: generateTicket(bn, getBoardShuffleSeed()),
                    daubed: new Set<number>()
                }));

                // Re-check after async database calls within lock
                const activePlayer = this.players.find(p => p.userId.toString() === userIdStr);

                if (activePlayer) {
                    activePlayer.cards = cards;
                    activePlayer.boardNumber = cards[0].boardNumber;
                    activePlayer.ticket = cards[0].ticket;
                    activePlayer.daubed = cards[0].daubed;
                    activePlayer.fee = newCount * feePerBoard;
                    activePlayer.bonusUsed = (activePlayer.bonusUsed || 0) + additionalBonusUsed;
                    activePlayer.withdrawableUsed = (activePlayer.withdrawableUsed || 0) + additionalWithdrawableUsed;
                    activePlayer.lastSeen = Date.now();
                    if (autoPlay !== undefined) {
                        activePlayer.autoPlay = autoPlay;
                    }
                } else {
                    const user = await prisma.user.findUnique({ where: { id: userId } });
                    this.players.push({
                        userId,
                        cards,
                        ticket: cards[0].ticket,
                        daubed: cards[0].daubed,
                        boardNumber: cards[0].boardNumber,
                        fee: newCount * feePerBoard,
                        bonusUsed: additionalBonusUsed,
                        withdrawableUsed: additionalWithdrawableUsed,
                        firstName: user?.firstName ?? undefined,
                        username: user?.username ?? undefined,
                        lastSeen: Date.now(),
                        autoPlay: autoPlay ?? false
                    });

                    if (this.players.length >= 1 && !this.lobbyInterval) {
                        this.startLobbyTimer();
                    }
                }

                // Defensively ensure no duplicate entries ever persist in memory
                this.sanitizePlayers();

                // Notify bot service to evaluate auto-fill if needed
                this.botService?.onRoomUpdated(this, this.fee, this.room);

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
            } finally {
                for (const bn of boardNumbers) {
                    if (this.pendingReservations.get(bn) === userIdStr) {
                        this.pendingReservations.delete(bn);
                    }
                }
            }
        });
    }

    async joinGame(userId: bigint, boardNumber?: number, fee: number = 10): Promise<{ success: boolean; msg: string; keyboard?: InlineKeyboard }> {
        if (boardNumber !== undefined) {
            const res = await this.selectBoards(userId, [boardNumber], fee);
            const p = this.getPlayer(userId);
            return {
                success: res.success,
                msg: res.msg,
                keyboard: p ? createTicketKeyboard(p.ticket, p.daubed, userId) : undefined
            };
        }
        return { success: false, msg: 'Invalid board number' };
    }

    getTakenBoards(): number[] {
        this.sanitizePlayers();
        const takenSet = new Set<number>();
        for (const p of this.players) {
            if (p.cards && p.cards.length > 0) {
                for (const c of p.cards) takenSet.add(c.boardNumber);
            } else if (p.boardNumber) {
                takenSet.add(p.boardNumber);
            }
        }
        for (const [bn] of this.pendingReservations) {
            takenSet.add(bn);
        }
        return Array.from(takenSet);
    }

    getBoards(): { number: number; taken: boolean }[] {
        this.sanitizePlayers();
        const takenSet = new Set<number>();
        for (const p of this.players) {
            if (p.cards && p.cards.length > 0) {
                for (const c of p.cards) takenSet.add(c.boardNumber);
            } else if (p.boardNumber) {
                takenSet.add(p.boardNumber);
            }
        }
        for (const [bn] of this.pendingReservations) {
            takenSet.add(bn);
        }

        const boards = new Array(500);
        for (let i = 1; i <= 500; i++) {
            boards[i - 1] = { number: i, taken: takenSet.has(i) };
        }
        return boards;
    }


    getTotalBoards(): number {
        this.sanitizePlayers();
        return this.players.reduce((sum, p) => sum + (p.cards?.length || 1), 0);
    }

    getPot(): number {
        this.sanitizePlayers();
        return this.players.reduce((sum, p) => sum + p.fee, 0);
    }

    public startLobbyTimer() {
        this.lobbyCountdown = 30; // 30 seconds wait
        console.log(`[Game] Auto-start timer started for 30s (${this.players.length} player(s), ${this.getTotalBoards()} board(s) in lobby)`);
        
        if (this.lobbyInterval) clearInterval(this.lobbyInterval);

        this.lobbyInterval = setInterval(async () => {
            this.lobbyCountdown -= 1;

            // Periodically evict any players who closed the app or stopped polling
            if (this.lobbyCountdown > 0 && this.lobbyCountdown % 5 === 0) {
                await this.removeStalePlayers();
            }

            this.broadcastSSE('lobby', {
                lobbyCountdown: this.lobbyCountdown,
                playerCount: this.players.length,
                boardCount: this.getTotalBoards(),
                pot: this.getPot(),
                gameState: this.state
            });
            
            if (this.lobbyCountdown <= 0) {
                clearInterval(this.lobbyInterval!);
                this.lobbyInterval = null;
                this.lobbyCountdown = 0;
                
                // Pre-game verification sweep: evict anyone who genuinely abandoned the lobby
                await this.removeStalePlayers();

                if (this.players.length >= 1) {
                    console.log(`[Game] Lobby auto-starting with ${this.players.length} active player(s) (${this.getTotalBoards()} boards)`);
                    await this.startGame();
                } else {
                    console.log('[Game] No players in lobby. Recycling lobby countdown.');
                    this.state = 'WAITING';
                    await this.resetToLobby();
                }
            }
        }, 1000).unref(); // 1-second ticks for accurate 30-second countdown (unref'd to avoid hanging tests/shutdown)
    }

    setPlayerMessageId(userId: bigint, messageId: number) {
        const p = this.getPlayer(userId);
        if (p) {
            p.ticketMessageId = messageId;
            console.log(`[Game] Saved messageId ${messageId} for user ${userId}`);
        }
    }

    // Mark a player as active (called on web polling / interactions)
    touch(userId: bigint) {
        const idStr = userId.toString();
        for (const p of this.players) {
            if (p.userId.toString() === idStr) p.lastSeen = Date.now();
        }
    }

    // Toggle or set Auto-Play mode for a player
    setAutoPlay(userId: bigint, enabled: boolean): boolean {
        const idStr = userId.toString();
        const p = this.players.find(pl => pl.userId.toString() === idStr);
        if (p) {
            p.autoPlay = enabled;
            p.lastSeen = Date.now();
            return true;
        }
        return false;
    }

    async forceReset(): Promise<{ success: boolean; msg: string }> {
        if (this.startTimeout) clearTimeout(this.startTimeout);
        if (this.gameLoopInterval) clearInterval(this.gameLoopInterval);
        if (this.gameLoopTimeout) clearTimeout(this.gameLoopTimeout);
        if (this.lobbyInterval) clearInterval(this.lobbyInterval);
        if (this.resolutionTimeout) clearTimeout(this.resolutionTimeout);
        if (this.lobbyResetTimeout) clearTimeout(this.lobbyResetTimeout);
        this.startTimeout = null;
        this.gameLoopInterval = null;
        this.gameLoopTimeout = null;
        this.lobbyInterval = null;
        this.resolutionTimeout = null;
        this.lobbyResetTimeout = null;
        this.pendingWinners = [];
        this.pendingReservations.clear();
        this.lobbyCountdown = 0;
        this.drawnNumbers.clear();
        this.minCallOffset = null;
        await this.refundAll();
        this.players = [];
        this.currentWinner = null;
        this.currentWinners = [];
        this.state = 'WAITING';
        this.gameId = '';
        this.botService?.onGameEnded(this.fee, this.room);
        for (const entry of this.sseThrottles.values()) {
            if (entry.timer) clearTimeout(entry.timer);
        }
        this.sseThrottles.clear();
        this.broadcastSSE('reset', { msg: 'Game reset to waiting lobby.' });
        return { success: true, msg: 'Game reset to waiting lobby.' };
    }

    public async resetToLobby() {
        if (this.lobbyResetTimeout) {
            clearTimeout(this.lobbyResetTimeout);
            this.lobbyResetTimeout = null;
        }
        if (this.state === 'PLAYING') return;

        console.log(`[Game] Resetting room (fee ${this.fee}, room ${this.room}) to WAITING lobby.`);
        this.state = 'WAITING';
        this.players = [];
        this.pendingReservations.clear();
        this.drawnNumbers.clear();
        this.minCallOffset = null;
        this.gameId = '';
        if (this.gameLoopInterval) {
            clearInterval(this.gameLoopInterval);
            this.gameLoopInterval = null;
        }
        if (this.gameLoopTimeout) {
            clearTimeout(this.gameLoopTimeout);
            this.gameLoopTimeout = null;
        }
        if (this.startTimeout) {
            clearTimeout(this.startTimeout);
            this.startTimeout = null;
        }
        if (this.resolutionTimeout) {
            clearTimeout(this.resolutionTimeout);
            this.resolutionTimeout = null;
        }
        this.pendingWinners = [];

        // Start 30s lobby countdown
        this.startLobbyTimer();

        // Seed baseline bots if bot service is enabled
        if (this.botService) {
            await this.botService.onLobbyOpened(this, this.fee, this.room);
        }

        // Broadcast updated state to all connected clients
        this.broadcastSSE('lobby', {
            lobbyCountdown: this.lobbyCountdown,
            playerCount: this.players.length,
            boardCount: this.getTotalBoards(),
            pot: this.getPot(),
            gameState: this.state
        });
        this.broadcastSSE('boards', {
            boards: this.getBoards(),
            players: this.players.length,
            boardCount: this.getTotalBoards(),
            pot: this.getPot(),
            shuffleSeed: getBoardShuffleSeed()
        });
    }

    // Explicitly leave the lobby before the game starts (fee is refunded).
    async leaveGame(userId: bigint): Promise<{ success: boolean; msg: string }> {
        return this.runWithUserLock(userId, async () => {
            if (this.state === 'PLAYING') {
                return { success: false, msg: 'A game is already in progress. You cannot leave now.' };
            }
            return this.removePlayer(userId, true);
        });
    }

    // Auto-remove players who haven't been seen recently (closed the page/app) while waiting.
    async removeStalePlayers(maxIdleMs: number = 90000): Promise<number> {
        if (this.state !== 'WAITING') return 0;
        const now = Date.now();
        // Ignore virtual bots for idle stale sweeps
        const stale = this.players.filter(p => !p.isBot && now - p.lastSeen > maxIdleMs);
        let removed = 0;
        for (const p of stale) {
            const res = await this.removePlayer(p.userId, false);
            if (res.success) removed++;
        }
        if (removed > 0) {
            console.log(`[Game] Removed ${removed} stale player(s) from lobby.`);
            if (this.players.length === 0 && this.lobbyInterval) {
                clearInterval(this.lobbyInterval);
                this.lobbyInterval = null;
                this.lobbyCountdown = 0;
            }
            this.broadcastSSE('lobby', {
                lobbyCountdown: this.lobbyCountdown,
                playerCount: this.players.length,
                boardCount: this.getTotalBoards(),
                pot: this.getPot(),
                gameState: this.state
            });
            this.broadcastSSE('boards', {
                boards: this.getBoards(),
                players: this.players.length,
                boardCount: this.getTotalBoards(),
                pot: this.getPot(),
                shuffleSeed: getBoardShuffleSeed()
            });
        }
        return removed;
    }

    private async refundPlayer(p: Player) {
        if (p.isBot) return; // Virtual bots have no database wallet
        if (p.fee > 0) {
            try {
                const bonusUsed = p.bonusUsed || 0;
                const balanceRefund = p.fee - bonusUsed;
                const withdrawableRefund = Math.min(p.withdrawableUsed || 0, balanceRefund);
                await prisma.user.update({
                    where: { id: p.userId },
                    data: {
                        ...(bonusUsed > 0 ? { bonus: { increment: bonusUsed } } : {}),
                        ...(balanceRefund > 0 ? { balance: { increment: balanceRefund } } : {}),
                        ...(withdrawableRefund > 0 ? { withdrawableBalance: { increment: withdrawableRefund } } : {})
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
        const idStr = userId.toString();
        for (const [bn, uid] of this.pendingReservations.entries()) {
            if (uid === idStr) this.pendingReservations.delete(bn);
        }
        const toRemove = this.players.filter(p => p.userId.toString() === idStr);
        if (toRemove.length === 0) return { success: false, msg: 'You are not in this game.' };

        this.players = this.players.filter(p => p.userId.toString() !== idStr);

        for (const leaver of toRemove) {
            await this.refundPlayer(leaver);
        }

        const leaver = toRemove[0];

        if (this.players.length === 0) {
            if (this.lobbyInterval) {
                clearInterval(this.lobbyInterval);
                this.lobbyInterval = null;
            }
            this.lobbyCountdown = 0;
        } else {
            // Still players in lobby (committed bots or other humans) - keep lobby alive & countdown running!
            this.botService?.onRoomUpdated(this, this.fee, this.room);
            this.broadcastSSE('lobby', {
                lobbyCountdown: this.lobbyCountdown,
                playerCount: this.players.length,
                boardCount: this.getTotalBoards(),
                pot: this.getPot(),
                gameState: this.state
            });
            this.broadcastSSE('boards', {
                boards: this.getBoards(),
                players: this.players.length,
                boardCount: this.getTotalBoards(),
                pot: this.getPot(),
                shuffleSeed: getBoardShuffleSeed()
            });
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

    private broadcastTelegramTickets(text: string) {
        const activePlayers = this.players.filter(p => p.ticketMessageId && !p.isBot);
        if (activePlayers.length === 0) return;

        // Run asynchronously in the background so it never blocks the clockwork game loop
        (async () => {
            const BATCH_SIZE = 10;
            for (let i = 0; i < activePlayers.length; i += BATCH_SIZE) {
                const batch = activePlayers.slice(i, i + BATCH_SIZE);
                await Promise.allSettled(batch.map(p => this.editTicketMessage(p, text)));
                if (i + BATCH_SIZE < activePlayers.length) {
                    await new Promise(r => setTimeout(r, 150));
                }
            }
        })().catch(err => {
            console.error('[Game] Error in broadcastTelegramTickets:', err);
        });
    }

    private scheduleNextDraw() {
        if (this.state !== 'PLAYING' || this.pendingWinners.length > 0) return;
        if (this.gameLoopTimeout) {
            clearTimeout(this.gameLoopTimeout);
            this.gameLoopTimeout = null;
        }

        // Self-adjusting target timestamp: gameStartTime + drawnCount * 4000ms
        const targetTime = this.gameStartTime + (this.drawnNumbers.size * 4000);
        const delay = Math.max(50, targetTime - Date.now());

        this.gameLoopTimeout = setTimeout(async () => {
            if (this.state !== 'PLAYING' || this.pendingWinners.length > 0) return;
            await this.drawNumber();
            this.scheduleNextDraw();
        }, delay);
    }

    async startGame() {
        if (this.state === 'PLAYING') {
            console.log('[Game] Already playing, ignoring startGame.');
            return;
        }
        this.sanitizePlayers();
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
        this.minCallOffset = null;
        this.allNumbers = Array.from({ length: 75 }, (_, i) => i + 1).sort(() => Math.random() - 0.5);
        const pot = this.getPot();

        // Broadcast GAME_START to SSE clients
        this.broadcastSSE('start', {
            gameId: this.gameId,
            pot,
            playerCount: this.players.length,
            boardCount: this.getTotalBoards(),
            nextDrawAt: Date.now() + 3000
        });

        // Step 1: Notify all players via ticket edit in background
        const startMsg = `🎮 *GAME IS STARTING!*\n\n👥 Players: ${this.players.length} (${this.getTotalBoards()} Boards) | 💰 Pot: *${pot} Birr*\n\n⏳ First number drawing in 3 seconds...\n\n👇 Your board — tap numbers when called:`;
        for (const p of this.players) {
            p.isBlocked = false;
            if (p.cards) {
                for (const c of p.cards) c.isBlocked = false;
            }
        }
        this.broadcastTelegramTickets(startMsg);

        // Step 2: Timestamp-based Clockwork Timer (first ball in 3 seconds)
        this.gameStartTime = Date.now() + 3000;
        if (this.startTimeout) clearTimeout(this.startTimeout);
        this.startTimeout = setTimeout(async () => {
            if (this.state !== 'PLAYING') return;
            await this.drawNumber();
            this.scheduleNextDraw();
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
        const sim = this.getSimulatedWinners(candidateNum);
        return sim.bots + sim.humans;
    }

    /**
     * Categorizes how many distinct bot players and human players would achieve a winning pattern
     * if candidateNum is drawn.
     */
    public getSimulatedWinners(candidateNum: number): { bots: number; humans: number } {
        const simulatedDrawn = new Set(this.drawnNumbers);
        simulatedDrawn.add(candidateNum);
        let bots = 0;
        let humans = 0;
        for (const p of this.players) {
            if (p.isBlocked) continue;
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
            if (playerWon) {
                if (p.isBot) bots++;
                else humans++;
            }
        }
        return { bots, humans };
    }

    /**
     * Counts how many active player cards matching filter contain candidateNum.
     */
    private countPlayerCardHits(candidateNum: number, filter: (p: Player) => boolean): number {
        let hits = 0;
        for (const p of this.players) {
            if (p.isBlocked || !filter(p)) continue;
            const cards = p.cards && p.cards.length > 0
                ? p.cards
                : [{ boardNumber: p.boardNumber || 0, ticket: p.ticket, daubed: p.daubed }];
            for (const card of cards) {
                for (let r = 0; r < 5; r++) {
                    for (let c = 0; c < 5; c++) {
                        if (card.ticket[r][c] === candidateNum) {
                            hits++;
                            break;
                        }
                    }
                }
            }
        }
        return hits;
    }

    /**
     * Computes the per-game effective minimum call threshold (>= minCallToWin)
     * using a randomized offset chosen once per game so wins do not cluster
     * on the exact configured minCallToWin boundary.
     */
    private getEffectiveMinCallToWin(): number {
        if (this.drawnNumbers.size === 0 || this.minCallOffset === null) {
            this.minCallOffset = Math.floor(Math.random() * 9);
        }
        const baseMin = Math.max(4, this.minCallToWin || 15);
        return Math.min(75, baseMin + this.minCallOffset);
    }

    /**
     * Picks an uncalled ball index that avoids completing a winning line for the
     * non-prioritized group without forcing an immediate win on the first eligible call.
     */
    private pickSteeredBallIndex(targetBots: boolean): number {
        const preferredPool: number[] = [];
        const fallbackPool: number[] = [];

        for (let i = 0; i < this.allNumbers.length; i++) {
            const sim = this.getSimulatedWinners(this.allNumbers[i]);
            const disallowedCount = targetBots ? sim.humans : sim.bots;
            const targetCount = targetBots ? sim.bots : sim.humans;

            if (disallowedCount === 0) {
                fallbackPool.push(i);
                if (targetCount <= 2) {
                    preferredPool.push(i);
                }
            }
        }

        const zeroOppPool = preferredPool.length > 0 ? preferredPool : fallbackPool;
        if (zeroOppPool.length === 0) return -1;

        const advancingPool = zeroOppPool.filter(idx =>
            this.countPlayerCardHits(this.allNumbers[idx], p => targetBots ? !!p.isBot : !p.isBot) > 0
        );
        const pool = advancingPool.length > 0 ? advancingPool : zeroOppPool;
        return pool[Math.floor(Math.random() * pool.length)];
    }

    private async drawNumber() {
        if (this.state !== 'PLAYING' || this.pendingWinners.length > 0 || this.isDrawing) return;
        this.isDrawing = true;

        try {
            if (this.allNumbers.length === 0) {
                if (this.gameLoopTimeout) {
                    clearTimeout(this.gameLoopTimeout);
                    this.gameLoopTimeout = null;
                }
                if (this.gameLoopInterval) {
                    clearInterval(this.gameLoopInterval);
                    this.gameLoopInterval = null;
                }
                await this.endGame(null);
                return;
            }

            let num: number;
            // Safe threshold: draws 1 to (effectiveMin - 1) do not complete a winning line for anyone
            const safeThreshold = this.getEffectiveMinCallToWin() - 1;
            const humanPlayers = this.players.filter(p => !p.isBot && !p.isBlocked);
            const hasRealHumans = humanPlayers.length > 0;

            if (this.drawnNumbers.size < safeThreshold && this.players.length > 0) {
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
                let chosenIndex = -1;

                if (this.winnerSelection === 'house' && hasRealHumans) {
                    // Mode: House / Bot Priority (Real humans must NOT win)
                    chosenIndex = this.pickSteeredBallIndex(true);
                } else if (this.winnerSelection === 'real_players' && hasRealHumans) {
                    // Mode: Real Players Priority (Bots must NOT win before real players)
                    chosenIndex = this.pickSteeredBallIndex(false);
                }

                // Standard Natural selection or Fallback if no specific index was picked
                if (chosenIndex === -1) {
                    const validIndices: number[] = [];
                    for (let i = 0; i < this.allNumbers.length; i++) {
                        const sim = this.getSimulatedWinners(this.allNumbers[i]);
                        if (sim.bots + sim.humans <= 2) {
                            validIndices.push(i);
                        }
                    }

                    if (validIndices.length > 0) {
                        chosenIndex = validIndices[Math.floor(Math.random() * validIndices.length)];
                    } else {
                        chosenIndex = this.allNumbers.length - 1;
                    }
                }

                num = this.allNumbers.splice(chosenIndex, 1)[0];
            } else {
                // Unrestricted random draw if no active players
                num = this.allNumbers.pop()!;
            }

            this.drawnNumbers.add(num);

            // Auto-daub and auto-claim for human players who have autoPlay enabled (Server Safety Net)
            for (const p of this.players) {
                if (p.autoPlay && !p.isBlocked && !p.isBot) {
                    const cards = p.cards && p.cards.length > 0
                        ? p.cards
                        : [{ boardNumber: p.boardNumber || 0, ticket: p.ticket, daubed: p.daubed }];

                    for (const card of cards) {
                        let hasNum = false;
                        for (let r = 0; r < 5; r++) {
                            for (let c = 0; c < 5; c++) {
                                if (card.ticket[r][c] === num) {
                                    hasNum = true;
                                    break;
                                }
                            }
                            if (hasNum) break;
                        }

                        if (hasNum) {
                            card.daubed.add(num);
                            p.daubed.add(num);

                            const winRes = checkWinFreshness(card.ticket, this.drawnNumbers, num);
                            if (winRes.hasWon && winRes.isFresh) {
                                console.log(`[GameManager] ⚡ Auto-Play: Player ${p.firstName || p.userId} completed winning line on #${num}! Triggering claim...`);
                                this.claimBingo(p.userId).catch(e => console.error('[GameManager] Auto-claim error:', e));
                                break;
                            }
                        }
                    }
                }
            }

            this.botService?.onNumberDrawn(this, num, this.fee, this.room);
            const numName = getNumberName(num);
            const emoji = getColumnEmoji(num);
            const allDrawn = Array.from(this.drawnNumbers).map(n => getNumberName(n));
            const recent = allDrawn.slice(-10).join('  ');

            console.log(`[Game] Drawing: ${numName} (#${this.drawnNumbers.size}) | Players: ${this.players.length}`);

            // Instant Real-Time SSE Push to all connected players (0ms latency!)
            this.broadcastSSE('ball', {
                number: num,
                numName,
                emoji,
                drawnNumbers: Array.from(this.drawnNumbers),
                lastDrawn: num,
                recent: Array.from(this.drawnNumbers).slice(-10),
                nextDrawAt: Date.now() + 4000,
                pot: this.getPot(),
                playerCount: this.players.length,
                boardCount: this.getTotalBoards()
            });

            // Big, bold drawn number with column color for Telegram
            const text =
                `${emoji} *${numName.replace('-', ' — ')}* ${emoji}\n` +
                `━━━━━━━━━━━━━━━━━━━\n` +
                `📜 *Drawn:* ${recent}\n` +
                `━━━━━━━━━━━━━━━━━━━\n` +
                `👇 Tap the number on your board if you have it!`;

            // Update Telegram messages in background without blocking the loop
            this.broadcastTelegramTickets(text);
        } finally {
            this.isDrawing = false;
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
        const p = this.getPlayer(userId);
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
            const allBlocked = this.players.length > 0 && this.players.every(pl => pl.isBlocked);
            if (allBlocked) {
                await this.endGameAllBlocked();
                return {
                    success: false,
                    blocked: true,
                    allBlocked: true,
                    msg: 'All players broke the rule and are blocked. The game is over.'
                };
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
                        winningCells: winRes.winningCells,
                        winningNumber: currentBall
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
            const allBlocked = this.players.length > 0 && this.players.every(pl => pl.isBlocked);
            if (allBlocked) {
                await this.endGameAllBlocked();
                return {
                    success: false,
                    blocked: true,
                    allBlocked: true,
                    late: hasStaleLine,
                    msg: 'All players broke the rule and are blocked. The game is over.'
                };
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

        const cleanWinnerName = (p.firstName || 'Player').replace(/\s*\.[A-Za-z]+|\s+[A-Za-z]\.?$/g, '').trim();

        // If player already claimed in pending pool
        if (this.pendingWinners.some(w => w.player.userId === userId)) {
            return {
                success: true,
                msg: 'BINGO!',
                winnerName: cleanWinnerName,
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

        // Pause ball drawing loop immediately while resolving winner(s)
        if (this.gameLoopTimeout) {
            clearTimeout(this.gameLoopTimeout);
            this.gameLoopTimeout = null;
        }
        if (this.startTimeout) {
            clearTimeout(this.startTimeout);
            this.startTimeout = null;
        }
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
                winnerName: cleanWinnerName,
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
            winnerName: cleanWinnerName,
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
        const p = this.getPlayer(userId);
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

    public async endGameAllBlocked() {
        this.state = 'WAITING';
        if (this.startTimeout) {
            clearTimeout(this.startTimeout);
            this.startTimeout = null;
        }
        if (this.gameLoopTimeout) {
            clearTimeout(this.gameLoopTimeout);
            this.gameLoopTimeout = null;
        }
        if (this.gameLoopInterval) {
            clearInterval(this.gameLoopInterval);
            this.gameLoopInterval = null;
        }
        if (this.resolutionTimeout) {
            clearTimeout(this.resolutionTimeout);
            this.resolutionTimeout = null;
        }
        this.pendingWinners = [];
        const pot = this.getPot();

        // When all players break the rules and are blocked:
        // 100% of pot (80% prize + 20% house fee) is credited to house profit!
        const organicPlayers = this.players.filter(p => !p.isBot);
        const organicPot = organicPlayers.reduce((sum, p) => sum + p.fee, 0);

        if (organicPlayers.length > 0) {
            try {
                await prisma.houseIncome.create({
                    data: {
                        gameType: 'bingo',
                        playerCount: this.players.length,
                        totalCollected: pot,
                        winnerPayout: 0,
                        houseProfit: organicPot,
                        winnerId: null,
                        winner2Id: null,
                        winnerCount: 0
                    }
                });
            } catch (e) {
                console.error('Failed to log HouseIncome for all-blocked game:', e);
            }
        }

        this.currentWinners = [];
        this.currentWinner = null;

        for (const p of this.players) {
            if (p.isBot) continue;
            try {
                await prisma.gameHistory.create({
                    data: {
                        userId: p.userId,
                        gameType: 'bingo',
                        bet: p.fee,
                        payout: 0,
                        result: 'BLOCKED'
                    }
                });
            } catch (e) {}

            await this.editTicketMessage(
                p,
                `🏁 *Game Over — All Players Blocked!* ⛔\n\nAll players broke the rules and were blocked. The round has ended with no winners.`
            );
        }

        // Broadcast SSE all_blocked event to all connected clients
        this.broadcastSSE('all_blocked', {
            allBlocked: true,
            reason: 'ALL_BLOCKED',
            message: 'All players broke the rule and are blocked, so the game is over.',
            messageAm: 'ሁሉም ተጫዋቾች ህጉን በመጣሳቸው ታግደዋል — ጨዋታው ተጠናቋል!',
            pot,
            drawnNumbers: Array.from(this.drawnNumbers),
            lastDrawn: Array.from(this.drawnNumbers).at(-1) || null
        });

        console.log(`[Game] All players blocked. Game ended with 100% house profit (${pot} Birr), lobby reset.`);
        this.players = [];
        this.pendingReservations.clear();
        this.drawnNumbers.clear();

        if (this.lobbyInterval) {
            clearInterval(this.lobbyInterval);
            this.lobbyInterval = null;
            this.lobbyCountdown = 0;
        }

        if (this.lobbyResetTimeout) {
            clearTimeout(this.lobbyResetTimeout);
            this.lobbyResetTimeout = null;
        }
        this.lobbyResetTimeout = setTimeout(async () => {
            this.lobbyResetTimeout = null;
            if (this.state === 'WAITING' && this.players.length === 0) {
                await this.resetToLobby();
            }
        }, 8000).unref();
    }

    private async endGame(winners: WinnerCandidate[] | null) {
        this.botService?.onGameEnded(this.fee, this.room);
        try {
            onGameCompletedCheckAutoReshuffle();
        } catch (e) {
            console.error('[Game] Error in auto-reshuffle check:', e);
        }
        this.state = 'WAITING';
        if (this.startTimeout) {
            clearTimeout(this.startTimeout);
            this.startTimeout = null;
        }
        if (this.gameLoopTimeout) {
            clearTimeout(this.gameLoopTimeout);
            this.gameLoopTimeout = null;
        }
        if (this.gameLoopInterval) {
            clearInterval(this.gameLoopInterval);
            this.gameLoopInterval = null;
        }
        if (this.resolutionTimeout) {
            clearTimeout(this.resolutionTimeout);
            this.resolutionTimeout = null;
        }
        this.pendingWinners = [];
        const pot = this.getPot();

        if (winners && winners.length > 0) {
            const totalWinnerPayout = Math.floor(pot * 0.8);
            const winnerCount = Math.min(winners.length, 2);
            const payoutPerWinner = Math.floor(totalWinnerPayout / winnerCount);

            // Calculate organic collected fees vs simulated bot fees
            const organicPlayers = this.players.filter(p => !p.isBot);
            const organicCollected = organicPlayers.reduce((sum, p) => sum + p.fee, 0);
            const humanWinners = winners.slice(0, 2).filter(w => !w.player.isBot);
            const totalActualPayout = humanWinners.length * payoutPerWinner;
            const actualProfit = organicCollected - totalActualPayout;

            // Log house income (only if real players participated or received payout)
            if (organicPlayers.length > 0 || totalActualPayout > 0) {
                try {
                    await prisma.houseIncome.create({
                        data: {
                            gameType: 'bingo',
                            fee: this.fee,
                            room: this.room,
                            playerCount: this.players.length,
                            totalCollected: pot,
                            winnerPayout: totalActualPayout,
                            houseProfit: actualProfit,
                            winnerId: winners[0] ? winners[0].player.userId : null,
                            winner2Id: (winners.length > 1) ? winners[1].player.userId : null,
                            winnerCount
                        }
                    });
                } catch (e) {
                    console.error('Failed to log HouseIncome:', e);
                }
            }

            // Credit winners (only real human players receive DB wallet credit)
            for (let i = 0; i < winnerCount; i++) {
                const w = winners[i];
                if (w.player.isBot) {
                    console.log(`[Game] Winner is virtual bot ${w.player.firstName} (${w.player.userId}) - skipping database payout.`);
                    continue;
                }
                try {
                    await prisma.user.update({
                        where: { id: w.player.userId },
                        data: {
                            balance: { increment: payoutPerWinner },
                            withdrawableBalance: { increment: payoutPerWinner }
                        }
                    });
                } catch (e) {
                    console.error(`Failed to credit winner ${w.player.userId}:`, e);
                }
            }

            this.currentWinners = winners.slice(0, 2).map(w => ({
                userId: w.player.userId.toString(),
                firstName: (w.player.firstName || 'Player').replace(/\s*\.[A-Za-z]+|\s+[A-Za-z]\.?$/g, '').trim(),
                username: w.player.username ?? null,
                amount: payoutPerWinner,
                boardNumber: w.boardNumber,
                ticket: w.ticket,
                daubed: Array.from(w.daubed),
                winningCells: w.winningCells || [],
                winningNumber: w.winningNumber || Array.from(this.drawnNumbers).at(-1),
                fee: this.fee,
                room: this.room,
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
                if (p.isBot) continue; // Skip virtual bots from DB GameHistory and Telegram
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
                    const winNotification = winnerCount > 1
                        ? `🎉 *Congratulations! You won ${payoutPerWinner} Birr!* (Shared Jackpot)`
                        : `🎉 *Congratulations! You won ${totalWinnerPayout} Birr!*`;
                    try {
                        await this.bot.api.sendMessage(Number(p.userId), winNotification, { parse_mode: 'Markdown' });
                    } catch (e) {}
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
            const organicPlayers = this.players.filter(p => !p.isBot);
            const organicCollected = organicPlayers.reduce((sum, p) => sum + p.fee, 0);
            if (organicPlayers.length > 0) {
                try {
                    await prisma.houseIncome.create({
                        data: {
                            gameType: 'bingo',
                            fee: this.fee,
                            room: this.room,
                            playerCount: this.players.length,
                            totalCollected: pot,
                            winnerPayout: 0,
                            houseProfit: organicCollected,
                            winnerId: null,
                            winner2Id: null,
                            winnerCount: 0
                        }
                    });
                } catch (e) {
                    console.error('Failed to log HouseIncome for no-winner game:', e);
                }
            }
            for (const p of this.players) {
                if (p.isBot) continue;
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

        // Broadcast winner event to all connected SSE clients
        this.broadcastSSE('winner', {
            winners: this.currentWinners,
            winner: this.currentWinner,
            pot,
            drawnNumbers: Array.from(this.drawnNumbers),
            winningNumber: this.currentWinner?.winningNumber || Array.from(this.drawnNumbers).at(-1)
        });

        console.log(`[Game] Game ended (${winners ? winners.length : 0} winner(s)), lobby reset.`);
        this.players = [];
        this.pendingReservations.clear();
        this.drawnNumbers.clear();

        // Clear lobby interval just in case
        if (this.lobbyInterval) {
            clearInterval(this.lobbyInterval);
            this.lobbyInterval = null;
            this.lobbyCountdown = 0;
        }

        if (this.lobbyResetTimeout) {
            clearTimeout(this.lobbyResetTimeout);
            this.lobbyResetTimeout = null;
        }
        this.lobbyResetTimeout = setTimeout(async () => {
            this.lobbyResetTimeout = null;
            if (this.state === 'WAITING' && this.players.length === 0) {
                await this.resetToLobby();
            }
        }, 8000).unref();
    }
}
