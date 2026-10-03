/**
 * PWM Translations — Single source of truth for all UI strings.
 * Usage:
 *   1. Add data-i18n="key" to any HTML element.
 *   2. Call PWMTranslations.apply() after DOM ready (auto-called on load).
 *   3. Call PWMTranslations.setLang('en'|'am'|'om') to switch language.
 *   4. Call PWMTranslations.t('key') to get the current string programmatically.
 */
(function () {
    const STORAGE_KEY = 'pwm_lang';

    const TEXTS = {
        en: {
            // ── Nav ──
            nav_games:   'Games',
            nav_scores:  'Scores',
            nav_history: 'History',
            nav_wallet:  'Wallet',
            nav_profile: 'Profile',

            // ── Drawer / Sidebar ──
            balance:      'Balance',
            bonus:        'Bonus',
            quick:        'QUICK ACTIONS',
            deposit:      'Deposit',
            deposit_sub:  'Add funds to your account',
            withdraw:     'Withdraw',
            withdraw_sub: 'Cash out your winnings',
            history:      'Transaction History',
            history_sub:  'View all transactions',
            terms:        'Terms & Conditions',
            terms_sub:    'Rules & fair play policy',
            support:      'Support',
            support_sub:  'Chat with our team',
            channel:      'Channel',
            channel_sub:  'News & updates',
            lang_section: 'LANGUAGE',

            // ── Gameselect ──
            hero_title:   'Choose a Game',
            hero_sub:     'Select a game to play',
            section_live: '🎮 Live Games',
            join_now:     'Join now',
            online:       'online',
            coming_soon:  'Coming Soon',

            // ── Lobby ──
            lobby_back:   'Home',
            live_label:   'LIVE',
            banner_bingo: '🎮 Bingo Room',
            section_bingo:'BINGO GAMES',
            btn_join:     'JOIN',
            btn_try:      'TRY',
            btn_in_play:  'IN PLAY',
            recent_winners:'🏆 RECENT WINNERS',
            no_winners:   'No winners yet',
            players_lbl:  'players',
            waiting:      'Waiting for players…',
            open_rooms:   'Open rooms',
            create_room:  'Create Room',
            color_lbl:    'Color',

            // ── Profile ──
            page_profile: '👤 My Profile',
            referrals:    'REFERRALS',
            games_played: 'GAMES',
            tg_id:        '🪪 Telegram ID',
            phone:        '📱 Phone',
            joined:       '📅 Joined',
            referred_by:  '🤝 Referred by',
            ref_link_title:'🔗 YOUR REFERRAL LINK',
            copy_link:    '📋 Copy Link',
            not_registered:'Not registered',

            // ── Wallet ──
            page_wallet:  '💼 My Wallet',
            main_balance: 'MAIN BALANCE',
            btn_deposit:  '💳 Deposit',
            btn_withdraw: '⬆️ Withdraw',
            how_deposit:  'ℹ️ HOW DEPOSIT WORKS',
            deposit_tip1: 'Click Deposit, choose the bank account, enter the amount and upload your payment screenshot.',
            deposit_tip2: 'The admin will verify and approve. Your balance is credited after approval.',
            deposit_tip3: 'To withdraw, click Withdraw, enter the amount and your Telebirr number.',
            recent_activity:'🕒 RECENT ACTIVITY',
            loading:      'Loading...',
            no_activity:  'No activity yet',

            // ── History ──
            page_history: '🕒 Game History',
            stat_games:   'GAMES',
            stat_wins:    'WINS',
            stat_net:     'NET +BIRR',
            recent_plays: '📜 RECENT PLAYS',
            no_games:     'No games played yet. Go play!',
            bet_label:    'Bet',
            result_won:   'WON',
            result_lost:  'LOST',
            result_nowin: 'NO WINNER',

            // ── Scores ──
            page_scores:  '🏆 Scoreboard',
            top_players:  '⭐ TOP PLAYERS',
            recent_winners_scores:'🔥 RECENT WINNERS',
            no_players:   'No players yet',
        },

        am: {
            // ── Nav ──
            nav_games:   'ጨዋታዎች',
            nav_scores:  'ነጥቦች',
            nav_history: 'ታሪክ',
            nav_wallet:  'ቦርሳ',
            nav_profile: 'መገለጫ',

            // ── Drawer ──
            balance:      'ቀሪ ሂሳብ',
            bonus:        'ቦነስ',
            quick:        'ፈጣን ድርጊቶች',
            deposit:      'ገንዘብ ያስቀምጡ',
            deposit_sub:  'ሂሳብዎን ይሙሉ',
            withdraw:     'ገንዘብ ያውጡ',
            withdraw_sub: 'ያሸነፉትን ያውጡ',
            history:      'የግብይት ታሪክ',
            history_sub:  'ሁሉንም ግብይቶች ይመልከቱ',
            terms:        'ደንቦቻን ሁኔታዎች',
            terms_sub:    'ህጎች እና ፍትሃዊ ጨዋታ',
            support:      'ድጋፍ',
            support_sub:  'ቡድናችን ጋር ይነጋገሩ',
            channel:      'ቻናል',
            channel_sub:  'ዜናዎች እና ዝማኔዎች',
            lang_section: 'ቋንቋ ይምረጡ',

            // ── Gameselect ──
            hero_title:   'ጨዋታ ይምረጡ',
            hero_sub:     'ጨዋታ ይምረጡ',
            section_live: '🎮 ቀጥታ ጨዋታዎች',
            join_now:     'አሁን ይቀላቀሉ',
            online:       'ተጫዋቾች',
            coming_soon:  'በቅርቡ',

            // ── Lobby ──
            lobby_back:   'ዋና ገፅ',
            live_label:   'ቀጥታ',
            banner_bingo: '🎮 ቢንጎ ክፍል',
            section_bingo:'ቢንጎ ጨዋታዎች',
            btn_join:     'ይቀላቀሉ',
            btn_try:      'ሞክሩ',
            btn_in_play:  'በጨዋታ ላይ',
            recent_winners:'🏆 የቅርብ ጊዜ አሸናፊዎች',
            no_winners:   'እስካሁን አሸናፊ የለም',
            players_lbl:  'ተጫዋቾች',
            waiting:      'ተጫዋቾችን በመጠበቅ ላይ…',
            open_rooms:   'ክፍት ክፍሎች',
            create_room:  'ክፍል ፍጠር',
            color_lbl:    'ቀለም',

            // ── Profile ──
            page_profile: '👤 የእኔ መገለጫ',
            referrals:    'ጋባዥዎች',
            games_played: 'ጨዋታዎች',
            tg_id:        '🪪 ቴሌግራም መለያ',
            phone:        '📱 ስልክ',
            joined:       '📅 ተቀላቅሏል',
            referred_by:  '🤝 የተጋበዘው',
            ref_link_title:'🔗 የሪፈራል ሊንክዎ',
            copy_link:    '📋 ሊንክ ቅዳ',
            not_registered:'አልተመዘገበም',

            // ── Wallet ──
            page_wallet:  '💼 የእኔ ቦርሳ',
            main_balance: 'ዋና ቀሪ ሂሳብ',
            btn_deposit:  '💳 ያስቀምጡ',
            btn_withdraw: '⬆️ ያውጡ',
            how_deposit:  'ℹ️ ገንዘብ ማስቀመጥ እንዴት ነው',
            deposit_tip1: 'ያስቀምጡን ጠቅ ያድርጉ፣ ወደምን ዐ/ሂሳብ እንደሚልኩ ይምረጡ፣ ስክሪንሾት ያስቀምጡ።',
            deposit_tip2: 'አስተዳዳሪው ክፍያዎን ያረጋግጣል። ሂሳብዎ ከፀደቀ በኋላ ይጨምራል።',
            deposit_tip3: 'ለማውጣት ያውጡን ጠቅ ያድርጉ፣ መጠኑን እና ቴሌብር ቁጥርዎን ያስገቡ።',
            recent_activity:'🕒 የቅርብ ጊዜ እንቅስቃሴ',
            loading:      'በመጫን ላይ...',
            no_activity:  'እስካሁን እንቅስቃሴ የለም',

            // ── History ──
            page_history: '🕒 የጨዋታ ታሪክ',
            stat_games:   'ጨዋታዎች',
            stat_wins:    'ድሎች',
            stat_net:     'ትርፍ +ብር',
            recent_plays: '📜 የቅርብ ጊዜ ጨዋታዎች',
            no_games:     'እስካሁን ጨዋታ አልተጫወቱም።',
            bet_label:    'ውርርድ',
            result_won:   'አሸነፉ',
            result_lost:  'ተሸነፉ',
            result_nowin: 'አሸናፊ የለም',

            // ── Scores ──
            page_scores:  '🏆 የሰሌዳ ነጥቦች',
            top_players:  '⭐ ምርጥ ተጫዋቾች',
            recent_winners_scores:'🔥 የቅርብ ጊዜ አሸናፊዎች',
            no_players:   'እስካሁን ተጫዋቾች የሉም',
        },

        om: {
            // ── Nav ──
            nav_games:   'Taphoota',
            nav_scores:  'Sadarkaa',
            nav_history: 'Seenaa',
            nav_wallet:  'Saalphoo',
            nav_profile: 'Eenyummaa',

            // ── Drawer ──
            balance:      'Herrega',
            bonus:        'Badhaasa',
            quick:        'TARKAANFII HATATTAMA',
            deposit:      'Maallaqaa Galchi',
            deposit_sub:  'Herrega keessan guutaa',
            withdraw:     'Maallaqaa Baasi',
            withdraw_sub: 'Mo\'umsa keessan baasaa',
            history:      'Seenaa Hojii',
            history_sub:  'Hojii hunda ilaali',
            terms:        'Haala fi Ulaagaalee',
            terms_sub:    'Seerota fi tapho haqa qabeessa',
            support:      'Gargaarsa',
            support_sub:  'Garee keenya dubbisi',
            channel:      'Chaanaalii',
            channel_sub:  'Oduu fi haaromsa',
            lang_section: 'Afaan Filaa',

            // ── Gameselect ──
            hero_title:   'Tapho Filii',
            hero_sub:     'Tapho barbaachisu filadhu',
            section_live: '🎮 Taphoota Kallattii',
            join_now:     'Amma Makamaa',
            online:       'taphataa',
            coming_soon:  'Dhufaa jira',

            // ── Lobby ──
            lobby_back:   'Mana',
            live_label:   'KALLATTII',
            banner_bingo: '🎮 Kutaa Bingo',
            section_bingo:'TAPHOOTA BINGO',
            btn_join:     'MAKAMAA',
            btn_try:      'YAALI',
            btn_in_play:  'TAPHACHAA JIRA',
            recent_winners:'🏆 Mo\'attoota Dhihoo',
            no_winners:   'Mo\'attoon hin jiru',
            players_lbl:  'taphattoota',
            waiting:      'Taphattoota eegaa…',
            open_rooms:   'Kutaa banaa',
            create_room:  'Kutaa Uumi',
            color_lbl:    'Halluu',

            // ── Profile ──
            page_profile: '👤 Eenyummaa Koo',
            referrals:    'WAAMITOOTA',
            games_played: 'TAPHOOTA',
            tg_id:        '🪪 ID Telegram',
            phone:        '📱 Bilbila',
            joined:       '📅 Galee',
            referred_by:  '🤝 Kan Waame',
            ref_link_title:'🔗 LINK REFERRAL KEETII',
            copy_link:    '📋 Link Kopi Godhi',
            not_registered:'Hin galmoofne',

            // ── Wallet ──
            page_wallet:  '💼 Saalphoo Koo',
            main_balance: 'HERREGA GUDDAA',
            btn_deposit:  '💳 Galchi',
            btn_withdraw: '⬆️ Baasi',
            how_deposit:  'ℹ️ AKKAM MAALLAQAA GALCHUU',
            deposit_tip1: 'Galchi tuqi, baankii filadhu, maallaqa galchi, screenshot ergii.',
            deposit_tip2: 'Bulchaan mirkaneessa. Herrega kee erga mirkanaayee booda ni guutama.',
            deposit_tip3: 'Baasuu: Baasi tuqi, maallaqa fi lakkoofsa Telebirr keessan galchii.',
            recent_activity:'🕒 Hojii Dhihoo',
            loading:      'Fe\'achaa jira...',
            no_activity:  'Hojiin hin jiru',

            // ── History ──
            page_history: '🕒 Seenaa Tapho',
            stat_games:   'TAPHOOTA',
            stat_wins:    'MO\'UMSA',
            stat_net:     'FAAYIDAA',
            recent_plays: '📜 TAPHANNOO DHIHOO',
            no_games:     'Tapho hin taphatamne. Deemii taphadhu!',
            bet_label:    'Kaasaa',
            result_won:   'MO\'ATE',
            result_lost:  'ITTI KUFAME',
            result_nowin: 'MO\'ATTOON YOK',

            // ── Scores ──
            page_scores:  '🏆 Sadarkaa',
            top_players:  '⭐ TAPHATTOOTA IRRA CAALAA',
            recent_winners_scores:'🔥 MO\'ATTOOTA DHIHOO',
            no_players:   'Taphattooti hin jiran',
        }
    };

    function getLang() {
        return localStorage.getItem(STORAGE_KEY) || 'en';
    }

    function setLang(lang) {
        if (!TEXTS[lang]) return;
        localStorage.setItem(STORAGE_KEY, lang);
        apply(lang);
        // fire a custom event so pages can hook in
        document.dispatchEvent(new CustomEvent('pwm:langchange', { detail: { lang } }));
    }

    function t(key, lang) {
        const l = lang || getLang();
        return (TEXTS[l] && TEXTS[l][key]) || (TEXTS.en && TEXTS.en[key]) || key;
    }

    function apply(lang) {
        const l = lang || getLang();
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            const val = t(key, l);
            if (val !== undefined) el.textContent = val;
        });
        // update lang pill active state if present
        ['en', 'am', 'om'].forEach(code => {
            const pill = document.getElementById('pill-' + code);
            if (pill) pill.classList.toggle('active', code === l);
        });
    }

    // Auto-apply on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => apply());
    } else {
        apply();
    }

    // Expose globally
    window.PWMTranslations = { t, setLang, getLang, apply, TEXTS };
}());
