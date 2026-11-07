import test from 'node:test';
import assert from 'node:assert/strict';

test('Invite-Only Registration Gate & Admin 1783441823 Lineage Tests', async (t) => {
    interface MockUser {
        id: bigint;
        firstName?: string | null;
        phone?: string | null;
        referredById?: bigint | null;
        assignedAdminId?: number | null;
        balance: number;
        bonus: number;
    }

    interface MockAdminProfile {
        id: number;
        userId: bigint;
        code: string;
        customName?: string | null;
        isActive: boolean;
    }

    const SUPER_ADMIN_ID = BigInt('5630606223');
    const TARGET_ADMIN_USER_ID = BigInt('1783441823');
    const TARGET_ADMIN_PROFILE_ID = 10;

    // Simulated Database
    const users: MockUser[] = [
        { id: SUPER_ADMIN_ID, firstName: 'Bety', balance: 500, bonus: 0, referredById: null, assignedAdminId: null },
        { id: TARGET_ADMIN_USER_ID, firstName: 'Admin Abrham', balance: 100, bonus: 0, referredById: null, assignedAdminId: null },
        { id: BigInt('8684362724'), firstName: 'Abu', balance: 50, bonus: 10, referredById: null, assignedAdminId: null },
        { id: BigInt('6258047097'), firstName: 'Dagichu', balance: 20, bonus: 0, referredById: null, assignedAdminId: null },
        { id: BigInt('7923207644'), firstName: 'Maza', balance: 10, bonus: 10, referredById: null, assignedAdminId: null }
    ];

    const adminProfiles: MockAdminProfile[] = [
        { id: TARGET_ADMIN_PROFILE_ID, userId: TARGET_ADMIN_USER_ID, code: 'adm_1783441823', customName: 'Admin Abrham', isActive: true }
    ];

    function backfillUnassignedUsers(usersList: MockUser[], targetAdmin: MockAdminProfile) {
        let updatedCount = 0;
        for (const u of usersList) {
            // Skip target admin himself and Super Admin
            if (u.id === targetAdmin.userId || u.id === SUPER_ADMIN_ID) {
                continue;
            }
            if (u.referredById === null || u.assignedAdminId === null) {
                u.referredById = targetAdmin.userId;
                u.assignedAdminId = targetAdmin.id;
                updatedCount++;
            }
        }
        return updatedCount;
    }

    function evaluateStartCommand(ctx: {
        userId: bigint;
        match?: string;
    }, usersList: MockUser[], adminsList: MockAdminProfile[]) {
        const rawMatch = (ctx.match || '').trim();
        const cleanMatch = rawMatch.toLowerCase();
        const cleanNoPrefix = cleanMatch.replace(/^adm_/, '');

        // 1. Existing user check
        const existing = usersList.find(u => u.id === ctx.userId);
        if (existing) {
            return { action: 'ALLOW_EXISTING', user: existing };
        }

        // 2. Check if Super Admin or Admin Profile
        if (ctx.userId === SUPER_ADMIN_ID || adminsList.some(a => a.userId === ctx.userId && a.isActive)) {
            return { action: 'ALLOW_ADMIN' };
        }

        // 3. Resolve invite/affiliate
        let assignedAdminId: number | null = null;
        let refId: bigint | null = null;

        if (rawMatch) {
            const matchedAdmin = adminsList.find(a => a.isActive && (a.code === cleanMatch || a.code === cleanNoPrefix || a.code === `adm_${cleanNoPrefix}`));
            if (matchedAdmin) {
                assignedAdminId = matchedAdmin.id;
                refId = matchedAdmin.userId;
            } else {
                const refParam = rawMatch.replace(/^ref_?/, '');
                if (/^\d+$/.test(refParam)) {
                    const potentialRef = BigInt(refParam);
                    const refUser = usersList.find(u => u.id === potentialRef);
                    if (refUser) {
                        refId = potentialRef;
                        assignedAdminId = refUser.assignedAdminId || null;
                    }
                }
            }
        }

        // 4. Invite-Only Gate for brand-new users
        const hasValidInvite = Boolean(refId || assignedAdminId);
        if (!hasValidInvite) {
            return {
                action: 'BLOCK_INVITE_ONLY',
                channelUrl: 'https://t.me/ethioBingoOne',
                notice: 'Invitation Required'
            };
        }

        // Register new user
        const newUser: MockUser = {
            id: ctx.userId,
            referredById: refId,
            assignedAdminId: assignedAdminId || TARGET_ADMIN_PROFILE_ID,
            balance: 0,
            bonus: 10
        };
        usersList.push(newUser);
        return { action: 'REGISTER_NEW', user: newUser };
    }

    await t.test('Backfill assigns unreferred users to adm_1783441823', () => {
        const targetAdmin = adminProfiles[0];
        const updated = backfillUnassignedUsers(users, targetAdmin);

        assert.equal(updated, 3, 'Should backfill exactly 3 unreferred regular users (Abu, Dagichu, Maza)');

        const abu = users.find(u => u.id === BigInt('8684362724'));
        assert.equal(abu?.referredById, TARGET_ADMIN_USER_ID);
        assert.equal(abu?.assignedAdminId, TARGET_ADMIN_PROFILE_ID);

        const superAdmin = users.find(u => u.id === SUPER_ADMIN_ID);
        assert.equal(superAdmin?.referredById, null, 'Super Admin must remain unreferred');

        const adminAbrham = users.find(u => u.id === TARGET_ADMIN_USER_ID);
        assert.equal(adminAbrham?.referredById, null, 'Admin Abrham cannot refer himself');
    });

    await t.test('New user searching bot name without invite link is blocked from registering', () => {
        const brandNewUserId = BigInt('1122334455');
        const res = evaluateStartCommand({ userId: brandNewUserId, match: '' }, users, adminProfiles);

        assert.equal(res.action, 'BLOCK_INVITE_ONLY');
        assert.equal(res.channelUrl, 'https://t.me/ethioBingoOne');
        assert.equal(users.some(u => u.id === brandNewUserId), false, 'Brand new user must NOT be added to DB');
    });

    await t.test('New user arriving via adm_1783441823 link successfully registers', () => {
        const brandNewUserId = BigInt('5544332211');
        const res = evaluateStartCommand({ userId: brandNewUserId, match: 'adm_1783441823' }, users, adminProfiles);

        assert.equal(res.action, 'REGISTER_NEW');
        assert.equal(res.user?.referredById, TARGET_ADMIN_USER_ID);
        assert.equal(res.user?.assignedAdminId, TARGET_ADMIN_PROFILE_ID);
        assert.equal(res.user?.bonus, 10);
    });

    await t.test('Existing player searching bot name is permitted directly into the game', () => {
        const existingPlayerId = BigInt('8684362724'); // Abu
        const res = evaluateStartCommand({ userId: existingPlayerId, match: '' }, users, adminProfiles);

        assert.equal(res.action, 'ALLOW_EXISTING');
        assert.equal(res.user?.id, existingPlayerId);
    });

    await t.test('Super Admin searching bot name is permitted directly', () => {
        const res = evaluateStartCommand({ userId: SUPER_ADMIN_ID, match: '' }, users, adminProfiles);
        assert.equal(res.action, 'ALLOW_EXISTING');
    });

    await t.test('Promo kit generates valid Amharic and English copyable templates', () => {
        const botUsername = 'PlayMyBingoBot';
        const referralCode = 'adm_1783441823';
        const link = `https://t.me/${botUsername}?start=${referralCode}`;

        const amharicPromo =
            `🔥 ተወዳጁ የኢትዮ ቢንጎ ጨዋታ! (Ethio Bingo) 🔥\n\n` +
            `💰 አሁኑኑ ተመዝግበው የ 10 ብር የነፃ ቦነስ ያግኙ!\n` +
            `🎮 በ 10 ብር እና በ 20 ብር ይጫወቱ፣ ትልቅ አሸናፊ ይሁኑ!\n` +
            `⚡ ፈጣን የቴሌብር እና የባንክ ክፍያ!\n\n` +
            `👉 ጨዋታውን ለመጀመር ይህንን ሊንክ ይጫኑ:\n` +
            `${link}\n\n` +
            `⚠️ ማሳሰቢያ: ጨዋታው በግብዣ ሊንክ ብቻ ነው የሚሰራው! አሁኑኑ ይቀላቀሉ! 🚀`;

        const englishPromo =
            `🔥 Welcome to Ethio Bingo — The #1 Telegram Bingo Game! 🔥\n\n` +
            `💰 Join now and get a 10 Birr FREE Welcome Bonus!\n` +
            `🎮 Play in 10 Birr & 20 Birr lobbies and win big jackpots!\n` +
            `⚡ Instant withdrawals via Telebirr & Banks!\n\n` +
            `👉 Tap here to join:\n` +
            `${link}\n\n` +
            `⚠️ Note: Invite-only game! You must use this link to enter! 🚀`;

        assert.ok(amharicPromo.includes('https://t.me/PlayMyBingoBot?start=adm_1783441823'));
        assert.ok(englishPromo.includes('https://t.me/PlayMyBingoBot?start=adm_1783441823'));
        assert.ok(amharicPromo.includes('በግብዣ ሊንክ ብቻ'));
        assert.ok(englishPromo.includes('Invite-only game'));
    });
});
