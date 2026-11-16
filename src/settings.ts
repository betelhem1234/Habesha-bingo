import fs from 'fs';
import path from 'path';
import { getSystemSettingDb, setSystemSettingDb, getAllSystemSettingsDb } from './db';

const SETTINGS_PATH = path.join(process.cwd(), 'data', 'settings.json');

export interface SystemSettingsState {
    callerVoice: 'male' | 'female';
    minCallToWin: number;
    newUserBonus: number;
    referralBonus: number;
    botSettings?: any;
    boardShuffleSeed: number;
    autoReshuffle: 'off' | 'every_game' | 'every_5' | 'every_10';
    gamesSinceLastShuffle: number;
    lastReshuffledAt?: string;
}

const state: SystemSettingsState = {
    callerVoice: 'male',
    minCallToWin: 15,
    newUserBonus: 10,
    referralBonus: 5,
    boardShuffleSeed: 0,
    autoReshuffle: 'off',
    gamesSinceLastShuffle: 0,
    lastReshuffledAt: undefined,
    botSettings: {
        enabled: true,
        stake10Enabled: true,
        stake10Target: 20,
        stake20Enabled: false,
        stake20Target: 0,
        targetPlayers: 20,
        botReactionMinMs: 1800,
        botReactionMaxMs: 3200,
        joinPacing: 'dynamic',
        enabledRooms: [10, 20]
    }
};

// 1. Synchronous bootstrap from local JSON if available
function isTestMode(): boolean {
    return process.env.NODE_ENV === 'test' || !!process.env.NODE_TEST_CONTEXT;
}

function bootstrapFromFile() {
    if (isTestMode()) return;
    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
            const data = JSON.parse(raw);
            if (data.callerVoice === 'female' || data.callerVoice === 'male') {
                state.callerVoice = data.callerVoice;
            }
            if (typeof data.minCallToWin === 'number' && data.minCallToWin >= 4 && data.minCallToWin <= 50) {
                state.minCallToWin = Math.floor(data.minCallToWin);
            }
            if (typeof data.newUserBonus === 'number' && data.newUserBonus >= 0) {
                state.newUserBonus = Math.floor(data.newUserBonus);
            }
            if (typeof data.referralBonus === 'number' && data.referralBonus >= 0) {
                state.referralBonus = Math.floor(data.referralBonus);
            }
            if (data.botSettings && typeof data.botSettings === 'object') {
                state.botSettings = { ...state.botSettings, ...data.botSettings };
            }
            if (typeof data.boardShuffleSeed === 'number') {
                state.boardShuffleSeed = Math.floor(data.boardShuffleSeed);
            }
            if (['off', 'every_game', 'every_5', 'every_10'].includes(data.autoReshuffle)) {
                state.autoReshuffle = data.autoReshuffle;
            }
            if (typeof data.gamesSinceLastShuffle === 'number') {
                state.gamesSinceLastShuffle = Math.floor(data.gamesSinceLastShuffle);
            }
            if (typeof data.lastReshuffledAt === 'string') {
                state.lastReshuffledAt = data.lastReshuffledAt;
            }
        }
    } catch (e) {
        console.error('[Settings] Error bootstrapping from settings.json:', e);
    }
}

bootstrapFromFile();

function persistToFile() {
    if (isTestMode()) return;
    try {
        const dir = path.dirname(SETTINGS_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(state, null, 2), 'utf8');
    } catch (e) {
        console.error('[Settings] Error writing settings.json:', e);
    }
}

// 2. Asynchronous sync from PostgreSQL on startup
export async function initSettingsFromDb() {
    if (isTestMode()) return;
    try {
        const dbSettings = await getAllSystemSettingsDb();
        if (dbSettings.callerVoice === 'male' || dbSettings.callerVoice === 'female') {
            state.callerVoice = dbSettings.callerVoice;
        }
        if (dbSettings.minCallToWin) {
            const val = parseInt(dbSettings.minCallToWin, 10);
            if (!isNaN(val) && val >= 4 && val <= 50) state.minCallToWin = val;
        }
        if (dbSettings.newUserBonus) {
            const val = parseInt(dbSettings.newUserBonus, 10);
            if (!isNaN(val) && val >= 0) state.newUserBonus = val;
        }
        if (dbSettings.referralBonus) {
            const val = parseInt(dbSettings.referralBonus, 10);
            if (!isNaN(val) && val >= 0) state.referralBonus = val;
        }
        if (dbSettings.botSettings) {
            try {
                const parsed = JSON.parse(dbSettings.botSettings);
                if (parsed && typeof parsed === 'object') {
                    state.botSettings = { ...state.botSettings, ...parsed };
                }
            } catch {}
        }
        if (dbSettings.boardShuffleSeed) {
            const val = parseInt(dbSettings.boardShuffleSeed, 10);
            if (!isNaN(val) && val >= 0) state.boardShuffleSeed = val;
        }
        if (dbSettings.autoReshuffle) {
            if (['off', 'every_game', 'every_5', 'every_10'].includes(dbSettings.autoReshuffle)) {
                state.autoReshuffle = dbSettings.autoReshuffle as any;
            }
        }
        if (dbSettings.gamesSinceLastShuffle) {
            const val = parseInt(dbSettings.gamesSinceLastShuffle, 10);
            if (!isNaN(val) && val >= 0) state.gamesSinceLastShuffle = val;
        }
        if (dbSettings.lastReshuffledAt) {
            state.lastReshuffledAt = dbSettings.lastReshuffledAt;
        }

        // Mirror to local file for fast offline reads
        persistToFile();
        console.log(`[Settings] Loaded from persistent PostgreSQL: voice=${state.callerVoice}, newUserBonus=${state.newUserBonus}, referralBonus=${state.referralBonus}, minCallToWin=${state.minCallToWin}`);
    } catch (e) {
        console.error('[Settings] Could not load from PostgreSQL, keeping memory/file state:', e);
    }
}

// 3. Getters & Setters
export function getCallerVoice(): 'male' | 'female' {
    return state.callerVoice;
}

export function setCallerVoice(voice: 'male' | 'female') {
    state.callerVoice = voice;
    if (isTestMode()) return;
    persistToFile();
    setSystemSettingDb('callerVoice', voice).catch(err => console.error('[Settings] DB error saving callerVoice:', err));
}

export function getMinCallToWin(): number {
    return state.minCallToWin;
}

export function setMinCallToWin(calls: number) {
    const clamped = Math.max(4, Math.min(50, Math.floor(calls)));
    state.minCallToWin = clamped;
    if (isTestMode()) return;
    persistToFile();
    setSystemSettingDb('minCallToWin', String(clamped)).catch(err => console.error('[Settings] DB error saving minCallToWin:', err));
}

export function getNewUserBonus(): number {
    return state.newUserBonus;
}

export function getReferralBonus(): number {
    return state.referralBonus;
}

export function setBonusSettings(newUserBonus: number, referralBonus: number): { newUserBonus: number; referralBonus: number } {
    if (typeof newUserBonus !== 'number' || isNaN(newUserBonus) || newUserBonus < 0) {
        throw new Error('Invalid newUserBonus: must be a non-negative number');
    }
    if (typeof referralBonus !== 'number' || isNaN(referralBonus) || referralBonus < 0) {
        throw new Error('Invalid referralBonus: must be a non-negative number');
    }

    state.newUserBonus = Math.floor(newUserBonus);
    state.referralBonus = Math.floor(referralBonus);
    if (isTestMode()) {
        return { newUserBonus: state.newUserBonus, referralBonus: state.referralBonus };
    }
    persistToFile();

    setSystemSettingDb('newUserBonus', String(state.newUserBonus)).catch(err => console.error('[Settings] DB error saving newUserBonus:', err));
    setSystemSettingDb('referralBonus', String(state.referralBonus)).catch(err => console.error('[Settings] DB error saving referralBonus:', err));

    return { newUserBonus: state.newUserBonus, referralBonus: state.referralBonus };
}

export function getBotSettings(): any {
    return state.botSettings ? { ...state.botSettings } : null;
}

export function setBotSettings(settings: any) {
    state.botSettings = { ...state.botSettings, ...settings };
    if (isTestMode()) return;
    persistToFile();
    setSystemSettingDb('botSettings', JSON.stringify(state.botSettings)).catch(err => console.error('[Settings] DB error saving botSettings:', err));
}

export function getBoardShuffleSeed(): number {
    return state.boardShuffleSeed || 0;
}

export function reshuffleBoards(): { seed: number; timestamp: string } {
    state.boardShuffleSeed = Math.floor(Math.random() * 2147483647) + 1;
    state.gamesSinceLastShuffle = 0;
    state.lastReshuffledAt = new Date().toISOString();

    if (!isTestMode()) {
        persistToFile();
        setSystemSettingDb('boardShuffleSeed', String(state.boardShuffleSeed)).catch(() => {});
        setSystemSettingDb('gamesSinceLastShuffle', '0').catch(() => {});
        setSystemSettingDb('lastReshuffledAt', state.lastReshuffledAt).catch(() => {});
    }

    console.log(`[Settings] 🎲 Boards reshuffled! New active seed: ${state.boardShuffleSeed}`);
    return { seed: state.boardShuffleSeed, timestamp: state.lastReshuffledAt };
}

export function getAutoReshuffleSetting(): 'off' | 'every_game' | 'every_5' | 'every_10' {
    return state.autoReshuffle || 'off';
}

export function setAutoReshuffleSetting(mode: 'off' | 'every_game' | 'every_5' | 'every_10') {
    state.autoReshuffle = mode;
    if (!isTestMode()) {
        persistToFile();
        setSystemSettingDb('autoReshuffle', mode).catch(() => {});
    }
    console.log(`[Settings] Auto-reshuffle mode set to: ${mode}`);
}

export function getBoardShuffleStatus() {
    return {
        currentSeed: state.boardShuffleSeed || 0,
        autoReshuffle: state.autoReshuffle || 'off',
        gamesSinceLastShuffle: state.gamesSinceLastShuffle || 0,
        lastReshuffledAt: state.lastReshuffledAt || null
    };
}

/**
 * Called at the end of each game. Increments game count and automatically reshuffles if threshold reached.
 */
export function onGameCompletedCheckAutoReshuffle(): boolean {
    state.gamesSinceLastShuffle = (state.gamesSinceLastShuffle || 0) + 1;

    let shouldReshuffle = false;
    if (state.autoReshuffle === 'every_game') {
        shouldReshuffle = true;
    } else if (state.autoReshuffle === 'every_5' && state.gamesSinceLastShuffle >= 5) {
        shouldReshuffle = true;
    } else if (state.autoReshuffle === 'every_10' && state.gamesSinceLastShuffle >= 10) {
        shouldReshuffle = true;
    }

    if (shouldReshuffle) {
        reshuffleBoards();
        return true;
    } else if (!isTestMode()) {
        setSystemSettingDb('gamesSinceLastShuffle', String(state.gamesSinceLastShuffle)).catch(() => {});
    }
    return false;
}
