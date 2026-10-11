import fs from 'fs';
import path from 'path';
import { GameManager, Player } from './GameManager';
import { checkWinFreshness, generateTicket } from './bingo';

export interface BotSettings {
    enabled: boolean;
    targetPlayers: number;
    botReactionMinMs: number;
    botReactionMaxMs: number;
    enabledRooms: number[];
}

export interface BotProfile {
    firstName: string;
    username: string;
}

export const ETHIOPIAN_BOT_PROFILES: BotProfile[] = [
    { firstName: 'Dawit', username: 'dawit_b9' },
    { firstName: 'Almaz', username: 'almaz_k' },
    { firstName: 'Abebe', username: 'abebe_t' },
    { firstName: 'Bethlehem', username: 'bethi_g' },
    { firstName: 'Henok', username: 'henok_t' },
    { firstName: 'Tigist', username: 'tigi_21' },
    { firstName: 'Yared', username: 'yared_w' },
    { firstName: 'Selamawit', username: 'selam_m' },
    { firstName: 'Dani', username: 'dani_a' },
    { firstName: 'Biruk', username: 'biruk_eth' },
    { firstName: 'Alex', username: 'alex_m' },
    { firstName: 'Natnael', username: 'nati_d' },
    { firstName: 'Kalkidan', username: 'kal_99' },
    { firstName: 'Ermias', username: 'ermias_t' },
    { firstName: 'Rahel', username: 'rahel_k' },
    { firstName: 'Tewodros', username: 'tedros_a' },
    { firstName: 'Bethi', username: 'bethi_style' },
    { firstName: 'Eyob', username: 'eyob_b' },
    { firstName: 'Meron', username: 'meron_a' },
    { firstName: 'Solomon', username: 'solomon_t' },
    { firstName: 'Mahlet', username: 'mahi_b' },
    { firstName: 'Biniyam', username: 'bini_s' },
    { firstName: 'Hiwot', username: 'hiwot_m' },
    { firstName: 'Yohannes', username: 'yoni_m' },
    { firstName: 'Eden', username: 'eden_sh' },
    { firstName: 'Robel', username: 'robel_k' },
    { firstName: 'Tsion', username: 'tsion_b' },
    { firstName: 'Kirubel', username: 'kiru_a' },
    { firstName: 'Martha', username: 'martha_t' },
    { firstName: 'Samuel', username: 'samuel_f' },
    { firstName: 'Aster', username: 'aster_d' },
    { firstName: 'Abel', username: 'abel_g' },
    { firstName: 'Genet', username: 'genet_h' },
    { firstName: 'Surafel', username: 'sura_m' },
    { firstName: 'Feven', username: 'feven_t' },
    { firstName: 'Mikiyas', username: 'miki_k' },
    { firstName: 'Helen', username: 'helen_g' },
    { firstName: 'Kaleb', username: 'kaleb_t' },
    { firstName: 'Meseret', username: 'meseret_k' },
    { firstName: 'Desta', username: 'desta_m' },
    { firstName: 'Senait', username: 'senait_w' },
    { firstName: 'Fikir', username: 'fikir_y' },
    { firstName: 'Hana', username: 'hana_b' },
    { firstName: 'Nebiyu', username: 'neba_s' },
    { firstName: 'Saron', username: 'saron_a' },
    { firstName: 'Nahom', username: 'nahom_b' },
    { firstName: 'Betel', username: 'betel_n' },
    { firstName: 'Tamirat', username: 'tame_a' },
    { firstName: 'Lidia', username: 'lidia_y' },
    { firstName: 'Million', username: 'milli_k' }
];

export class BotService {
    private settings: BotSettings = {
        enabled: true,
        targetPlayers: 20,
        botReactionMinMs: 1800,
        botReactionMaxMs: 3200,
        enabledRooms: [10, 20]
    };

    private settingsFilePath = path.join(process.cwd(), 'data', 'settings.json');
    private fillTimeouts: Map<string, NodeJS.Timeout> = new Map();
    private winTimeouts: Map<string, NodeJS.Timeout[]> = new Map();
    private nextBotIndex = 0;

    constructor() {
        this.loadSettings();
    }

    private loadSettings() {
        try {
            if (fs.existsSync(this.settingsFilePath)) {
                const data = JSON.parse(fs.readFileSync(this.settingsFilePath, 'utf8'));
                if (data.botSettings) {
                    this.settings = {
                        enabled: data.botSettings.enabled !== undefined ? !!data.botSettings.enabled : true,
                        targetPlayers: Number(data.botSettings.targetPlayers) || 20,
                        botReactionMinMs: Number(data.botSettings.botReactionMinMs) || 1800,
                        botReactionMaxMs: Number(data.botSettings.botReactionMaxMs) || 3200,
                        enabledRooms: Array.isArray(data.botSettings.enabledRooms) ? data.botSettings.enabledRooms : [10, 20]
                    };
                }
            }
        } catch (e) {
            console.error('[BotService] Error reading settings:', e);
        }
    }

    public saveSettings() {
        try {
            const dir = path.dirname(this.settingsFilePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            let currentData: any = {};
            if (fs.existsSync(this.settingsFilePath)) {
                try {
                    currentData = JSON.parse(fs.readFileSync(this.settingsFilePath, 'utf8'));
                } catch {}
            }
            currentData.botSettings = this.settings;
            fs.writeFileSync(this.settingsFilePath, JSON.stringify(currentData, null, 2), 'utf8');
        } catch (e) {
            console.error('[BotService] Error saving settings:', e);
        }
    }

    public getSettings(): BotSettings {
        return { ...this.settings };
    }

    public updateSettings(partial: Partial<BotSettings>): BotSettings {
        if (partial.enabled !== undefined) this.settings.enabled = !!partial.enabled;
        if (partial.targetPlayers !== undefined && partial.targetPlayers >= 2 && partial.targetPlayers <= 50) {
            this.settings.targetPlayers = Number(partial.targetPlayers);
        }
        if (partial.botReactionMinMs !== undefined && partial.botReactionMinMs >= 50) {
            this.settings.botReactionMinMs = Number(partial.botReactionMinMs);
        }
        if (partial.botReactionMaxMs !== undefined && partial.botReactionMaxMs >= this.settings.botReactionMinMs) {
            this.settings.botReactionMaxMs = Number(partial.botReactionMaxMs);
        }
        if (Array.isArray(partial.enabledRooms)) {
            this.settings.enabledRooms = partial.enabledRooms.map(Number);
        }
        this.saveSettings();
        return this.getSettings();
    }

    private getRoomKey(fee: number, room: number): string {
        return `${fee}_${room}`;
    }

    /**
     * Pick random untaken board numbers (1-500) for a bot player
     */
    private pickUntakenBoards(gm: GameManager, count: number = 1): number[] {
        const takenSet = new Set<number>();
        for (const p of gm.players) {
            if (p.cards) {
                for (const c of p.cards) takenSet.add(c.boardNumber);
            } else if (p.boardNumber !== undefined) {
                takenSet.add(p.boardNumber);
            }
        }

        const available: number[] = [];
        for (let i = 1; i <= 500; i++) {
            if (!takenSet.has(i)) available.push(i);
        }

        if (available.length === 0) return [];

        const picked: number[] = [];
        for (let i = 0; i < count && available.length > 0; i++) {
            const randIdx = Math.floor(Math.random() * available.length);
            picked.push(available.splice(randIdx, 1)[0]);
        }
        return picked;
    }

    /**
     * Add a single bot player into the given GameManager instance
     */
    public async addSingleBot(gm: GameManager, fee: number): Promise<boolean> {
        if (gm.state !== 'WAITING') return false;

        // Strictly 1 board per bot (10 Birr stake)
        const boards = this.pickUntakenBoards(gm, 1);
        if (boards.length === 0) return false;

        const profile = ETHIOPIAN_BOT_PROFILES[this.nextBotIndex % ETHIOPIAN_BOT_PROFILES.length];
        this.nextBotIndex++;

        // Virtual IDs are large numbers prefixed with 9000000000
        const virtualId = BigInt(9000000000) + BigInt(this.nextBotIndex);

        const cards = boards.map(bn => ({
            boardNumber: bn,
            ticket: generateTicket(bn),
            daubed: new Set<number>()
        }));

        const botPlayer: Player = {
            userId: virtualId,
            cards,
            ticket: cards[0].ticket,
            daubed: cards[0].daubed,
            boardNumber: cards[0].boardNumber,
            fee: boards.length * fee,
            bonusUsed: 0,
            withdrawableUsed: 0,
            firstName: (profile.firstName || 'Player').replace(/\s*\.[A-Za-z]+|\s+[A-Za-z]\.?$/g, '').trim(),
            username: profile.username,
            lastSeen: Date.now(),
            isBot: true
        };

        gm.players.push(botPlayer);
        gm.sanitizePlayers();

        // Auto-start 30s lobby countdown as soon as bots enter the waiting lobby
        if (gm.state === 'WAITING' && gm.players.length >= 1 && !gm.lobbyInterval) {
            gm.startLobbyTimer();
        }

        // Broadcast lobby updates to SSE clients
        gm.broadcastSSE('lobby', {
            lobbyCountdown: gm.lobbyCountdown,
            playerCount: gm.players.length,
            boardCount: gm.getTotalBoards(),
            pot: gm.getPot(),
            gameState: gm.state
        });

        // Broadcast board status update
        gm.broadcastSSE('boards', {
            boards: gm.getBoards(),
            players: gm.players.length,
            boardCount: gm.getTotalBoards(),
            pot: gm.getPot()
        });

        return true;
    }

    /**
     * Called whenever player membership changes in a waiting room.
     * If human players are in the room and total bots < targetPlayers,
     * schedules bots to join gradually.
     */
    public onRoomUpdated(gm: GameManager, fee: number, room: number) {
        const key = this.getRoomKey(fee, room);

        if (this.fillTimeouts.has(key)) {
            clearTimeout(this.fillTimeouts.get(key)!);
            this.fillTimeouts.delete(key);
        }

        if (!this.settings.enabled) return;
        if (!this.settings.enabledRooms.includes(fee)) return;
        if (gm.state !== 'WAITING') return;

        const humans = gm.players.filter(p => !p.isBot);
        // Only auto-fill if at least 1 real human is waiting
        if (humans.length === 0) {
            // No humans waiting: automatically clean up any lingering bots
            this.clearBots(gm);
            return;
        }

        const botCount = gm.players.filter(p => p.isBot).length;
        if (botCount >= this.settings.targetPlayers) {
            return; // Target number of bots reached
        }

        // Schedule next bot join with human-like interval (800ms to 1800ms)
        const delay = Math.floor(Math.random() * 1000) + 800;
        const timer = setTimeout(async () => {
            this.fillTimeouts.delete(key);
            const currentBots = gm.players.filter(p => p.isBot).length;
            if (gm.state === 'WAITING' && currentBots < this.settings.targetPlayers) {
                const added = await this.addSingleBot(gm, fee);
                if (added) {
                    this.onRoomUpdated(gm, fee, room);
                }
            }
        }, delay);

        this.fillTimeouts.set(key, timer);
    }

    /**
     * Manually inject N bots into a room immediately
     */
    public async injectBots(gm: GameManager, count: number, fee: number): Promise<number> {
        let added = 0;
        for (let i = 0; i < count; i++) {
            if (gm.state !== 'WAITING') break;
            const ok = await this.addSingleBot(gm, fee);
            if (ok) added++;
        }
        return added;
    }

    /**
     * Remove all bots from a GameManager instance
     */
    public clearBots(gm: GameManager): number {
        const initialCount = gm.players.length;
        gm.players = gm.players.filter(p => !p.isBot);
        const removed = initialCount - gm.players.length;
        if (removed > 0) {
            if (gm.players.length === 0 && gm.lobbyInterval) {
                clearInterval(gm.lobbyInterval);
                gm.lobbyInterval = null;
                gm.lobbyCountdown = 0;
            }
            gm.broadcastSSE('lobby', {
                lobbyCountdown: gm.lobbyCountdown,
                playerCount: gm.players.length,
                boardCount: gm.getTotalBoards(),
                pot: gm.getPot(),
                gameState: gm.state
            });
            gm.broadcastSSE('boards', {
                boards: gm.getBoards(),
                players: gm.players.length,
                boardCount: gm.getTotalBoards(),
                pot: gm.getPot()
            });
        }
        return removed;
    }

    /**
     * Called when a new ball is drawn in the game loop.
     * Bots daub the number and check if they achieved a winning pattern.
     */
    public onNumberDrawn(gm: GameManager, num: number, fee: number, room: number) {
        if (gm.state !== 'PLAYING') return;

        const key = this.getRoomKey(fee, room);
        const botPlayers = gm.players.filter(p => p.isBot && !p.isBlocked);
        if (botPlayers.length === 0) return;

        for (const bot of botPlayers) {
            const cards = bot.cards && bot.cards.length > 0
                ? bot.cards
                : [{ boardNumber: bot.boardNumber || 0, ticket: bot.ticket, daubed: bot.daubed }];

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
                    bot.daubed.add(num);

                    // Check if this newly drawn ball completed a fresh winning pattern!
                    const winRes = checkWinFreshness(card.ticket, gm.drawnNumbers, num);
                    if (winRes.hasWon && winRes.isFresh) {
                        // This bot has a winning pattern!
                        // Simulate human reaction time (configured between botReactionMinMs and botReactionMaxMs)
                        const reactionDelay = Math.floor(
                            Math.random() * (this.settings.botReactionMaxMs - this.settings.botReactionMinMs) + this.settings.botReactionMinMs
                        );

                        console.log(`[BotService] 🤖 Bot ${bot.firstName} achieved winning pattern on #${num}! Scheduling claim in ${reactionDelay}ms.`);

                        const winTimer = setTimeout(async () => {
                            if (gm.state === 'PLAYING') {
                                console.log(`[BotService] 🤖 Bot ${bot.firstName} claiming Bingo!`);
                                await gm.claimBingo(bot.userId);
                            }
                        }, reactionDelay);

                        if (!this.winTimeouts.has(key)) {
                            this.winTimeouts.set(key, []);
                        }
                        this.winTimeouts.get(key)!.push(winTimer);
                    }
                }
            }
        }
    }

    /**
     * Clean up all pending bot timers when a game ends or resets
     */
    public onGameEnded(fee: number, room: number) {
        const key = this.getRoomKey(fee, room);
        if (this.fillTimeouts.has(key)) {
            clearTimeout(this.fillTimeouts.get(key)!);
            this.fillTimeouts.delete(key);
        }
        if (this.winTimeouts.has(key)) {
            for (const t of this.winTimeouts.get(key)!) {
                clearTimeout(t);
            }
            this.winTimeouts.delete(key);
        }
    }
}
