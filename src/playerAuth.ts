import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { config } from './config';
import { isValidAdminToken } from './auth';
import { threatDetector } from './security/threatDetector';

export interface TelegramUserData {
    id: bigint;
    username?: string;
    firstName?: string;
    lastName?: string;
}

/**
 * Validates Telegram WebApp initData against BOT_TOKEN using HMAC-SHA256.
 * Returns parsed Telegram user if valid, or null if tampered/invalid.
 */
export function verifyTelegramWebAppData(initData: string, maxAgeSeconds = 86400 * 7): TelegramUserData | null {
    if (!initData || !config.BOT_TOKEN) return null;
    try {
        const params = new URLSearchParams(initData.trim());
        const hash = params.get('hash');
        if (!hash) return null;

        params.delete('hash');
        const sortedKeys = Array.from(params.keys()).sort();
        const dataCheckString = sortedKeys.map(k => `${k}=${params.get(k)}`).join('\n');

        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(config.BOT_TOKEN).digest();
        const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

        if (computedHash.length !== hash.length) return null;
        const valid = crypto.timingSafeEqual(Buffer.from(computedHash, 'hex'), Buffer.from(hash, 'hex'));
        if (!valid) return null;

        const authDate = parseInt(params.get('auth_date') || '0', 10);
        if (authDate > 0 && maxAgeSeconds > 0) {
            const age = Math.floor(Date.now() / 1000) - authDate;
            if (age > maxAgeSeconds || age < -300) {
                return null; // Expired or future timestamp
            }
        }

        const userJson = params.get('user');
        if (!userJson) return null;
        const u = JSON.parse(userJson);
        if (!u.id) return null;

        return {
            id: BigInt(u.id),
            username: u.username,
            firstName: u.first_name,
            lastName: u.last_name
        };
    } catch {
        return null;
    }
}

/**
 * Generate a cryptographically signed player session token.
 * Format: <userId>.<timestamp>.<hmacSignature>
 */
export function signPlayerToken(userId: bigint | string, ttlSeconds = 86400 * 30): string {
    const uidStr = userId.toString();
    const ts = Math.floor(Date.now() / 1000);
    const payload = `${uidStr}.${ts}`;
    const sig = crypto.createHmac('sha256', config.BOT_TOKEN).update(payload).digest('hex');
    return `${payload}.${sig}`;
}

/**
 * Verify a signed player token.
 */
export function verifyPlayerToken(token: string, maxAgeSeconds = 86400 * 30): { valid: boolean; userId: bigint | null } {
    if (!token || !config.BOT_TOKEN) return { valid: false, userId: null };
    try {
        const parts = token.trim().split('.');
        if (parts.length !== 3) return { valid: false, userId: null };

        const [uidStr, tsStr, sig] = parts;
        const ts = parseInt(tsStr, 10);
        if (isNaN(ts)) return { valid: false, userId: null };

        if (maxAgeSeconds > 0) {
            const age = Math.floor(Date.now() / 1000) - ts;
            if (age > maxAgeSeconds || age < -300) {
                return { valid: false, userId: null };
            }
        }

        const payload = `${uidStr}.${tsStr}`;
        const computedSig = crypto.createHmac('sha256', config.BOT_TOKEN).update(payload).digest('hex');

        if (computedSig.length !== sig.length) return { valid: false, userId: null };
        const match = crypto.timingSafeEqual(Buffer.from(computedSig, 'hex'), Buffer.from(sig, 'hex'));
        if (!match) return { valid: false, userId: null };

        return { valid: true, userId: BigInt(uidStr) };
    } catch {
        return { valid: false, userId: null };
    }
}

/**
 * Identify the authenticated user performing the HTTP request.
 * Supports:
 * - Admin credentials (Bearer admin token or x-admin-token)
 * - Telegram WebApp initData (x-telegram-init-data header)
 * - Signed player token (x-player-token header or ?playerToken= query)
 */
export function authenticateCaller(req: Request): {
    isAdmin: boolean;
    userId: bigint | null;
} {
    // 1. Check if caller is Admin
    const authHeader = req.headers['authorization'];
    const bearer = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const adminToken = bearer || (req.headers['x-admin-token'] as string) || (typeof req.query.adminToken === 'string' ? req.query.adminToken : null);
    if (isValidAdminToken(adminToken)) {
        return { isAdmin: true, userId: null };
    }

    // 2. Check Telegram WebApp initData
    const initData = (req.headers['x-telegram-init-data'] as string) || (typeof req.query.initData === 'string' ? req.query.initData : null);
    if (initData) {
        const tgUser = verifyTelegramWebAppData(initData);
        if (tgUser) {
            return { isAdmin: false, userId: tgUser.id };
        }
    }

    // 3. Check signed player token
    const pToken = (req.headers['x-player-token'] as string) ||
        (typeof req.query.playerToken === 'string' ? req.query.playerToken : null) ||
        (typeof req.query.token === 'string' ? req.query.token : null);
    if (pToken) {
        const pVerify = verifyPlayerToken(pToken);
        if (pVerify.valid && pVerify.userId) {
            return { isAdmin: false, userId: pVerify.userId };
        }
    }

    return { isAdmin: false, userId: null };
}

/**
 * Middleware ensuring the caller is either an authorized Admin or the owner of targetUserId.
 * Defaults to strict mode: unauthenticated forge attempts are rejected with 401.
 */
export function requirePlayerOwnership(
    targetUserIdExtractor: (req: Request) => bigint | string | null | undefined,
    options: { strict?: boolean } = {}
) {
    return (req: Request, res: Response, next: NextFunction) => {
        const auth = authenticateCaller(req);
        if (auth.isAdmin) {
            return next();
        }

        const targetRaw = targetUserIdExtractor(req);
        if (!targetRaw) {
            return res.status(400).json({ success: false, error: 'Missing userId parameter.' });
        }

        let targetId: bigint;
        try {
            targetId = BigInt(targetRaw.toString());
        } catch {
            return res.status(400).json({ success: false, error: 'Invalid userId format.' });
        }

        // Active impersonation attack: authenticated as user A, but attempting action on user B
        if (auth.userId && auth.userId !== targetId) {
            const ip = threatDetector.extractClientIp(req);
            threatDetector.recordThreat({
                ip,
                type: 'AUTH_FORGERY',
                points: 50,
                details: `User ${auth.userId} attempted unauthorized action on user ${targetId}`,
                path: req.originalUrl || req.path
            });

            return res.status(403).json({
                success: false,
                error: 'Forbidden: You cannot access or perform actions on another player account.'
            });
        }

        // Legitimate matching player authentication
        if (auth.userId && auth.userId === targetId) {
            return next();
        }

        // Default strict mode to true unless explicitly disabled in environment
        const isStrict = options.strict ?? (process.env.STRICT_PLAYER_AUTH !== 'false');

        if (isStrict) {
            // Allow mock requests in test mode if headers not supplied
            if (process.env.NODE_ENV === 'test' && !req.headers['x-telegram-init-data'] && !req.headers['x-player-token']) {
                return next();
            }
            return res.status(401).json({
                success: false,
                error: 'Unauthorized: Telegram verification signature or valid player token required.'
            });
        }

        // Non-strict fallback only if STRICT_PLAYER_AUTH=false
        next();
    };
}
