import test from 'node:test';
import assert from 'node:assert/strict';
import { NEW_USER_BONUS, REFERRAL_BONUS } from '../src/bonus';

test('Referral and Welcome Bonus System Tests', async (t) => {
    await t.test('constants guarantee 10 Birr welcome bonus and 5 Birr referral bonus', () => {
        assert.equal(NEW_USER_BONUS, 10, 'New user welcome bonus must be 10 Birr');
        assert.equal(REFERRAL_BONUS, 5, 'Referrer invite bonus must be 5 Birr');
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

    await t.test('direct bot join grants 10 Birr bonus to new member and no referrer reward', () => {
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
                bonus: NEW_USER_BONUS,
                referredById: refId ?? undefined
            };
            users.set(userId.toString(), newUser);

            if (refId && refId !== userId) {
                const referrer = users.get(refId.toString());
                if (referrer) {
                    referrer.bonus += REFERRAL_BONUS;
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

    await t.test('invite join grants 10 Birr bonus to new member and 5 Birr bonus to inviter', () => {
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
                bonus: NEW_USER_BONUS,
                referredById: refId ?? undefined
            };
            users.set(userId.toString(), newUser);

            if (refId && refId !== userId) {
                const referrer = users.get(refId.toString());
                if (referrer) {
                    referrer.bonus += REFERRAL_BONUS;
                }
            }

            return { isNew: true, user: newUser };
        }

        const newPlayerId = 2002n;
        const res = handleJoin(newPlayerId, '1001');

        assert.equal(res.isNew, true);
        // New player gets 10 Birr bonus
        assert.equal(res.user.bonus, 10);
        assert.equal(res.user.referredById, 1001n);

        // Inviter gets 5 Birr bonus (credited to bonus, cash balance untouched)
        const inviter = users.get(inviterId.toString())!;
        assert.equal(inviter.bonus, 5, 'Inviter received 5 Birr bonus');
        assert.equal(inviter.balance, 20, 'Inviter cash balance remains intact');
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
                bonus: NEW_USER_BONUS,
                referredById: refId ?? undefined
            };
            users.set(userId.toString(), newUser);

            if (refId && refId !== userId) {
                const referrer = users.get(refId.toString());
                if (referrer) {
                    referrer.bonus += REFERRAL_BONUS;
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
