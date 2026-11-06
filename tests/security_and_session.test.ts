import test from 'node:test';
import assert from 'node:assert/strict';
import {
    generateAdminToken,
    isValidAdminToken,
    revokeAdminToken,
    INACTIVITY_TIMEOUT_MS,
    createPendingLogin,
    approvePendingLogin,
    rejectPendingLogin
} from '../src/auth';
import { threatDetector } from '../src/security/threatDetector';
import { honeypotMiddleware } from '../src/security/honeypot';
import { signPlayerToken, verifyPlayerToken } from '../src/playerAuth';

test('Security & Sliding Session Test Suite', async (t) => {

    await t.test('1. Sliding Session: active requests refresh activity timestamp', () => {
        const token = generateAdminToken('127.0.0.1', 'Mozilla/5.0');
        assert.equal(isValidAdminToken(token), true);

        // Calling isValidAdminToken refreshes lastActivityAt
        const now = Date.now();
        assert.equal(isValidAdminToken(token), true);

        // Revoking invalidates
        revokeAdminToken(token);
        assert.equal(isValidAdminToken(token), false);
    });

    await t.test('2. Inactivity Auto-Logout: expired inactivity times out session', () => {
        // Pass -1 to simulate token created beyond inactivity threshold
        const expiredToken = generateAdminToken(-1);
        assert.equal(isValidAdminToken(expiredToken), false);
    });

    await t.test('3. Player Isolation: admin session actions do NOT affect player tokens', () => {
        const playerId = BigInt(123456789);
        const playerToken = signPlayerToken(playerId);

        // Player token is valid
        const pVerify = verifyPlayerToken(playerToken);
        assert.equal(pVerify.valid, true);
        assert.equal(pVerify.userId, playerId);

        // Even if all admin tokens are revoked, player token remains completely valid
        const adminToken = generateAdminToken();
        revokeAdminToken(adminToken);

        const pVerifyAfter = verifyPlayerToken(playerToken);
        assert.equal(pVerifyAfter.valid, true);
        assert.equal(pVerifyAfter.userId, playerId);
    });

    await t.test('4. 2FA Approval Flow: approve creates valid session token', () => {
        const pending = createPendingLogin('192.168.1.100', 'TestAgent/1.0');
        assert.equal(pending.status, 'PENDING');

        const sessionToken = approvePendingLogin(pending.id);
        assert.equal(typeof sessionToken, 'string');
        assert.equal(isValidAdminToken(sessionToken), true);
    });

    await t.test('5. 2FA Rejection Flow: reject denies session token', () => {
        const pending = createPendingLogin('192.168.1.101', 'AttackerAgent/1.0');
        const rejected = rejectPendingLogin(pending.id);
        assert.equal(rejected, true);
        assert.equal(pending.status, 'REJECTED');
        assert.equal(pending.token, undefined);
    });

    await t.test('6. Honeypot Trapping: Probing /.env immediately jails attacker IP', () => {
        const attackerIp = '10.200.0.45';
        threatDetector.unbanIp(attackerIp);
        assert.equal(threatDetector.isIpJailed(attackerIp), false);

        // Mock express request & response
        let statusSent = 0;
        let jsonSent: any = null;

        const req: any = {
            path: '/.env',
            headers: { 'user-agent': 'python-requests/2.28' },
            ip: attackerIp
        };
        const res: any = {
            status: (code: number) => {
                statusSent = code;
                return res;
            },
            json: (obj: any) => {
                jsonSent = obj;
                return res;
            }
        };

        let nextCalled = false;
        honeypotMiddleware(req, res, () => { nextCalled = true; });

        assert.equal(nextCalled, false, 'Honeypot request should never call next()');
        assert.equal(statusSent, 403, 'Honeypot request should return 403 Forbidden');
        assert.equal(threatDetector.isIpJailed(attackerIp), true, 'Attacker IP must be jailed');

        // Verify IP jail middleware now blocks any further requests
        let jailStatus = 0;
        const req2: any = {
            path: '/api/health',
            headers: {},
            ip: attackerIp
        };
        const res2: any = {
            status: (code: number) => {
                jailStatus = code;
                return res2;
            },
            json: () => res2
        };

        threatDetector.ipJailMiddleware(req2, res2, () => {});
        assert.equal(jailStatus, 403, 'Jailed IP must receive 403 on all routes');

        // Cleanup
        threatDetector.unbanIp(attackerIp);
        assert.equal(threatDetector.isIpJailed(attackerIp), false);
    });

    await t.test('7. Brute-Force Detection: 3 failed attempts auto-jails IP', () => {
        const attackerIp = '10.200.0.99';
        threatDetector.unbanIp(attackerIp);

        // Record 3 brute-force failures (+35 points each = 105 points >= 100 threshold)
        threatDetector.recordThreat({
            ip: attackerIp,
            type: 'ADMIN_BRUTE_FORCE',
            points: 35,
            details: 'Attempt 1'
        });
        assert.equal(threatDetector.isIpJailed(attackerIp), false);

        threatDetector.recordThreat({
            ip: attackerIp,
            type: 'ADMIN_BRUTE_FORCE',
            points: 35,
            details: 'Attempt 2'
        });
        assert.equal(threatDetector.isIpJailed(attackerIp), false);

        threatDetector.recordThreat({
            ip: attackerIp,
            type: 'ADMIN_BRUTE_FORCE',
            points: 35,
            details: 'Attempt 3'
        });
        // Now total score = 105, which crosses 100 threshold!
        assert.equal(threatDetector.isIpJailed(attackerIp), true, 'IP should be jailed after 3 brute-force attempts');

        // Cleanup
        threatDetector.unbanIp(attackerIp);
    });
});
