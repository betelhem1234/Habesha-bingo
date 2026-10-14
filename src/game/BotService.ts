import fs from 'fs';
import path from 'path';
import { GameManager, Player } from './GameManager';
import { checkWinFreshness, generateTicket } from './bingo';

export interface BotSettings {
    enabled: boolean;
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
    // ─── 213 Authentic Ethiopian Male Profiles (96.8%) ───
    { firstName: 'Dawit', username: 'dawit_b9' },
    { firstName: 'Abebe', username: 'abebe_t' },
    { firstName: 'Henok', username: 'henok_t' },
    { firstName: 'Yared', username: 'yared_w' },
    { firstName: 'Dani', username: 'dani_a' },
    { firstName: 'Biruk', username: 'biruk_eth' },
    { firstName: 'Alex', username: 'alex_m' },
    { firstName: 'Natnael', username: 'nati_d' },
    { firstName: 'Ermias', username: 'ermias_t' },
    { firstName: 'Tewodros', username: 'tedros_a' },
    { firstName: 'Eyob', username: 'eyob_b' },
    { firstName: 'Solomon', username: 'solomon_t' },
    { firstName: 'Biniyam', username: 'bini_s' },
    { firstName: 'Yohannes', username: 'yoni_m' },
    { firstName: 'Robel', username: 'robel_k' },
    { firstName: 'Kirubel', username: 'kiru_a' },
    { firstName: 'Samuel', username: 'samuel_f' },
    { firstName: 'Abel', username: 'abel_g' },
    { firstName: 'Surafel', username: 'sura_m' },
    { firstName: 'Mikiyas', username: 'miki_k' },
    { firstName: 'Kaleb', username: 'kaleb_t' },
    { firstName: 'Desta', username: 'desta_m' },
    { firstName: 'Nebiyu', username: 'neba_s' },
    { firstName: 'Nahom', username: 'nahom_b' },
    { firstName: 'Tamirat', username: 'tame_a' },
    { firstName: 'Million', username: 'milli_k' },
    { firstName: 'Bereket', username: 'beki_eth' },
    { firstName: 'Aman', username: 'aman_t' },
    { firstName: 'Yonatan', username: 'yoni_d' },
    { firstName: 'Fikadu', username: 'fika_eth' },
    { firstName: 'Getachew', username: 'getcho_m' },
    { firstName: 'Haile', username: 'haile_b' },
    { firstName: 'Melaku', username: 'mela_k' },
    { firstName: 'Tesfaye', username: 'tesfe_m' },
    { firstName: 'Aschalew', username: 'aschu_t' },
    { firstName: 'Girma', username: 'girma_b' },
    { firstName: 'Tariku', username: 'tari_k' },
    { firstName: 'Temesgen', username: 'teme_s' },
    { firstName: 'Zelalem', username: 'zola_eth' },
    { firstName: 'Habtamu', username: 'habte_m' },
    { firstName: 'Belete', username: 'bele_t' },
    { firstName: 'Muluken', username: 'mule_eth' },
    { firstName: 'Tsegaye', username: 'tsega_m' },
    { firstName: 'Worku', username: 'worku_k' },
    { firstName: 'Fitsum', username: 'fiti_m' },
    { firstName: 'Endale', username: 'enda_t' },
    { firstName: 'Sintayehu', username: 'sinte_m' },
    { firstName: 'Mulugeta', username: 'mule_g' },
    { firstName: 'Daniel', username: 'dani_m' },
    { firstName: 'Michael', username: 'miki_d' },
    { firstName: 'Leul', username: 'leul_m' },
    { firstName: 'Anteneh', username: 'anti_t' },
    { firstName: 'Dagim', username: 'dagi_m' },
    { firstName: 'Natan', username: 'natan_k' },
    { firstName: 'Brook', username: 'brooki_m' },
    { firstName: 'Abinet', username: 'abi_t' },
    { firstName: 'Sisay', username: 'sise_m' },
    { firstName: 'Kassahun', username: 'kassahun_m' },
    { firstName: 'Getu', username: 'getu_eth' },
    { firstName: 'Baye', username: 'baye_t' },
    { firstName: 'Wondwosen', username: 'wonde_m' },
    { firstName: 'Tilahun', username: 'tila_eth' },
    { firstName: 'Mengistu', username: 'mange_k' },
    { firstName: 'Zewdu', username: 'zewdu_b' },
    { firstName: 'Alemayehu', username: 'alex_t' },
    { firstName: 'Mekonnen', username: 'mako_eth' },
    { firstName: 'Tadesse', username: 'tade_s' },
    { firstName: 'Fasika', username: 'fasi_k' },
    { firstName: 'Belay', username: 'belay_m' },
    { firstName: 'Mesfin', username: 'mesfin_t' },
    { firstName: 'Tadele', username: 'tadele_eth' },
    { firstName: 'Banchu', username: 'banchu_m' },
    { firstName: 'Gashaw', username: 'gashaw_k' },
    { firstName: 'Berhanu', username: 'bere_b' },
    { firstName: 'Wondimu', username: 'wondimu_t' },
    { firstName: 'Dejene', username: 'deje_m' },
    { firstName: 'Negash', username: 'negash_eth' },
    { firstName: 'Ayalew', username: 'ayalu_b' },
    { firstName: 'Mulu', username: 'mulu_eth' },
    { firstName: 'Hailemariam', username: 'haile_m' },
    { firstName: 'Tefera', username: 'tefera_k' },
    { firstName: 'Seyoum', username: 'seyoum_eth' },
    { firstName: 'Abate', username: 'abate_m' },
    { firstName: 'Kebede', username: 'kebe_t' },
    { firstName: 'Tekle', username: 'tekle_eth' },
    { firstName: 'Messele', username: 'messi_m' },
    { firstName: 'Teshome', username: 'teshome_t' },
    { firstName: 'Wubshet', username: 'wube_eth' },
    { firstName: 'Demeke', username: 'demeke_m' },
    { firstName: 'Birhan', username: 'birhan_t' },
    { firstName: 'Gedion', username: 'gedion_eth' },
    { firstName: 'Yidnekachew', username: 'yidne_m' },
    { firstName: 'Aklilu', username: 'aklu_m' },
    { firstName: 'Ashenafi', username: 'ashu_t' },
    { firstName: 'Bekele', username: 'bekele_m' },
    { firstName: 'Berihun', username: 'beri_k' },
    { firstName: 'Bogale', username: 'boge_t' },
    { firstName: 'Chernet', username: 'cheru_eth' },
    { firstName: 'Degife', username: 'dege_m' },
    { firstName: 'Dereje', username: 'dere_t' },
    { firstName: 'Desalegn', username: 'desi_m' },
    { firstName: 'Ephrem', username: 'ephi_k' },
    { firstName: 'Eshetu', username: 'eshe_b' },
    { firstName: 'Fasil', username: 'fasil_g' },
    { firstName: 'Feleke', username: 'fele_m' },
    { firstName: 'Fisseha', username: 'fish_t' },
    { firstName: 'Gebre', username: 'gebre_k' },
    { firstName: 'Gezahegn', username: 'gech_eth' },
    { firstName: 'Gizachew', username: 'gize_m' },
    { firstName: 'Hailu', username: 'hailu_t' },
    { firstName: 'Kasim', username: 'kasim_a' },
    { firstName: 'Kifle', username: 'kifle_m' },
    { firstName: 'Lemma', username: 'lemma_t' },
    { firstName: 'Markos', username: 'markos_eth' },
    { firstName: 'Matiyas', username: 'mati_m' },
    { firstName: 'Menelik', username: 'mene_k' },
    { firstName: 'Merawi', username: 'mera_t' },
    { firstName: 'Minase', username: 'mina_eth' },
    { firstName: 'Moges', username: 'moge_m' },
    { firstName: 'Negatu', username: 'nega_t' },
    { firstName: 'Sahle', username: 'sahle_k' },
    { firstName: 'Samson', username: 'sami_eth' },
    { firstName: 'Setegn', username: 'sete_m' },
    { firstName: 'Shibashi', username: 'shiba_t' },
    { firstName: 'Shimeles', username: 'shime_k' },
    { firstName: 'Shiferaw', username: 'shife_m' },
    { firstName: 'Taddele', username: 'tadde_t' },
    { firstName: 'Takele', username: 'take_b' },
    { firstName: 'Taye', username: 'taye_m' },
    { firstName: 'Tekeste', username: 'teke_t' },
    { firstName: 'Tequame', username: 'teque_m' },
    { firstName: 'Tesfa', username: 'tesfa_eth' },
    { firstName: 'Teshale', username: 'teshe_k' },
    { firstName: 'Tibebu', username: 'tibe_t' },
    { firstName: 'Tigabu', username: 'tiga_m' },
    { firstName: 'Tolosa', username: 'tolo_k' },
    { firstName: 'Workneh', username: 'worku_m' },
    { firstName: 'Yacob', username: 'yacob_t' },
    { firstName: 'Yehualashet', username: 'yehua_m' },
    { firstName: 'Yeshitila', username: 'yeshi_t' },
    { firstName: 'Yonas', username: 'yoni_eth' },
    { firstName: 'Yosef', username: 'yosi_m' },
    { firstName: 'Zerihun', username: 'zeru_k' },
    { firstName: 'Zewge', username: 'zewge_m' },
    { firstName: 'Zinabu', username: 'zina_t' },
    { firstName: 'Abrham', username: 'abresh_m' },
    { firstName: 'Adane', username: 'adu_eth' },
    { firstName: 'Addisu', username: 'addis_t' },
    { firstName: 'Adugna', username: 'adu_m' },
    { firstName: 'Afework', username: 'afe_k' },
    { firstName: 'Alem', username: 'alem_t' },
    { firstName: 'Amare', username: 'ame_m' },
    { firstName: 'Andualem', username: 'andu_eth' },
    { firstName: 'Aragaw', username: 'ara_t' },
    { firstName: 'Assefa', username: 'asse_m' },
    { firstName: 'Asteraw', username: 'aste_k' },
    { firstName: 'Ayele', username: 'aye_t' },
    { firstName: 'Badeg', username: 'badeg_m' },
    { firstName: 'Balcha', username: 'balcha_eth' },
    { firstName: 'Bayisa', username: 'baye_m' },
    { firstName: 'Bazezew', username: 'baze_t' },
    { firstName: 'Belew', username: 'belew_k' },
    { firstName: 'Benyam', username: 'beny_m' },
    { firstName: 'Birara', username: 'bire_t' },
    { firstName: 'Bizuayehu', username: 'bizu_m' },
    { firstName: 'Chekol', username: 'cheke_eth' },
    { firstName: 'Dagnachew', username: 'dagne_m' },
    { firstName: 'Damtew', username: 'damte_t' },
    { firstName: 'Demelash', username: 'deme_k' },
    { firstName: 'Demiss', username: 'demi_m' },
    { firstName: 'Dinku', username: 'dinku_t' },
    { firstName: 'Elias', username: 'eli_eth' },
    { firstName: 'Endalkachew', username: 'enda_k' },
    { firstName: 'Esmael', username: 'esma_m' },
    { firstName: 'Fantahun', username: 'fante_t' },
    { firstName: 'Fenta', username: 'fenta_eth' },
    { firstName: 'Gashawbeza', username: 'gashu_m' },
    { firstName: 'Gebeyehu', username: 'gebe_t' },
    { firstName: 'Getahun', username: 'getu_m' },
    { firstName: 'Gobeze', username: 'gobe_k' },
    { firstName: 'Gorfu', username: 'gorfu_m' },
    { firstName: 'Kassa', username: 'kasse_t' },
    { firstName: 'Kelemu', username: 'kele_eth' },
    { firstName: 'Kibret', username: 'kibre_m' },
    { firstName: 'Kinde', username: 'kinde_t' },
    { firstName: 'Maregu', username: 'mare_m' },
    { firstName: 'Melkamu', username: 'melke_eth' },
    { firstName: 'Mengesha', username: 'menge_m' },
    { firstName: 'Mihret', username: 'mihret_t' },
    { firstName: 'Misganaw', username: 'misge_m' },
    { firstName: 'Mitiku', username: 'mitu_eth' },
    { firstName: 'Molla', username: 'molla_t' },
    { firstName: 'Mulatu', username: 'mule_k' },
    { firstName: 'Nigatu', username: 'niga_m' },
    { firstName: 'Senay', username: 'senay_eth' },
    { firstName: 'Seyfe', username: 'seyfe_t' },
    { firstName: 'Shegaw', username: 'shega_m' },
    { firstName: 'Sileshi', username: 'sile_eth' },
    { firstName: 'Simachew', username: 'sima_t' },
    { firstName: 'Tarekegn', username: 'tari_m' },
    { firstName: 'Tegegne', username: 'tege_eth' },
    { firstName: 'Tekalign', username: 'teka_m' },
    { firstName: 'Tenaw', username: 'tena_t' },
    { firstName: 'Tesfahun', username: 'tesfu_m' },
    { firstName: 'Wale', username: 'wale_eth' },
    { firstName: 'Wassie', username: 'wase_m' },
    { firstName: 'Welde', username: 'welde_t' },
    { firstName: 'Wondie', username: 'wonde_eth' },
    { firstName: 'Yabsira', username: 'yabi_m' },
    { firstName: 'Yalew', username: 'yalew_t' },
    { firstName: 'Yaregal', username: 'yare_eth' },
    { firstName: 'Yetbarek', username: 'yete_m' },
    { firstName: 'Zewdie', username: 'zewdi_eth' },

    // ─── 7 Authentic Ethiopian Female Profiles (3.2%) ───
    { firstName: 'Selam', username: 'selam_m' },
    { firstName: 'Bethlehem', username: 'bethi_g' },
    { firstName: 'Almaz', username: 'almaz_k' },
    { firstName: 'Hanan', username: 'hanan_eth' },
    { firstName: 'Eden', username: 'eden_m' },
    { firstName: 'Mahlet', username: 'mahi_t' },
    { firstName: 'Rahel', username: 'rahel_k' }
];

export class BotService {
    private settings: BotSettings = {
        enabled: true,
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
                        joinPacing: ['dynamic', 'rapid', 'relaxed'].includes(data.botSettings.joinPacing) ? data.botSettings.joinPacing : 'dynamic',
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
        if (partial.targetPlayers !== undefined && partial.targetPlayers >= 2 && partial.targetPlayers <= 300) {
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
            if (idBig < 9000000000n) return null;
            const index = Number(idBig - 9000000001n);
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
        // If room is completely empty (no humans and no bots), nothing to fill
        if (humans.length === 0 && gm.players.length === 0) {
            return;
        }

        const botCount = gm.players.filter(p => p.isBot).length;
        if (botCount >= this.settings.targetPlayers) {
            return; // Target number of bots reached
        }

        const remainingBots = this.settings.targetPlayers - botCount;
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
