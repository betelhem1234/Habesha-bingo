import crypto from 'crypto';
import { config } from './config';
import { normalizeIp } from './security/ipUtils';

export interface AdminSession {
    token: string;
    createdAt: number;
    lastActivityAt: number;
    ip?: string;
    userAgent?: string;
}

export interface PendingAdminLogin {
    id: string;
    ip: string;
    userAgent: string;
    createdAt: number;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    token?: string;
}

// In-memory active admin sessions: Token -> AdminSession
// Because this is in-memory, when the server restarts all sessions are automatically wiped!
const adminSessions = new Map<string, AdminSession>();

// In-memory pending 2FA login requests: Id -> PendingAdminLogin
const pendingLogins = new Map<string, PendingAdminLogin>();

// Configurable inactivity timeout (default 15 minutes)
export const INACTIVITY_TIMEOUT_MINUTES = Number(process.env.ADMIN_INACTIVITY_MINUTES) || 15;
export const INACTIVITY_TIMEOUT_MS = INACTIVITY_TIMEOUT_MINUTES * 60 * 1000;

// Periodic cleanup of idle sessions (every 60 seconds)
const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [token, session] of adminSessions.entries()) {
        if (now - session.lastActivityAt > INACTIVITY_TIMEOUT_MS) {
            adminSessions.delete(token);
        }
    }
    // Prune pending 2FA logins older than 3 minutes
    for (const [id, req] of pendingLogins.entries()) {
        if (now - req.createdAt > 3 * 60 * 1000) {
            pendingLogins.delete(id);
        }
    }
}, 60 * 1000);
cleanupInterval.unref();

/**
 * Generate a new cryptographically secure admin session token with active sliding tracking.
 */
export function generateAdminToken(ipOrTtl?: string | number, userAgent?: string): string {
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    const ip = typeof ipOrTtl === 'string' ? ipOrTtl : undefined;
    const ttlHours = typeof ipOrTtl === 'number' ? ipOrTtl : undefined;

    // If negative ttl is passed (e.g. In unit tests), simulate an expired session
    const activityTimestamp = (ttlHours !== undefined && ttlHours < 0)
        ? now - (INACTIVITY_TIMEOUT_MS + 60 * 1000)
        : now;

    adminSessions.set(token, {
        token,
        createdAt: activityTimestamp,
        lastActivityAt: activityTimestamp,
        ip,
        userAgent
    });

    return token;
}

/**
 * Safely verify provided password against configured admin password using timingSafeEqual
 */
export function verifyMasterPassword(provided: string | null | undefined): boolean {
    if (!provided || !config.ADMIN_PASSWORD) return false;
    const a = Buffer.from(provided.trim());
    const b = Buffer.from(config.ADMIN_PASSWORD.trim());
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

/**
 * Verify if a given token is a valid active admin session.
 * Refreshes the lastActivityAt timestamp on every valid access (Sliding Session Window).
 * Automatically revokes and returns false if inactive beyond INACTIVITY_TIMEOUT_MS.
 */
export function isValidAdminToken(token: string | null | undefined): boolean {
    if (!token) return false;
    const clean = token.trim();

    // 1. Check in-memory active sessions
    const session = adminSessions.get(clean);
    if (session) {
        const now = Date.now();
        // Check for inactivity
        if (now - session.lastActivityAt > INACTIVITY_TIMEOUT_MS) {
            adminSessions.delete(clean);
            return false;
        }

        // Refresh activity timestamp (Sliding Expiration: never logs out while actively working)
        session.lastActivityAt = now;
        return true;
    }

    // 2. Allow master admin password as bearer token for offline scripts/tests
    if (config.ADMIN_PASSWORD && verifyMasterPassword(clean)) {
        return true;
    }

    return false;
}

/**
 * Revoke an admin session token (Explicit Logout).
 */
export function revokeAdminToken(token: string): boolean {
    return adminSessions.delete(token.trim());
}

/**
 * Revoke all active admin sessions and pending logins tied to a given IP address.
 * Used immediately when an IP address is banned.
 */
export function revokeSessionsForIp(rawIp: string): number {
    const clean = normalizeIp(rawIp);
    if (!clean) return 0;

    let revokedCount = 0;

    // Purge active admin sessions
    for (const [token, session] of adminSessions.entries()) {
        if (session.ip && normalizeIp(session.ip) === clean) {
            adminSessions.delete(token);
            revokedCount++;
        }
    }

    // Purge pending 2FA login requests
    for (const [id, pending] of pendingLogins.entries()) {
        if (pending.ip && normalizeIp(pending.ip) === clean) {
            pendingLogins.delete(id);
            revokedCount++;
        }
    }

    if (revokedCount > 0) {
        console.warn(`[Security] 🔒 Revoked ${revokedCount} active session(s)/pending login(s) for banned IP: ${clean}`);
    }

    return revokedCount;
}

/**
 * Get the current session information (for audit and telemetry)
 */
export function getAdminSession(token: string | null | undefined): AdminSession | null {
    if (!token) return null;
    return adminSessions.get(token.trim()) || null;
}

/**
 * Returns count of currently active admin sessions
 */
export function getActiveAdminSessionCount(): number {
    return adminSessions.size;
}

// ----------------------------------------------------
// 2FA Admin Login Helpers
// ----------------------------------------------------

export function createPendingLogin(ip: string, userAgent: string): PendingAdminLogin {
    const id = crypto.randomBytes(16).toString('hex');
    const pending: PendingAdminLogin = {
        id,
        ip,
        userAgent,
        createdAt: Date.now(),
        status: 'PENDING'
    };
    pendingLogins.set(id, pending);
    return pending;
}

export function approvePendingLogin(id: string): string | null {
    const pending = pendingLogins.get(id);
    if (!pending || pending.status !== 'PENDING') return null;

    const token = generateAdminToken(pending.ip, pending.userAgent);
    pending.status = 'APPROVED';
    pending.token = token;
    return token;
}

export function rejectPendingLogin(id: string): boolean {
    const pending = pendingLogins.get(id);
    if (!pending || pending.status !== 'PENDING') return false;

    pending.status = 'REJECTED';
    return true;
}

export function getPendingLogin(id: string): PendingAdminLogin | null {
    return pendingLogins.get(id) || null;
}
