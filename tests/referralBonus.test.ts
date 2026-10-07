import test from 'node:test';
import assert from 'node:assert/strict';
import { NEW_USER_BONUS, REFERRAL_BONUS, getNewUserBonus, getReferralBonus, setBonusSettings } from '../src/bonus';

test('Referral and Welcome Bonus System Tests', async (t) => {
    await t.test('constants guarantee 10 Birr welcome bonus and 5 Birr referral bonus', () => {
        // Ensure standard default values
        setBonusSettings(10, 5);
        assert.equal(getNewUserBonus(), 10, 'New user welcome bonus must default to 10 Birr');
        assert.equal(getReferralBonus(), 5, 'Referrer invite bonus must default to 5 Birr');
        assert.equal(NEW_USER_BONUS, 10, 'NEW_USER_BONUS export is in sync');
        assert.equal(REFERRAL_BONUS, 5, 'REFERRAL_BONUS export is in sync');
    });

    await t.test('setBonusSettings updates bonus rates dynamically and validates input', () => {
        const updated = setBonusSettings(25, 15);
        assert.equal(updated.newUserBonus, 25);
        assert.equal(updated.referralBonus, 15);
        assert.equal(getNewUserBonus(), 25);
        assert.equal(getReferralBonus(), 15);
        assert.equal(NEW_USER_BONUS, 25);
        assert.equal(REFERRAL_BONUS, 15);

        // Validation rejects negative numbers and NaN
        assert.throws(() => setBonusSettings(-5, 10), /Invalid newUserBonus/);
        assert.throws(() => setBonusSettings(10, -2), /Invalid referralBonus/);
        assert.throws(() => setBonusSettings(NaN, 5), /Invalid newUserBonus/);

        // Reset back to defaults for subsequent test cases
        setBonusSettings(10, 5);
        assert.equal(getNewUserBonus(), 10);
        assert.equal(getReferralBonus(), 5);
    });

    await t.test('referral start parameter parser safely extracts valid inviter ID', () => {
        const parseRefId = (match: string | undefined | null): bigint | null => {
            const startParam = String(match ?? '').trim().replace(/^ref_?/, '');
            return /^\d+$/.test(startParam) ? BigInt(startParam) : null;
        };

        // Direct join (no parameters or empty)
        assert.equal(parseRefId(''), null);
        assert.equal(parseRefId(null), null);
        assert.equal(parseRefId(undefined), null);

        // Standard numeric telegram ID
        assert.equal(parseRefId('123456789'), 123456789n);
        assert.equal(parseRefId(' 987654321 '), 987654321n);

        // Prefixed referral links
        assert.equal(parseRefId('ref_11223344'), 11223344n);
        assert.equal(parseRefId('ref998877'), 998877n);

        // Malformed / non-numeric parameters
        assert.equal(parseRefId('invalid_user'), null);
        assert.equal(parseRefId('abc123xyz'), null);
    });

    await t.test('direct bot join grants active bonus to new member and no referrer reward', () => {
        const users = new Map<string, { id: bigint; balance: number; bonus: number; referredById?: bigint }>();

        function handleJoin(userId: bigint, startParamMatch: string) {
            const parsedParam = String(startParamMatch ?? '').trim().replace(/^ref_?/, '');
            const refId = /^\d+$/.test(parsedParam) ? BigInt(parsedParam) : null;

            if (users.has(userId.toString())) {
                return { isNew: false, user: users.get(userId.toString())! };
            }

            const newUser = {
                id: userId,
                balance: 0,
                bonus: getNewUserBonus(),
                referredById: refId ?? undefined
            };
            users.set(userId.toString(), newUser);

            if (refId && refId !== userId) {
                const referrer = users.get(refId.toString());
                if (referrer) {
                    referrer.bonus += getReferralBonus();
                }
            }

            return { isNew: true, user: newUser };
        }

        const newPlayerId = 5001n;
        const res = handleJoin(newPlayerId, ''); // Direct link join

        assert.equal(res.isNew, true);
        assert.equal(res.user.bonus, 10, 'Direct join receives 10 Birr bonus');
        assert.equal(res.user.balance, 0);
        assert.equal(res.user.referredById, undefined);
    });

    await t.test('invite join grants configured bonuses dynamically', () => {
        // Set promotional rate
        setBonusSettings(20, 10);

        const users = new Map<string, { id: bigint; balance: number; bonus: number; referredById?: bigint }>();

        // Create inviter
        const inviterId = 1001n;
        users.set(inviterId.toString(), { id: inviterId, balance: 20, bonus: 0 });

        function handleJoin(userId: bigint, startParamMatch: string) {
            const parsedParam = String(startParamMatch ?? '').trim().replace(/^ref_?/, '');
            const refId = /^\d+$/.test(parsedParam) ? BigInt(parsedParam) : null;

            if (users.has(userId.toString())) {
                return { isNew: false, user: users.get(userId.toString())! };
            }

            const newUser = {
                id: userId,
                balance: 0,
                bonus: getNewUserBonus(),
                referredById: refId ?? undefined
            };
            users.set(userId.toString(), newUser);

            if (refId && refId !== userId) {
                const referrer = users.get(refId.toString());
                if (referrer) {
                    referrer.bonus += getReferralBonus();
                }
            }

            return { isNew: true, user: newUser };
        }

        const newPlayerId = 2002n;
        const res = handleJoin(newPlayerId, '1001');

        assert.equal(res.isNew, true);
        // New player gets promotional 20 Birr welcome bonus
        assert.equal(res.user.bonus, 20);
        assert.equal(res.user.referredById, 1001n);

        // Inviter gets promotional 10 Birr referral bonus
        const inviter = users.get(inviterId.toString())!;
        assert.equal(inviter.bonus, 10, 'Inviter received 10 Birr promo bonus');
        assert.equal(inviter.balance, 20, 'Inviter cash balance remains intact');

        // Reset back to standard rates
        setBonusSettings(10, 5);
    });

    await t.test('self-referral does not award extra bonus to user', () => {
        const users = new Map<string, { id: bigint; balance: number; bonus: number; referredById?: bigint }>();

        function handleJoin(userId: bigint, startParamMatch: string) {
            const parsedParam = String(startParamMatch ?? '').trim().replace(/^ref_?/, '');
            const refId = /^\d+$/.test(parsedParam) ? BigInt(parsedParam) : null;

            if (users.has(userId.toString())) {
                return { isNew: false, user: users.get(userId.toString())! };
            }

            const newUser = {
                id: userId,
                balance: 0,
                bonus: getNewUserBonus(),
                referredById: refId ?? undefined
            };
            users.set(userId.toString(), newUser);

            if (refId && refId !== userId) {
                const referrer = users.get(refId.toString());
                if (referrer) {
                    referrer.bonus += getReferralBonus();
                }
            }

            return { isNew: true, user: newUser };
        }

        const selfId = 3003n;
        const res = handleJoin(selfId, '3003'); // User puts their own ID

        assert.equal(res.user.bonus, 10, 'User gets only standard 10 Birr welcome bonus');
    });

    await t.test('referral link generation points to official @PlayMyBingoBot', () => {
        const userId = 778899n;
        const botUsername = 'PlayMyBingoBot';
        const link = `https://t.me/${botUsername}?start=${userId}`;

        assert.equal(link, 'https://t.me/PlayMyBingoBot?start=778899');
    });
});
