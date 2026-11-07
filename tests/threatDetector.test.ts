import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { normalizeIp, isValidIp } from '../src/security/ipUtils';
import { threatDetector } from '../src/security/threatDetector';
import { generateAdminToken, isValidAdminToken } from '../src/auth';

test('Threat Detector & IP Normalization Security Tests', async (t) => {
    await t.test('normalizeIp cleanly extracts IP from angle brackets, quotes, and IPv6 prefixes', () => {
        assert.equal(normalizeIp('<196.188.35.7>'), '196.188.35.7');
        assert.equal(normalizeIp('<196.190.156.57>'), '196.190.156.57');
        assert.equal(normalizeIp('[196.190.156.57]'), '196.190.156.57');
        assert.equal(normalizeIp('"196.190.156.57"'), '196.190.156.57');
        assert.equal(normalizeIp("'196.190.156.57'"), '196.190.156.57');
        assert.equal(normalizeIp('::ffff:196.190.156.57'), '196.190.156.57');
        assert.equal(normalizeIp('  196.190.156.57:8080  '), '196.190.156.57');
        assert.equal(normalizeIp('127.0.0.1'), '127.0.0.1');
    });

    await t.test('isValidIp correctly identifies valid and invalid IP addresses', () => {
        assert.equal(isValidIp('196.188.35.7'), true);
        assert.equal(isValidIp('<196.190.156.57>'), true);
        assert.equal(isValidIp('::1'), true);
        assert.equal(isValidIp('2001:0db8:85a3:0000:0000:8a2e:0370:7334'), true);

        assert.equal(isValidIp(''), false);
        assert.equal(isValidIp('not_an_ip'), false);
        assert.equal(isValidIp('999.999.999.999'), false);
        assert.equal(isValidIp('192.168.1'), false);
    });

    await t.test('Jailing with angle brackets correctly bans clean IP and blocks middleware', () => {
        const testIp = '196.190.156.57';
        // Ban using angle brackets as typed by admin
        threatDetector.jailIp(`<${testIp}>`, 'Manual ban with brackets');

        // Verify clean IP is recognized as jailed
        assert.equal(threatDetector.isIpJailed(testIp), true);
        assert.equal(threatDetector.isIpJailed(`<${testIp}>`), true);
        assert.equal(threatDetector.isIpJailed(`::ffff:${testIp}`), true);

        // Test ipJailMiddleware
        const mockReq = {
            headers: { 'cf-connecting-ip': testIp },
            socket: {}
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

        threatDetector.ipJailMiddleware(mockReq, mockRes, () => { nextCalled = true; });

        assert.equal(nextCalled, false, 'Middleware must NOT call next() for jailed IP');
        assert.equal(statusSent, 403, 'Middleware must return HTTP 403 Forbidden');
        assert.equal(jsonSent?.success, false);
        assert.match(jsonSent?.error, /temporarily restricted/i);

        // Clean up
        threatDetector.unbanIp(testIp);
        assert.equal(threatDetector.isIpJailed(testIp), false);
    });

    await t.test('Jailing an IP immediately terminates active admin sessions for that IP', () => {
        const targetIp = '196.188.35.7';
        // Generate an active admin session for this IP
        const sessionToken = generateAdminToken(targetIp);
        assert.equal(isValidAdminToken(sessionToken), true, 'Session should initially be active');

        // Now ban the IP (with or without brackets)
        threatDetector.jailIp(`<${targetIp}>`, 'Attacker banned');

        // Verify session was immediately destroyed
        assert.equal(isValidAdminToken(sessionToken), false, 'Session must be immediately revoked upon IP ban');

        // Clean up
        threatDetector.unbanIp(targetIp);
    });

    await t.test('Unbanning with angle brackets successfully unbans the IP', () => {
        const testIp = '10.20.30.40';
        threatDetector.jailIp(testIp, 'Temporary ban');
        assert.equal(threatDetector.isIpJailed(testIp), true);

        const unbanned = threatDetector.unbanIp(`<${testIp}>`);
        assert.equal(unbanned, true);
        assert.equal(threatDetector.isIpJailed(testIp), false);
    });
});
