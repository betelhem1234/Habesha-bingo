import fs from 'fs';
import path from 'path';
import { Bot } from 'grammy';
import { GameManager } from './GameManager';
import { BotService } from './BotService';

const FEES = [10, 20, 50, 100, 0];

export class GameRooms {
    private rooms: Map<number, GameManager> = new Map();
    private callerVoice: 'male' | 'female' = 'male';
    private minCallToWin: number = 15;
    public botService: BotService;
    private settingsFilePath = path.join(process.cwd(), 'data', 'settings.json');

    constructor(private bot: Bot) {
        this.botService = new BotService();
        this.loadSettings();
        // Periodically release boards/fees left by players who abandoned the lobby.
        setInterval(() => this.sweepStalePlayers(), 5000).unref();
        // Auto-seed active rooms for continuous rolling loop on startup (production only)
        if (process.env.NODE_ENV !== 'test' && !process.env.NODE_TEST_CONTEXT) {
            setTimeout(() => this.initContinuousRooms(), 1000).unref();
        }
    }

    private loadSettings() {
        try {
            if (fs.existsSync(this.settingsFilePath)) {
                const data = JSON.parse(fs.readFileSync(this.settingsFilePath, 'utf8'));
                if (data.callerVoice === 'female' || data.callerVoice === 'male') {
                    this.callerVoice = data.callerVoice;
                }
                if (typeof data.minCallToWin === 'number' && data.minCallToWin >= 4 && data.minCallToWin <= 50) {
                    this.minCallToWin = Math.floor(data.minCallToWin);
                }
            }
        } catch (e) {
            console.error('[GameRooms] Error reading settings file:', e);
        }
    }

    private saveSettings() {
        try {
            const dir = path.dirname(this.settingsFilePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            let currentData: any = {};
            if (fs.existsSync(this.settingsFilePath)) {
                try {
                    currentData = JSON.parse(fs.readFileSync(this.settingsFilePath, 'utf8'));
                } catch {}
            }
            currentData.callerVoice = this.callerVoice;
            currentData.minCallToWin = this.minCallToWin;
            fs.writeFileSync(this.settingsFilePath, JSON.stringify(currentData, null, 2), 'utf8');
        } catch (e) {
            console.error('[GameRooms] Error saving settings file:', e);
        }
    }

    getCallerVoice(): 'male' | 'female' {
        return this.callerVoice;
    }

    setCallerVoice(voice: 'male' | 'female') {
        this.callerVoice = voice;
        this.saveSettings();
    }

    getMinCallToWin(): number {
        return this.minCallToWin;
    }

    setMinCallToWin(calls: number) {
        const val = Math.max(4, Math.min(50, Math.floor(calls)));
        this.minCallToWin = val;
        this.saveSettings();
        for (const gm of this.rooms.values()) {
            gm.minCallToWin = val;
        }
    }

    private async sweepStalePlayers() {
        for (const gm of this.rooms.values()) {
            await gm.removeStalePlayers();
        }
    }

    public initContinuousRooms() {
        const botSettings = this.botService.getSettings();
        const roomsToInit = (botSettings.enabledRooms && botSettings.enabledRooms.length > 0)
            ? botSettings.enabledRooms
            : [10, 20];

        for (const fee of roomsToInit) {
            const gm = this.getRoom(fee, 1);
            if (gm.state === 'WAITING' && gm.players.length === 0 && !gm.lobbyInterval) {
                gm.resetToLobby();
            }
        }
    }

    getRoom(fee: number, room: number = 1): GameManager {
        let f = Number(fee);
        let r = Number(room);
        if (isNaN(f) || f < 0) f = 10;
        if (isNaN(r) || r < 1) r = 1;
        const key = f * 1000 + r;
        if (!this.rooms.has(key)) {
            const gm = new GameManager(this.bot, this.botService, f, r);
            gm.minCallToWin = this.minCallToWin;
            this.rooms.set(key, gm);
            if (process.env.NODE_ENV !== 'test' && !process.env.NODE_TEST_CONTEXT) {
                const botSettings = this.botService.getSettings();
                if (botSettings.enabled && botSettings.enabledRooms.includes(f)) {
                    setTimeout(() => {
                        if (gm.state === 'WAITING' && gm.players.length === 0 && !gm.lobbyInterval) {
                            gm.resetToLobby();
                        }
                    }, 50).unref();
                }
            }
        }
        return this.rooms.get(key)!;
    }

    roomsList(): GameManager[] {
        return Array.from(this.rooms.values());
    }

    findPlayer(userId: bigint): GameManager | null {
        for (const gm of this.rooms.values()) {
            if (gm.players.some(p => p.userId === userId)) return gm;
        }
        return null;
    }

    getLobbyStats() {
        const tiers = FEES.filter(f => f > 0).map(fee => {
            const gm = this.rooms.get(fee);
            const playing = gm ? gm.state === 'PLAYING' : false;
            return {
                fee,
                players: gm ? gm.players.length : 0,
                pot: gm ? gm.getPot() : 0,
                playing
            };
        });

        const demo = this.rooms.get(0);
        const all = this.roomsList();
        const totalPlayers = all.reduce((s, gm) => s + gm.players.length, 0);
        const pot = all.reduce((s, gm) => s + gm.getPot(), 0);
        const playing = all.some(gm => gm.state === 'PLAYING');
        const countdowns = all.filter(gm => gm.state !== 'PLAYING').map(gm => gm.lobbyCountdown);
        const boardsTaken = all.reduce((s, gm) => s + gm.players.filter(p => p.boardNumber !== undefined).length, 0);

        const recentWinners = all
            .flatMap(gm => gm.recentWinners)
            .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
            .slice(0, 10);

        return {
            state: playing ? 'PLAYING' : 'WAITING',
            totalPlayers,
            pot,
            lobbyCountdown: countdowns.length ? Math.max(...countdowns) : 0,
            boardsTaken,
            tiers,
            demoPlayers: demo ? demo.players.length : 0,
            recentWinners
        };
    }

    getAdminStats() {
        const all = this.roomsList();
        const rooms = all
            .filter(gm => gm.fee > 0 || gm.players.length > 0)
            .map(gm => ({
                fee: gm.fee,
                room: gm.room,
                playersCount: gm.players.length,
                state: gm.state,
                lobbyCountdown: gm.lobbyCountdown,
                pot: gm.getPot(),
                drawnCount: gm.drawnNumbers.size,
                boardsTaken: gm.getTotalBoards()
            }))
            .sort((a, b) => a.fee - b.fee || a.room - b.room);

        return {
            activePlayers: all.reduce((s, gm) => s + gm.players.length, 0),
            gameState: all.some(gm => gm.state === 'PLAYING') ? 'PLAYING' : 'WAITING',
            pot: all.reduce((s, gm) => s + gm.getPot(), 0),
            drawnCount: all.reduce((s, gm) => s + gm.drawnNumbers.size, 0),
            rooms
        };
    }

    getActivePlayersDetails(): Array<{
        fee: number;
        room: number;
        gameState: 'WAITING' | 'PLAYING';
        lobbyCountdown: number;
        drawnCount: number;
        player: {
            userId: string;
            firstName?: string;
            username?: string;
            boards: number[];
            fee: number;
            bonusUsed: number;
            lastSeen: number;
            isBlocked: boolean;
            isBot?: boolean;
            autoPlay?: boolean;
        };
    }> {
        const list = [];
        for (const [key, gm] of this.rooms.entries()) {
            const fee = Math.floor(key / 1000);
            const room = key % 1000;
            gm.sanitizePlayers();
            const seenInRoom = new Set<string>();
            for (const p of gm.players) {
                const uId = p.userId.toString();
                if (seenInRoom.has(uId)) continue;
                seenInRoom.add(uId);
                list.push({
                    fee,
                    room,
                    gameState: gm.state,
                    lobbyCountdown: gm.lobbyCountdown,
                    drawnCount: gm.drawnNumbers.size,
                    player: {
                        userId: uId,
                        firstName: p.firstName,
                        username: p.username,
                        boards: p.cards && p.cards.length > 0 ? p.cards.map(c => c.boardNumber) : (p.boardNumber !== undefined ? [p.boardNumber] : []),
                        fee: p.fee,
                        bonusUsed: p.bonusUsed || 0,
                        lastSeen: p.lastSeen,
                        isBlocked: !!p.isBlocked,
                        isBot: !!p.isBot,
                        autoPlay: !!p.autoPlay
                    }
                });
            }
        }
        return list;
    }
}