import test from 'node:test';
import assert from 'node:assert/strict';
import { generateAdminToken, isValidAdminToken, revokeAdminToken } from '../src/auth';
import { config } from '../src/config';

test('Auth System Tests', async (t) => {
    await t.test('generates valid 64-char hex session tokens', () => {
        const token = generateAdminToken(1);
        assert.equal(typeof token, 'string');
        assert.equal(token.length, 64);
        assert.equal(isValidAdminToken(token), true);
    });

    await t.test('accepts config.ADMIN_PASSWORD directly', () => {
        assert.equal(isValidAdminToken(config.ADMIN_PASSWORD), true);
    });

    await t.test('rejects empty, undefined, or invalid tokens', () => {
        assert.equal(isValidAdminToken(''), false);
        assert.equal(isValidAdminToken('random_garbage_string'), false);
        assert.equal(isValidAdminToken(null as any), false);
        assert.equal(isValidAdminToken(undefined as any), false);
    });

    await t.test('revoking a token invalidates it', () => {
        const token = generateAdminToken(1);
        assert.equal(isValidAdminToken(token), true);
        revokeAdminToken(token);
        assert.equal(isValidAdminToken(token), false);
    });

    await t.test('expired tokens are invalid', () => {
        // ttl -1 hours -> expires in past
        const token = generateAdminToken(-1);
        assert.equal(isValidAdminToken(token), false);
    });
});
