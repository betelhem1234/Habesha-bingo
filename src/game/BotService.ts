import fs from 'fs';
import path from 'path';
import { getBotSettings, setBotSettings } from '../settings';
import { GameManager, Player } from './GameManager';
import { checkWinFreshness, generateTicket } from './bingo';

export interface BotSettings {
    enabled: boolean;
    stake10Enabled: boolean;
    stake10Target: number;
    stake20Enabled: boolean;
    stake20Target: number;
    targetPlayers: number;
    botReactionMinMs: number;
    botReactionMaxMs: number;
    joinPacing?: 'dynamic' | 'rapid' | 'relaxed';
    enabledRooms: number[];
}

export interface BotProfile {
    firstName: string;
    username: string;
}

export const ETHIOPIAN_BOT_PROFILES: BotProfile[] = [
    // ─── 244 Authentic Ethiopian Male Nicknames & Telegram Handles (94.6%) ───
    { firstName: 'Dani', username: 'daniboy_99' },
    { firstName: 'Yoni', username: 'yoni_pro21' },
    { firstName: 'Nati', username: 'its_nati' },
    { firstName: 'Miki', username: 'miki_star' },
    { firstName: 'Sura', username: 'sura_king' },
    { firstName: 'Beki', username: 'beki_boss' },
    { firstName: 'Alex', username: 'alex_ethio' },
    { firstName: 'Heni', username: 'dj_heni88' },
    { firstName: 'Sami', username: 'sami_love' },
    { firstName: 'Teddy', username: 'teddymusic' },
    { firstName: 'Kiru', username: 'kirustyle' },
    { firstName: 'Bini', username: 'bini_23' },
    { firstName: 'Robu', username: 'robelzone' },
    { firstName: 'Dagi', username: 'dagicool' },
    { firstName: 'Ermi', username: 'ermi_vibes' },
    { firstName: 'Zola', username: 'zolaaddis' },
    { firstName: 'Gech', username: 'gechreal' },
    { firstName: 'Solo', username: 'sololife' },
    { firstName: 'Ephi', username: 'ephitech' },
    { firstName: 'Dawe', username: 'dawe_90' },
    { firstName: 'Abuki', username: 'abukihabesha' },
    { firstName: 'Brooki', username: 'brooki_22' },
    { firstName: 'Mule', username: 'mulepower' },
    { firstName: 'Fika', username: 'fika_vibe' },
    { firstName: 'Fish', username: 'fish_addis' },
    { firstName: 'Habtish', username: 'habtish_m' },
    { firstName: 'Aschu', username: 'aschu_boy' },
    { firstName: 'Sinte', username: 'sinte_eth' },
    { firstName: 'Mako', username: 'mako_addis' },
    { firstName: 'Deme', username: 'deme_pro' },
    { firstName: 'Kalu', username: 'kalu_boy' },
    { firstName: 'Aman', username: 'amanu_eth' },
    { firstName: 'Tame', username: 'tame_king' },
    { firstName: 'Neba', username: 'neba_pro' },
    { firstName: 'Fasi', username: 'fasi_boy' },
    { firstName: 'Bura', username: 'buraspeed' },
    { firstName: 'Batu', username: 'batu_addis' },
    { firstName: 'Joni', username: 'joni_99' },
    { firstName: 'Tommy', username: 'tommy_addis' },
    { firstName: 'Liyu', username: 'liyu_love' },
    { firstName: 'Chala', username: 'chala_oromo' },
    { firstName: 'Kidus', username: 'kiduspeace' },
    { firstName: 'Yabu', username: 'yabu_vibes' },
    { firstName: 'Zedu', username: 'zedu_cool' },
    { firstName: 'Temu', username: 'temu_addis' },
    { firstName: 'Tari', username: 'tari_speed' },
    { firstName: 'Wonde', username: 'wonde_eth' },
    { firstName: 'Shime', username: 'shime_pro' },
    { firstName: 'Milli', username: 'milli_star' },
    { firstName: 'Yosi', username: 'yosi_king' },
    { firstName: 'Eli', username: 'eli_addis' },
    { firstName: 'Eyobu', username: 'eyobu_boy' },
    { firstName: 'Take', username: 'take_addis' },
    { firstName: 'Gashu', username: 'gashu_pro' },
    { firstName: 'Afe', username: 'afe_vibes' },
    { firstName: 'Andu', username: 'andu_eth' },
    { firstName: 'Mame', username: 'mame_boy' },
    { firstName: 'Bubu', username: 'bubu_star' },
    { firstName: 'Titi', username: 'titi_addis' },
    { firstName: 'Papa', username: 'papa_vibes' },
    { firstName: 'Kidu', username: 'kidu_peace' },
    { firstName: 'Fafii', username: 'fafii_star' },
    { firstName: 'Amu', username: 'amu_addis' },
    { firstName: 'Faruq', username: 'faruq_speed' },
    { firstName: 'Jossy', username: 'jossy_addis' },
    { firstName: 'Dany', username: 'dany_star' },
    { firstName: 'Biny', username: 'biny_boy' },
    { firstName: 'Samy', username: 'samy_vibes' },
    { firstName: 'Miko', username: 'miko_pro' },
    { firstName: 'Abre', username: 'abre_addis' },
    { firstName: 'Abresh', username: 'abresh_star' },
    { firstName: 'Cheche', username: 'cheche_boy' },
    { firstName: 'Papi', username: 'papi_addis' },
    { firstName: 'Tedo', username: 'tedo_vibes' },
    { firstName: 'Kassu', username: 'kassu_eth' },
    { firstName: 'Baye', username: 'baye_speed' },
    { firstName: 'Getu', username: 'getu_addis' },
    { firstName: 'Tila', username: 'tila_star' },
    { firstName: 'Belay', username: 'belay_pro' },
    { firstName: 'Messe', username: 'messe_addis' },
    { firstName: 'Wube', username: 'wube_star' },
    { firstName: 'Aklu', username: 'aklu_vibes' },
    { firstName: 'Boge', username: 'boge_addis' },
    { firstName: 'Cheru', username: 'cheru_peace' },
    { firstName: 'Dere', username: 'dere_speed' },
    { firstName: 'Desi', username: 'desi_addis' },
    { firstName: 'Eshe', username: 'eshe_vibes' },
    { firstName: 'Fele', username: 'fele_star' },
    { firstName: 'Gize', username: 'gize_addis' },
    { firstName: 'Mati', username: 'mati_speed' },
    { firstName: 'Mera', username: 'mera_vibes' },
    { firstName: 'Mina', username: 'mina_addis' },
    { firstName: 'Moge', username: 'moge_star' },
    { firstName: 'Nega', username: 'nega_speed' },
    { firstName: 'Shife', username: 'shife_addis' },
    { firstName: 'Taye', username: 'taye_vibes' },
    { firstName: 'Teka', username: 'teka_star' },
    { firstName: 'Tena', username: 'tena_addis' },
    { firstName: 'Tesfu', username: 'tesfu_vibes' },
    { firstName: 'Wale', username: 'wale_star' },
    { firstName: 'Wase', username: 'wase_addis' },
    { firstName: 'Yare', username: 'yare_vibes' },
    { firstName: 'Zewdi', username: 'zewdi_speed' },
    { firstName: 'Adu', username: 'adu_addis' },
    { firstName: 'Addis', username: 'addis_star' },
    { firstName: 'Alem', username: 'alem_vibes' },
    { firstName: 'Ara', username: 'ara_speed' },
    { firstName: 'Asse', username: 'asse_addis' },
    { firstName: 'Aste', username: 'aste_vibes' },
    { firstName: 'Aye', username: 'aye_star' },
    { firstName: 'Dagne', username: 'dagne_speed' },
    { firstName: 'Damte', username: 'damte_addis' },
    { firstName: 'Fenta', username: 'fenta_star' },
    { firstName: 'Gebe', username: 'gebe_vibes' },
    { firstName: 'Kele', username: 'kele_addis' },
    { firstName: 'Kibre', username: 'kibre_speed' },
    { firstName: 'Melke', username: 'melke_addis' },
    { firstName: 'Menge', username: 'menge_vibes' },
    { firstName: 'Misge', username: 'misge_star' },
    { firstName: 'Mitu', username: 'mitu_addis' },
    { firstName: 'Molla', username: 'molla_speed' },
    { firstName: 'Sile', username: 'sile_addis' },
    { firstName: 'Sima', username: 'sima_star' },
    { firstName: 'Tege', username: 'tege_vibes' },
    { firstName: 'Yete', username: 'yete_speed' },
    { firstName: 'Endu', username: 'endu_addis' },
    { firstName: 'Fise', username: 'fise_vibes' },
    { firstName: 'Gelan', username: 'gelan_star' },
    { firstName: 'Halu', username: 'halu_addis' },
    { firstName: 'Alu', username: 'alu_vibes' },
    { firstName: 'Zeru', username: 'zeru_speed' },
    { firstName: 'Tolassa', username: 'tolassa_eth' },
    { firstName: 'Tibe', username: 'tibe_addis' },
    { firstName: 'Tiga', username: 'tiga_vibes' },
    { firstName: 'Tolo', username: 'tolo_star' },
    { firstName: 'Teke', username: 'teke_speed' },
    { firstName: 'Zina', username: 'zina_addis' },
    { firstName: 'Badeg', username: 'badeg_star' },
    { firstName: 'Balcha', username: 'balcha_vibes' },
    { firstName: 'Bayisa', username: 'bayisa_speed' },
    { firstName: 'Beny', username: 'beny_addis' },
    { firstName: 'Bire', username: 'bire_star' },
    { firstName: 'Bizu', username: 'bizu_vibes' },
    { firstName: 'Dinku', username: 'dinku_speed' },
    { firstName: 'Esma', username: 'esma_addis' },
    { firstName: 'Fante', username: 'fante_star' },
    { firstName: 'Gobe', username: 'gobe_vibes' },
    { firstName: 'Gorfu', username: 'gorfu_speed' },
    { firstName: 'Kasse', username: 'kasse_addis' },
    { firstName: 'Mare', username: 'mare_star' },
    { firstName: 'Shega', username: 'shega_vibes' },
    { firstName: 'Zewge', username: 'zewge_speed' },
    { firstName: 'Abe', username: 'abe_addis' },
    { firstName: 'Amanu', username: 'amanu_speed' },
    { firstName: 'Robi', username: 'robi_addis' },
    { firstName: 'Heni', username: 'heni_cool' },
    { firstName: 'Biruki', username: 'biruki_addis' },
    { firstName: 'Nati', username: 'nati_cool' },
    { firstName: 'Sami', username: 'sami_addis' },
    { firstName: 'Abuki', username: 'abuki_addis' },
    { firstName: 'Suri', username: 'suri_eth' },
    { firstName: 'Miki', username: 'miki_addis' },
    { firstName: 'Kalu', username: 'kalu_addis' },
    { firstName: 'Solo', username: 'solo_addis' },
    { firstName: 'Yoni', username: 'yoni_cool' },
    { firstName: 'Ermi', username: 'ermi_addis' },
    { firstName: 'Bini', username: 'bini_addis' },
    { firstName: 'Kiru', username: 'kiru_addis' },
    { firstName: 'Tame', username: 'tame_addis' },
    { firstName: 'Dani', username: 'dani_addis' },
    { firstName: 'Eli', username: 'eli_speed' },
    { firstName: 'Eyobu', username: 'eyobu_addis' },
    { firstName: 'Fasi', username: 'fasi_addis' },
    { firstName: 'Dawe', username: 'dawe_addis' },
    { firstName: 'Gech', username: 'gech_addis' },
    { firstName: 'Haile', username: 'haile_addis' },
    { firstName: 'Neba', username: 'neba_addis' },
    { firstName: 'Naho', username: 'naho_addis' },
    { firstName: 'Beki', username: 'beki_addis' },
    { firstName: 'Dagi', username: 'dagi_addis' },
    { firstName: 'Brooki', username: 'brooki_addis' },
    { firstName: 'Sise', username: 'sise_addis' },
    { firstName: 'Yosi', username: 'yosi_addis' },
    { firstName: 'Sami', username: 'sami_star' },
    { firstName: 'Tari', username: 'tari_addis' },
    { firstName: 'Yare', username: 'yare_addis' },
    { firstName: 'Desta', username: 'desta_addis' },
    { firstName: 'Leul', username: 'leul_addis' },
    { firstName: 'Anti', username: 'anti_addis' },
    { firstName: 'Miki', username: 'miki_pro' },
    { firstName: 'Natan', username: 'natan_addis' },
    { firstName: 'Fika', username: 'fika_addis' },
    { firstName: 'Mela', username: 'mela_addis' },
    { firstName: 'Tesfe', username: 'tesfe_addis' },
    { firstName: 'Girma', username: 'girma_addis' },
    { firstName: 'Temu', username: 'temu_speed' },
    { firstName: 'Zola', username: 'zola_speed' },
    { firstName: 'Habte', username: 'habte_addis' },
    { firstName: 'Bele', username: 'bele_addis' },
    { firstName: 'Mule', username: 'mule_addis' },
    { firstName: 'Worku', username: 'worku_addis' },
    { firstName: 'Fiti', username: 'fiti_addis' },
    { firstName: 'Enda', username: 'enda_addis' },
    { firstName: 'Mule', username: 'mule_speed' },
    { firstName: 'Wonde', username: 'wonde_speed' },
    { firstName: 'Tila', username: 'tila_addis' },
    { firstName: 'Mako', username: 'mako_speed' },
    { firstName: 'Tade', username: 'tade_addis' },
    { firstName: 'Fasi', username: 'fasi_speed' },
    { firstName: 'Mesfin', username: 'mesfin_addis' },
    { firstName: 'Tadele', username: 'tadele_addis' },
    { firstName: 'Gashu', username: 'gashu_addis' },
    { firstName: 'Bere', username: 'bere_addis' },
    { firstName: 'Wondimu', username: 'wondimu_addis' },
    { firstName: 'Deje', username: 'deje_addis' },
    { firstName: 'Negash', username: 'negash_addis' },
    { firstName: 'Ayalu', username: 'ayalu_addis' },
    { firstName: 'Tefera', username: 'tefera_addis' },
    { firstName: 'Seyoum', username: 'seyoum_addis' },
    { firstName: 'Abate', username: 'abate_addis' },
    { firstName: 'Kebe', username: 'kebe_addis' },
    { firstName: 'Tekle', username: 'tekle_addis' },
    { firstName: 'Teshome', username: 'teshome_addis' },
    { firstName: 'Demeke', username: 'demeke_addis' },
    { firstName: 'Birhan', username: 'birhan_addis' },
    { firstName: 'Gedion', username: 'gedion_addis' },
    { firstName: 'Aklu', username: 'aklu_speed' },
    { firstName: 'Ashu', username: 'ashu_addis' },
    { firstName: 'Dere', username: 'dere_addis' },
    { firstName: 'Desi', username: 'desi_speed' },
    { firstName: 'Ephi', username: 'ephi_addis' },

    // ─── Stylized Nicknames (Popular Telegram Styles) ───
    { firstName: 'King Nati', username: 'natiman_07' },
    { firstName: 'Real Dani', username: 'iam_dani' },
    { firstName: 'Only Yoni', username: 'real_yoni' },
    { firstName: 'Big Miki', username: 'callme_miki' },
    { firstName: 'Mr Alex', username: 'mr_alex21' },
    { firstName: 'Bro Sami', username: 'dr_sami12' },
    { firstName: 'Young Sura', username: 'king_sura77' },
    { firstName: 'Pro Beki', username: 'the_beki24' },
    { firstName: 'Captain Teddy', username: 'ted_vibes04' },
    { firstName: 'Bini Addis', username: 'bro_bini' },
    { firstName: 'Dagi Pro', username: 'official_dagi11' },
    { firstName: 'Zola Ethio', username: 'cool_zola45' },
    { firstName: 'Solo Star', username: 'solo_star10' },

    // ─── Additional Authentic Ethiopian Male Names & Telegram Handles ───
    { firstName: 'Robel', username: 'robel_boy7' },
    { firstName: 'Nahom', username: 'nahom_pro9' },
    { firstName: 'Natnael', username: 'natnael_star88' },
    { firstName: 'Surafel', username: 'surafel_addis21' },
    { firstName: 'Yared', username: 'yared_music' },
    { firstName: 'Abel', username: 'abel_habesha' },
    { firstName: 'Ermias', username: 'ermias_cool10' },
    { firstName: 'Bereket', username: 'bereket_speed' },
    { firstName: 'Kaleb', username: 'kaleb_king' },
    { firstName: 'Dawit', username: 'dawit_star' },
    { firstName: 'Henok', username: 'henok_vibes' },
    { firstName: 'Biruk', username: 'biruk_eth' },
    { firstName: 'Samuel', username: 'samuel_pro99' },
    { firstName: 'Mikiyas', username: 'mikiyas_zone' }
];

export class BotService {
    private settings: BotSettings = {
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
    };

    private settingsFilePath = path.join(process.cwd(), 'data', 'settings.json');
    private fillTimeouts: Map<string, NodeJS.Timeout> = new Map();
    private winTimeouts: Map<string, NodeJS.Timeout[]> = new Map();
    private nextBotIndex = 0;

    constructor() {
        this.loadSettings();
    }

    public loadSettings() {
        try {
            const stored = getBotSettings();
            if (stored) {
                const s10Target = typeof stored.stake10Target === 'number' && !isNaN(stored.stake10Target)
                    ? Math.max(0, stored.stake10Target)
                    : (typeof stored.targetPlayers === 'number' && !isNaN(stored.targetPlayers) ? Math.max(0, stored.targetPlayers) : 20);

                const s20Target = typeof stored.stake20Target === 'number' && !isNaN(stored.stake20Target)
                    ? Math.max(0, stored.stake20Target)
                    : 0;

                const targetPlayers = typeof stored.targetPlayers === 'number' && !isNaN(stored.targetPlayers)
                    ? Math.max(0, stored.targetPlayers)
                    : s10Target;

                this.settings = {
                    ...this.settings,
                    ...stored,
                    enabled: stored.enabled !== undefined ? !!stored.enabled : true,
                    stake10Enabled: stored.stake10Enabled !== undefined ? !!stored.stake10Enabled : true,
                    stake10Target: s10Target,
                    stake20Enabled: stored.stake20Enabled !== undefined ? !!stored.stake20Enabled : false,
                    stake20Target: s20Target,
                    targetPlayers: targetPlayers,
                    botReactionMinMs: Number(stored.botReactionMinMs) || 1800,
                    botReactionMaxMs: Number(stored.botReactionMaxMs) || 3200,
                    joinPacing: ['dynamic', 'rapid', 'relaxed'].includes(stored.joinPacing) ? stored.joinPacing : 'dynamic',
                    enabledRooms: Array.isArray(stored.enabledRooms) ? stored.enabledRooms : [10, 20]
                };
            }
        } catch (e) {
            console.error('[BotService] Error reading settings:', e);
        }
    }

    public reloadSettings() {
        this.loadSettings();
    }

    public saveSettings() {
        try {
            setBotSettings(this.settings);
        } catch (e) {
            console.error('[BotService] Error saving settings:', e);
        }
    }

    public getSettings(): BotSettings {
        return { ...this.settings };
    }

    public isStakeEnabled(fee: number): boolean {
        if (!this.settings.enabled) return false;
        if (fee === 10) return !!this.settings.stake10Enabled;
        if (fee === 20) return !!this.settings.stake20Enabled;
        return this.settings.enabledRooms.includes(fee);
    }

    public getStakeTarget(fee: number): number {
        if (fee === 10) return typeof this.settings.stake10Target === 'number' ? this.settings.stake10Target : this.settings.targetPlayers;
        if (fee === 20) return typeof this.settings.stake20Target === 'number' ? this.settings.stake20Target : this.settings.targetPlayers;
        return this.settings.targetPlayers;
    }

    public cancelFillTimeoutsForFee(fee: number) {
        for (const [key, t] of this.fillTimeouts.entries()) {
            if (key.startsWith(`${fee}_`)) {
                clearTimeout(t);
                this.fillTimeouts.delete(key);
            }
        }
    }

    public updateSettings(partial: Partial<BotSettings>): BotSettings {
        if (partial.enabled !== undefined) {
            this.settings.enabled = !!partial.enabled;
            if (!this.settings.enabled) {
                for (const t of this.fillTimeouts.values()) {
                    clearTimeout(t);
                }
                this.fillTimeouts.clear();
            }
        }
        if (partial.stake10Enabled !== undefined) {
            this.settings.stake10Enabled = !!partial.stake10Enabled;
            if (!this.settings.stake10Enabled) {
                this.cancelFillTimeoutsForFee(10);
            }
        }
        if (partial.stake10Target !== undefined) {
            this.settings.stake10Target = Math.max(0, Math.min(300, Number(partial.stake10Target) || 0));
        }
        if (partial.stake20Enabled !== undefined) {
            this.settings.stake20Enabled = !!partial.stake20Enabled;
            if (!this.settings.stake20Enabled) {
                this.cancelFillTimeoutsForFee(20);
            }
        }
        if (partial.stake20Target !== undefined) {
            this.settings.stake20Target = Math.max(0, Math.min(300, Number(partial.stake20Target) || 0));
        }
        if (partial.targetPlayers !== undefined && partial.targetPlayers >= 0 && partial.targetPlayers <= 300) {
            this.settings.targetPlayers = Number(partial.targetPlayers);
        }
        if (partial.botReactionMinMs !== undefined && partial.botReactionMinMs >= 50) {
            this.settings.botReactionMinMs = Number(partial.botReactionMinMs);
        }
        if (partial.botReactionMaxMs !== undefined && partial.botReactionMaxMs >= this.settings.botReactionMinMs) {
            this.settings.botReactionMaxMs = Number(partial.botReactionMaxMs);
        }
        if (partial.joinPacing !== undefined && ['dynamic', 'rapid', 'relaxed'].includes(partial.joinPacing)) {
            this.settings.joinPacing = partial.joinPacing;
        }
        if (Array.isArray(partial.enabledRooms)) {
            this.settings.enabledRooms = partial.enabledRooms.map(Number);
        }
        this.saveSettings();
        return this.getSettings();
    }

    public getBotProfileById(id: bigint | string | number): BotProfile | null {
        try {
            const idBig = typeof id === 'bigint' ? id : BigInt(id);
            let index: number;
            if (idBig < 0n) {
                // Negative virtual IDs: -1, -2, -3...
                index = Number((-idBig) - 1n);
            } else if (idBig >= 9000000000n) {
                // Legacy positive virtual IDs: 9000000001, 9000000002...
                index = Number(idBig - 9000000001n);
            } else {
                return null;
            }
            if (isNaN(index)) return null;
            const safeIdx = ((index % ETHIOPIAN_BOT_PROFILES.length) + ETHIOPIAN_BOT_PROFILES.length) % ETHIOPIAN_BOT_PROFILES.length;
            return ETHIOPIAN_BOT_PROFILES[safeIdx] || null;
        } catch {
            return null;
        }
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

        // Virtual IDs are negative numbers so they NEVER collide with Telegram user IDs
        const virtualId = -BigInt(this.nextBotIndex || 1);

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

        // Broadcast lobby updates to SSE clients (throttled at 400ms for rapid bot onboarding)
        if (typeof (gm as any).broadcastSSEThrottled === 'function') {
            (gm as any).broadcastSSEThrottled('lobby', () => ({
                lobbyCountdown: gm.lobbyCountdown,
                playerCount: gm.players.length,
                boardCount: gm.getTotalBoards(),
                pot: gm.getPot(),
                gameState: gm.state
            }), 400);

            // Broadcast board status update throttled
            (gm as any).broadcastSSEThrottled('boards', () => ({
                boards: gm.getBoards(),
                players: gm.players.length,
                boardCount: gm.getTotalBoards(),
                pot: gm.getPot()
            }), 400);
        } else {
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

        return true;
    }

    /**
     * Called whenever a room enters or resets its WAITING lobby.
     * Pre-seeds 3 to 4 baseline bots immediately and schedules remaining bots across the countdown.
     */
    public async onLobbyOpened(gm: GameManager, fee: number, room: number) {
        if (!this.isStakeEnabled(fee)) return;
        const target = this.getStakeTarget(fee);
        if (target <= 0) return;
        if (gm.state !== 'WAITING') return;

        const key = this.getRoomKey(fee, room);
        if (this.fillTimeouts.has(key)) {
            clearTimeout(this.fillTimeouts.get(key)!);
            this.fillTimeouts.delete(key);
        }

        // Pre-seed baseline bots (3–4 bots, or up to stake target)
        const seedTarget = Math.min(target, Math.floor(Math.random() * 2) + 3);
        const currentBots = gm.players.filter(p => p.isBot).length;
        const botsNeeded = Math.max(0, seedTarget - currentBots);

        for (let i = 0; i < botsNeeded; i++) {
            if (gm.state !== 'WAITING') break;
            await this.addSingleBot(gm, fee);
        }

        // Schedule remaining bots to join across the countdown
        this.onRoomUpdated(gm, fee, room);
    }

    /**
     * Called whenever player membership changes in a waiting room.
     * Schedules remaining bots to join gradually across the 30s countdown.
     */
    public onRoomUpdated(gm: GameManager, fee: number, room: number) {
        const key = this.getRoomKey(fee, room);

        if (this.fillTimeouts.has(key)) {
            clearTimeout(this.fillTimeouts.get(key)!);
            this.fillTimeouts.delete(key);
        }

        if (!this.isStakeEnabled(fee)) return;
        const target = this.getStakeTarget(fee);
        if (target <= 0) return;
        if (gm.state !== 'WAITING') return;

        const botCount = gm.players.filter(p => p.isBot).length;
        if (botCount >= target) {
            return; // Target number of bots reached
        }

        const remainingBots = target - botCount;
        const countdown = Math.max(1, gm.lobbyCountdown || 30);

        let baseDelay: number;
        if (this.settings.joinPacing === 'rapid') {
            baseDelay = Math.floor(Math.random() * 200) + 120; // 120ms - 320ms
        } else if (this.settings.joinPacing === 'relaxed') {
            baseDelay = Math.floor(Math.random() * 600) + 800; // 800ms - 1400ms
        } else {
            // 'dynamic' (default): Dynamically fits all remaining bots within the remaining lobby countdown
            // Reserve 2 seconds before match start so all entries finish cleanly
            const availableMs = Math.max(1000, (countdown - 2) * 1000);
            const idealInterval = Math.floor(availableMs / (remainingBots + 1));
            // When remainingBots is large (> 100), allow lower floor down to 50ms so all 300 bots fit cleanly into 28s
            const floorMs = remainingBots > 100 ? 50 : 120;
            baseDelay = Math.max(floorMs, Math.min(1400, idealInterval));
        }

        // Add natural human jitter (±15%)
        const jitter = Math.floor((Math.random() * 0.3 - 0.15) * baseDelay);
        const minDelay = remainingBots > 100 ? 40 : 80;
        const delay = Math.max(minDelay, baseDelay + jitter);

        const timer = setTimeout(async () => {
            this.fillTimeouts.delete(key);
            const currentBots = gm.players.filter(p => p.isBot).length;
            if (gm.state === 'WAITING' && this.isStakeEnabled(fee) && currentBots < this.getStakeTarget(fee)) {
                const added = await this.addSingleBot(gm, fee);
                if (added) {
                    this.onRoomUpdated(gm, fee, room);
                }
            }
        }, delay).unref();

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
        const key = this.getRoomKey(gm.fee, gm.room);
        this.cancelFillTimeoutsForFee(gm.fee);
        if (this.fillTimeouts.has(key)) {
            clearTimeout(this.fillTimeouts.get(key)!);
            this.fillTimeouts.delete(key);
        }
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
