import fs from 'fs';
import path from 'path';
import { Bot } from 'grammy';
import { GameManager } from './GameManager';

const FEES = [10, 20, 50, 100, 0];

export class GameRooms {
    private rooms: Map<number, GameManager> = new Map();
    private callerVoice: 'male' | 'female' = 'male';
    private settingsFilePath = path.join(process.cwd(), 'data', 'settings.json');

    constructor(private bot: Bot) {
        this.loadSettings();
        // Periodically release boards/fees left by players who abandoned the lobby.
        setInterval(() => this.sweepStalePlayers(), 5000).unref();
    }

    private loadSettings() {
        try {
            if (fs.existsSync(this.settingsFilePath)) {
                const data = JSON.parse(fs.readFileSync(this.settingsFilePath, 'utf8'));
                if (data.callerVoice === 'female' || data.callerVoice === 'male') {
                    this.callerVoice = data.callerVoice;
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

    private async sweepStalePlayers() {
        for (const gm of this.rooms.values()) {
            await gm.removeStalePlayers();
        }
    }

    getRoom(fee: number, room: number = 1): GameManager {
        let f = Number(fee);
        let r = Number(room);
        if (isNaN(f) || f < 0) f = 10;
        if (isNaN(r) || r < 1) r = 1;
        const key = f * 1000 + r;
        if (!this.rooms.has(key)) {
            this.rooms.set(key, new GameManager(this.bot));
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
        return {
            activePlayers: all.reduce((s, gm) => s + gm.players.length, 0),
            gameState: all.some(gm => gm.state === 'PLAYING') ? 'PLAYING' : 'WAITING',
            pot: all.reduce((s, gm) => s + gm.getPot(), 0),
            drawnCount: all.reduce((s, gm) => s + gm.drawnNumbers.size, 0)
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
        };
    }> {
        const list = [];
        for (const [key, gm] of this.rooms.entries()) {
            const fee = Math.floor(key / 1000);
            const room = key % 1000;
            for (const p of gm.players) {
                list.push({
                    fee,
                    room,
                    gameState: gm.state,
                    lobbyCountdown: gm.lobbyCountdown,
                    drawnCount: gm.drawnNumbers.size,
                    player: {
                        userId: p.userId.toString(),
                        firstName: p.firstName,
                        username: p.username,
                        boards: p.cards && p.cards.length > 0 ? p.cards.map(c => c.boardNumber) : (p.boardNumber !== undefined ? [p.boardNumber] : []),
                        fee: p.fee,
                        bonusUsed: p.bonusUsed || 0,
                        lastSeen: p.lastSeen,
                        isBlocked: !!p.isBlocked
                    }
                });
            }
        }
        return list;
    }
}