import fs from 'fs';
import path from 'path';
import { getBotSettings, setBotSettings, getBoardShuffleSeed } from '../settings';
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
    // ─── 1. Sensible Ethiopian Nicknames in English (75 profiles) ───
    
    { firstName: 'Sura', username: 'sura_king' },
    { firstName: 'Beki', username: 'beki_boss' },
    { firstName: 'Alex', username: 'alex_ethio' },
    { firstName: 'Heni', username: 'dj_heni88' },
     { firstName: 'sura tariku', username: 'surafel_addis21' },
    { firstName: 'Natnael', username: 'natnael_star88' },
    { firstName: 'eyoba', username: 'eyob_gamer21' },
    { firstName: 'Kirubel kira', username: 'kirubel_vibe05' },
    { firstName: 'tariku te', username: 'tariku_speed99' },
    { firstName: 'fafi ethio', username: 'fasil_ethio77' },
    { firstName: 'fitsume', username: 'fitsum_star11' },
    { firstName: 'Amanda', username: 'amanuel_vibe' },
    
    { firstName: 'Mule', username: 'mulepower' },
    { firstName: 'Fish', username: 'fish_addis' },
    { firstName: 'Habtish', username: 'habtish_m' },
    { firstName: 'Abush', username: 'abush_addis' },
    
    { firstName: 'Ashu', username: 'ashu_addis' },
    { firstName: 'Jone', username: 'jone13t' },
    { firstName: 'Jossy', username: 'jossy_addis' },
    { firstName: 'Tommy', username: 'tommy_addis' },
    
      { firstName: 'abelaa', username: 'abel_habesha' },
    { firstName: 'sura', username: 'surafel_addis' },
    { firstName: 'kaleb_king', username: 'kaleb_king' },
    { firstName: 'ሄኖክ', username: 'henok_vibes' },
    { firstName: 'ማይክ', username: 'mikiyas_zone' },
    { firstName: 'Dagichu', username: 'dagichu_21' },
    { firstName: 'Chacha', username: 'chacha_eth' },
    { firstName: 'Abrsh', username: 'abrsh_salles' },
    { firstName: 'Abrilo', username: 'abrilo_market' },
    { firstName: 'kirubel_vibe', username: 'kirubel_vibe' },
    { firstName: 'እዮብ', username: 'eyob_addis' },
    { firstName: 'አብረሃም', username: 'abrham_eth' },
     { firstName: 'Aklilu', username: 'aklilu_addis' },
    { firstName: 'Makonnen', username: 'makonnen_addis' },
    { firstName: 'Takele', username: 'takele_addis' },
    { firstName: 'Andualem', username: 'andualem_addis' },
    { firstName: 'Gashaw', username: 'gashaw_addis' },
    { firstName: 'Tewodros', username: 'tewodros_addis' },
    { firstName: 'Getachew', username: 'getachew_fikadu' },
    { firstName: 'Tilahun', username: 'tilahun_addis' },
    { firstName: 'Wubeshet', username: 'wubeshet_addis' },
     { firstName: 'ብሩክ', username: 'b3ura_eth' },
    { firstName: 'ሳሙኤል', username: 'samuel_pro99' },
  
    { firstName: 'ሚክ ዋን', username: 'michael_eth' },
    { firstName: 'ቴዳ መኪና ኪራይ', username: 'tewodros_pro' },
    { firstName: 'Chernet', username: 'chernet_addis' },
    { firstName: 'soli', username: 'solomon_addis' },
    { firstName: 'Sinte', username: 'sinte_eth' },
    { firstName: 'Batu', username: 'batu_addis' },
    { firstName: 'Bura', username: 'buraspeed' },
    { firstName: 'Joni', username: 'joni_99' },
    { firstName: 'Liyu', username: 'liyu_love' },
    { firstName: 'Zedu', username: 'zedu_cool' },
    { firstName: 'lij yoba', username: 'eyobu_boy' },
    { firstName: 'takele', username: 'take_addis' },
     { firstName: 'alex', username: 'alemu_addis' },
    { firstName: 'ልኡል', username: 'leul_addis' },
    { firstName: 'እያዩ', username: 'eyayu_eth' },
    { firstName: 'አባይ', username: 'abay_ethio' },
    { firstName: 'Tolera', username: 'tolera_oromo' },
    { firstName: 'Sami', username: 'sami_love' },
    { firstName: 'Teddy', username: 'teddymusic' },
    { firstName: 'Bini', username: 'bini_23' },
    { firstName: 'Dagi', username: 'dagicool' },
    { firstName: 'Ermi', username: 'ermi_vibes' },
    { firstName: 'Zola', username: 'zolaaddis' },
    { firstName: 'Gech', username: 'gechreal' },
    { firstName: 'ቶማስ', username: 'tomas_addis' },
    { firstName: 'ዮሐንስ', username: 'yohannes_pro' },
    { firstName: 'አቡሽ', username: 'abush_eth' },
    { firstName: 'ዳጊ', username: 'dagi_pro' },
    { firstName: 'gecho', username: 'gecho_addis' },
    { firstName: 'abiti', username: 'tedi_addis' },
    { firstName: 'ቻቻ', username: 'chacha_addis' },
    { firstName: 'Taye', username: 'taye_vibes' },
    { firstName: 'Teka', username: 'teka_star' },
    
    { firstName: 'Balcha', username: 'balcha_vibes' },
    { firstName: 'Dinku', username: 'dinku_speed' },
    { firstName: 'Haile', username: 'haile_addis' },
    { firstName: 'Chala', username: 'chala_oromo' },

    // ─── 2. Full Ethiopian Names in English (75 profiles) ───
    { firstName: 'Elias', username: 'elias_pro21' },
    { firstName: 'Amanuel', username: 'amanuel_ew' },
    { firstName: 'Tariku', username: 'tariku_speed' },
    { firstName: 'Afework', username: 'afework_addis' },
    { firstName: 'Araya', username: 'araya_ethio' },
    { firstName: 'Kelemu', username: 'kelemu_addis' },
    { firstName: 'Simachew', username: 'simachew_pro' },
    { firstName: 'Tegene', username: 'tegene_addis' },
    { firstName: 'Alemu', username: 'alemu_vibes' },
    { firstName: 'Tigabu', username: 'tigabu_star' },
    
    { firstName: 'Solo', username: 'sololife' },
    { firstName: 'Ephi', username: 'ephitech' },
    { firstName: 'Dawe', username: 'dawe_90' },
    { firstName: 'Abuki', username: 'abukihabesha' },
    { firstName: 'Brooki', username: 'brooki_22' },
    { firstName: 'Fasil', username: 'fasil_ethio' },
    { firstName: 'Yared', username: 'yared_music' },
    { firstName: 'Fitsum', username: 'fitsum_star' },
    { firstName: 'Esmael', username: 'esmael_addis' },
    { firstName: 'Endalk', username: 'endalk_pro' },
    { firstName: 'Tekalign', username: 'tekalign_addis' },

    { firstName: 'Adane', username: 'adane_addis' },
    { firstName: 'Bogale', username: 'bogale_star' },
    { firstName: 'Feleke', username: 'feleke_addis' },
    { firstName: 'Moges', username: 'moges_vibes' },
    { firstName: 'Kassahun', username: 'kassahun_addis' },
    { firstName: 'Maru', username: 'maru_addis' },
    { firstName: 'Baye', username: 'baye_addis' },
        { firstName: 'ደመቀ', username: 'demeke_addis' },
    { firstName: 'burak', username: 'birhanu_eth' },
    { firstName: 'አስፋው', username: 'asfaw_addis' },
    { firstName: 'ካሳሁን', username: 'kasahun_addis' },
    { firstName: 'Eshetu', username: 'eshetu_addis' },
    { firstName: 'Zewdu', username: 'zewdu_addis' },
    { firstName: 'Minase', username: 'minase_addis' },
    { firstName: 'Merawi', username: 'merawi_addis' },
    { firstName: 'Mathias', username: 'mathias_motion' },
   
    { firstName: 'Dereje', username: 'dereje_addis' },
    { firstName: 'Desalegn', username: 'desalegn_addis' },
    { firstName: 'Tenaw', username: 'tenaw_addis' },
    { firstName: 'Tesfaye', username: 'tesfaye_pro' },

    { firstName: 'abnet', username: 'abuni21_eth' },
    { firstName: 'በኃይሉ', username: 'behailu_addis' },
    { firstName: 'ስንቴ', username: 'sintayehu_addis' },
    { firstName: 'ዳግም', username: 'dagim_addis' },
    { firstName: 'Gashu', username: 'gashu_pro' },
    { firstName: 'Mame', username: 'mame_boy' },
    { firstName: 'Kassu', username: 'kassu_eth' },
    { firstName: 'Getu', username: 'getu_addis' },
    { firstName: 'Cheru', username: 'cheru_peace' },
    { firstName: 'Desi', username: 'desi_addis' },
    { firstName: 'Dere', username: 'dere_speed' },
    { firstName: 'Mati', username: 'mati_speed' },
    { firstName: 'Nega', username: 'nega_speed' },
    { firstName: 'መልአኩ', username: 'melaku_eth' },
    { firstName: 'ተመስገን', username: 'temesgen_addis' },
    { firstName: 'ታምራት', username: 'tamirat_pro' },
    { firstName: 'ሀብታሙ', username: 'habtamu_addis' },
    { firstName: 'ጌታቸው', username: 'getachew_addis' },
    { firstName: 'Walelign', username: 'walelign_addis' },
    { firstName: 'Melaku', username: 'melaku_addis' },
    { firstName: 'Mengistu', username: 'mengistu_addis' },
    { firstName: 'Misganaw', username: 'misganaw_addis' },
    { firstName: 'Sileshi', username: 'sileshi_addis' },
    { firstName: 'Tibebu', username: 'tibebu_addis' },
    { firstName: 'Zinabu', username: 'zinabu_addis' },
    { firstName: 'ዳዊት', username: 'dawit_d' },
    { firstName: 'ናትናኤል', username: 'natnael_star88' },
    { firstName: 'ሮቤል', username: 'robel_boy7' },

    { firstName: 'Fikru', username: 'fikru_addis' },
    { firstName: 'Paulos', username: 'paulos_addis' },
    { firstName: 'Tena', username: 'tena_addis' },
    { firstName: 'Tesfu', username: 'tesfu_vibes' },
    { firstName: 'Molla', username: 'molla_speed' },
    { firstName: 'Gelan', username: 'gelan_star' },
    { firstName: 'Zeru', username: 'zeru_speed' },
    { firstName: 'Tolassa', username: 'tolassa_eth' },
    { firstName: 'Bayisa', username: 'bayisa_speed' },
    { firstName: 'Petros', username: 'petros_addis' },
    { firstName: 'Biniam', username: 'biniam_pro' },
    { firstName: 'Tamirat', username: 'tamirat_addis' },
    { firstName: 'Surafel', username: 'surafel_addis21' },

    // ─── 3. Authentic Amharic Fidel Script Names (75 profiles) ───
    { firstName: 'yonas enyew', username: 'yonas_enyew' },
    
    { firstName: 'fasilo', username: 'fasil_pro' },
        { firstName: 'Gobeze', username: 'gobeze_addis' },
    { firstName: 'Abebe', username: 'abebe_addis' },
    { firstName: 'Nahom', username: 'nahom_pro9' },
    { firstName: 'Sisay', username: 'sisay_addis' },
    { firstName: 'Anteneh', username: 'anteneh_addis' },
    { firstName: 'Tadesse', username: 'tadesse_addis' },
    { firstName: 'Ayalew', username: 'ayalew_addis' },
    { firstName: 'Birhanu', username: 'birhanu_addis' },
    { firstName: 'ታሪኩ', username: 'tariku_addis' },
    { firstName: 'ቢንያም', username: 'biniam_addis' },
    { firstName: 'ደላላው', username: 'desta_addis' },
    { firstName: 'ግርማ', username: 'girma_addis' },
    { firstName: 'ወርቁ', username: 'worku_addis' },
       { firstName: 'Kiru', username: 'kirustyle' },
    { firstName: 'Yabu', username: 'yabu_vibes' },
    { firstName: 'Shime', username: 'shime_pro' },
    { firstName: 'Wonde', username: 'wonde_eth' },
    { firstName: 'መስፍን', username: 'mesfin_addis' },
    { firstName: 'tade man', username: 'tadele_addis' },
        { firstName: 'Gebeyaw', username: 'gebeyaw_addis' },
    { firstName: 'Ashenafi', username: 'ashenafi_addis' },
    { firstName: 'Ayele', username: 'ayele_pro' },
    { firstName: 'Shiferaw', username: 'shiferaw_addis' },
    { firstName: 'Wassihun', username: 'wassihun_addis' },
    { firstName: 'Yetenaw', username: 'yetenaw_addis' },
    { firstName: 'Hagos', username: 'hagos_ethio' },
    { firstName: 'Belachew', username: 'belachew_addis' },
    { firstName: 'Bereket', username: 'bereket_speed' },
    { firstName: 'Dejene', username: 'dejene_pro' },
    { firstName: 'Kebede', username: 'kebede_addis' },
    { firstName: 'ተፈራ', username: 'tefera_addis' },
    { firstName: 'ስዩም', username: 'seyoum_addis' },
    
    { firstName: 'አማኑኤል', username: 'amanu_ew1' },
    { firstName: 'ፍፁም', username: 'fitsum_addis' },
    { firstName: 'ሙሉቀን', username: 'muluken_addis' },
    { firstName: 'ጥላሁን', username: 'tilahun_star' },
    { firstName: 'Dani', username: 'dani3321' },
    { firstName: 'Yoni', username: 'yoni_pro21' },
    { firstName: 'Nati', username: 'its_nati' },
    { firstName: 'Miki', username: 'miki_star' },
    { firstName: 'እሸቱ', username: 'eshetu_eth' },
    { firstName: 'zed', username: 'zewdu_eth' },
    { firstName: 'አክሊሉ', username: 'aklilu_eth' },
    { firstName: 'ሲሳይ', username: 'sisay_pro' },
   
    { firstName: 'ሃብቴ', username: 'habte_addis' },
    { firstName: 'mulex', username: 'mule_pro' },
    { firstName: 'ኤርሚ', username: 'ermi_addis' },
    { firstName: 'ቢኒዬ', username: 'bini_addis' },
    { firstName: 'Kidu', username: 'kidu_peace' },
    { firstName: 'Robi', username: 'robi_addis' },
    { firstName: 'Neba', username: 'neba_pro' },
    { firstName: 'Tame', username: 'tame_king' },
    { firstName: 'Temu', username: 'temu_speed' },

    { firstName: 'Deme', username: 'deme_pro' },
    { firstName: 'Kalu', username: 'kalu_boy' },
    { firstName: 'Fika', username: 'fika_vibe' },
    { firstName: 'Aschu', username: 'aschu_boy' },
    { firstName: 'ሄኒዬ', username: 'heni_cool' },
    { firstName: 'babi', username: 'beki_addis' },
    { firstName: 'ዞላ', username: 'zola_speed' },
    { firstName: 'neba', username: 'neba_addis' },
    { firstName: 'ታሜ', username: 'tame_addis' },
    { firstName: 'yeburew', username: 'temu_addis' },
    { firstName: 'ዳኒ', username: 'daniye_addis' },
    { firstName: 'sam sam', username: 'samiye_addis' },
    { firstName: 'ዮኒ', username: 'yoniye_addis' },
    { firstName: 'mama afro', username: 'natiye_addis' },
    { firstName: 'አብሽ12', username: 'abrsh_addis' },
    { firstName: 'joni man', username: 'joni_addis' },

    // ─── 4. Stylized Addis Telegram Gamer Handles (33 profiles) ───
    { firstName: 'nati man', username: 'natiman_07' },
    { firstName: 'dan dan', username: 'iam_dani' },
    { firstName: 'beba', username: 'real_yoni' },
    { firstName: 'miki Miki', username: 'callme_miki' },
    { firstName: 'Mr Alex', username: 'mr_alex21' },
    { firstName: 'sa Sami', username: 'dr_sami12' },
    { firstName: 'young sura', username: 'king_sura77' },
    { firstName: 'Pro Beki', username: 'the_beki24' },
    { firstName: 'am captain', username: 'ted_vibes04' },
    { firstName: 'bini nova', username: 'bro_bini' },
    { firstName: 'Dagi Pro', username: 'official_dagi11' },
    { firstName: 'zolla', username: 'cool_zola45' },
    { firstName: 'solo star', username: 'solo_star10' },
    { firstName: 'Robera', username: 'robel_addis24' },
    { firstName: 'nahita', username: 'nahom_gamer' },
    { firstName: 'deva-sol', username: 'dawit_cool77' },
    { firstName: 'henaa3', username: 'henok_music99' },
    { firstName: 'Biruk Nati', username: 'biruk_speed21' },
    { firstName: 'yared music', username: 'yaredoi12' },
    { firstName: 'Kingo', username: 'kaleb_king01' },
    { firstName: 'samuel Pro', username: 'samuel_pro99' },
    { firstName: 'Mikiyas Zone', username: 'mikiyas_zone' },
    { firstName: 'Abel Habesha', username: 'abel_habesha7' },
    { firstName: 'ermias@12', username: 'ermias_cool10' },
    { firstName: 'Bereket', username: 'bereket_speed8' },
   
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
            ticket: generateTicket(bn, getBoardShuffleSeed()),
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
