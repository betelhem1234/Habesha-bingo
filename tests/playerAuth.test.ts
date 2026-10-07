import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { signPlayerToken, verifyPlayerToken, verifyTelegramWebAppData, requirePlayerOwnership } from '../src/playerAuth';
import { config } from '../src/config';
import type { Request, Response } from 'express';

test('Player Auth & Cryptographic Signature Tests', async (t) => {
    await t.test('signPlayerToken and verifyPlayerToken validate genuine tokens', () => {
        const userId = BigInt('5630606223');
        const token = signPlayerToken(userId);

        const res = verifyPlayerToken(token);
        assert.equal(res.valid, true);
        assert.equal(res.userId, userId);
    });

    await t.test('verifyPlayerToken rejects tampered tokens', () => {
        const userId = BigInt('5630606223');
        const token = signPlayerToken(userId);

        // Tamper with userId or signature
        const tampered = token.replace('5630606223', '9999999999');
        const res = verifyPlayerToken(tampered);
        assert.equal(res.valid, false);
        assert.equal(res.userId, null);
    });

    await t.test('verifyTelegramWebAppData verifies authentic Telegram signature', () => {
        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(config.BOT_TOKEN).digest();
        const userObj = JSON.stringify({ id: 12345678, first_name: 'Abebe', username: 'abebe1' });
        const authDate = Math.floor(Date.now() / 1000).toString();

        const params: Record<string, string> = {
            auth_date: authDate,
            query_id: 'AAHdF6IQAAAAAN0XohD1nF8t',
            user: userObj
        };

        const sortedKeys = Object.keys(params).sort();
        const dataCheckString = sortedKeys.map(k => `${k}=${params[k]}`).join('\n');
        const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

        const initData = `auth_date=${authDate}&query_id=AAHdF6IQAAAAAN0XohD1nF8t&user=${encodeURIComponent(userObj)}&hash=${hash}`;

        const verified = verifyTelegramWebAppData(initData);
        assert.notEqual(verified, null);
        assert.equal(verified?.id, BigInt(12345678));
        assert.equal(verified?.username, 'abebe1');
    });

    await t.test('requirePlayerOwnership blocks impersonation when user A attempts action on user B', () => {
        const attackerId = BigInt('11111111');
        const victimId = BigInt('22222222');
        const attackerToken = signPlayerToken(attackerId);

        const mockReq = {
            headers: { 'x-player-token': attackerToken },
            query: {},
            body: { userId: victimId.toString() }
        } as unknown as Request;

        let statusSent = 0;
        let jsonSent: any = null;
        let nextCalled = false;

        const mockRes = {
            status: (code: number) => {
                statusSent = code;
                return {
                    json: (data: any) => { jsonSent = data; }
                };
            }
        } as unknown as Response;

        const middleware = requirePlayerOwnership((req) => (req as any).body?.userId);
        middleware(mockReq, mockRes, () => { nextCalled = true; });

        assert.equal(nextCalled, false);
        assert.equal(statusSent, 403); // Forbidden
        assert.equal(jsonSent?.success, false);
        assert.match(jsonSent?.error, /cannot access or perform actions on another player/i);
    });
});
