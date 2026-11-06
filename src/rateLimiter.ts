import type { Request, Response, NextFunction } from 'express';
import { threatDetector } from './security/threatDetector';

interface RateLimitRecord {
    count: number;
    resetTime: number;
}

export interface RateLimiterOptions {
    windowMs: number;
    maxRequests: number;
    message?: string;
    keyGenerator?: (req: Request) => string;
}

export function getClientIp(req: Request): string {
    return threatDetector.extractClientIp(req);
}

export function createRateLimiter(options: RateLimiterOptions) {
    const hits = new Map<string, RateLimitRecord>();
    const { windowMs, maxRequests, message = 'Too many requests. Please try again later.' } = options;

    // Prune stale records every minute
    const interval = setInterval(() => {
        const now = Date.now();
        for (const [key, record] of hits.entries()) {
            if (now > record.resetTime) {
                hits.delete(key);
            }
        }
    }, 60 * 1000);
    interval.unref();

    return (req: Request, res: Response, next: NextFunction) => {
        const key = options.keyGenerator ? options.keyGenerator(req) : getClientIp(req);
        const now = Date.now();
        const existing = hits.get(key);

        if (!existing || now > existing.resetTime) {
            hits.set(key, { count: 1, resetTime: now + windowMs });
            return next();
        }

        existing.count++;
        if (existing.count > maxRequests) {
            const retryAfterSec = Math.ceil((existing.resetTime - now) / 1000);
            res.setHeader('Retry-After', retryAfterSec.toString());

            // If an IP repeatedly triggers the rate limit, report to threat detector
            if (existing.count === maxRequests + 1 || existing.count === maxRequests * 3) {
                const ip = getClientIp(req);
                threatDetector.recordThreat({
                    ip,
                    type: 'RATE_LIMIT_SPIKE',
                    points: existing.count > maxRequests * 2 ? 40 : 20,
                    details: `Rate limit exceeded (${existing.count}/${maxRequests} reqs) on ${req.originalUrl || req.path}`,
                    path: req.originalUrl || req.path
                });
            }

            return res.status(429).json({
                success: false,
                error: message,
                retryAfter: retryAfterSec
            });
        }

        next();
    };
}

// 5 attempts per 15 minutes on admin login
export const adminLoginLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    maxRequests: 5,
    message: 'Too many login attempts. Please wait 15 minutes before trying again.'
});

// 10 financial requests per minute
export const financialLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 10,
    message: 'Too many deposit or withdrawal submissions. Please wait a moment.'
});

// 240 API requests per minute for general endpoints, keyed per-user when identified
export const generalApiLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 240,
    keyGenerator: (req) => {
        const uid = req.params?.userId || req.query?.userId || req.body?.userId;
        if (uid && typeof uid === 'string' && /^\d+$/.test(uid)) {
            return `user_${uid}`;
        }
        return getClientIp(req);
    },
    message: 'Rate limit exceeded. Please slow down.'
});
