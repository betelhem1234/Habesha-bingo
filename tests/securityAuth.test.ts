import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyMasterPassword } from '../src/auth';
import { createRateLimiter } from '../src/rateLimiter';
import type { Request, Response } from 'express';

test('Security & Authentication Tests', async (t) => {
    await t.test('verifyMasterPassword validates exact match with timingSafeEqual', () => {
        // Correct password
        assert.equal(verifyMasterPassword('eBFqKW8mpvp528ApSKQ&zWpfM4t&'), true);

        // Incorrect passwords
        assert.equal(verifyMasterPassword('wrong_password'), false);
        assert.equal(verifyMasterPassword('habesha_bingo_admin_2026'), false);
        assert.equal(verifyMasterPassword(''), false);
        assert.equal(verifyMasterPassword(null), false);
        assert.equal(verifyMasterPassword(undefined), false);
    });

    await t.test('createRateLimiter blocks requests exceeding threshold with HTTP 429', () => {
        const limiter = createRateLimiter({
            windowMs: 1000,
            maxRequests: 3,
            message: 'Rate limit hit'
        });

        const mockReq = {
            ip: '192.168.1.100',
            headers: {},
            socket: {}
        } as unknown as Request;

        let statusSent = 0;
        let jsonSent: any = null;
        let nextCalled = 0;

        const createMockRes = () => ({
            setHeader: () => {},
            status: (code: number) => {
                statusSent = code;
                return {
                    json: (data: any) => { jsonSent = data; }
                };
            }
        } as unknown as Response);

        const next = () => { nextCalled++; };

        // Calls 1, 2, 3 should succeed
        limiter(mockReq, createMockRes(), next);
        assert.equal(nextCalled, 1);
        limiter(mockReq, createMockRes(), next);
        assert.equal(nextCalled, 2);
        limiter(mockReq, createMockRes(), next);
        assert.equal(nextCalled, 3);

        // Call 4 exceeds threshold (maxRequests = 3)
        limiter(mockReq, createMockRes(), next);
        assert.equal(nextCalled, 3); // next was NOT called
        assert.equal(statusSent, 429);
        assert.equal(jsonSent?.success, false);
        assert.equal(jsonSent?.error, 'Rate limit hit');
    });
});
