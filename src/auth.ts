import crypto from 'crypto';
import { config } from './config';

// Active admin session tokens -> expiry timestamp
const adminSessions = new Map<string, number>();

/**
 * Generate a new cryptographically secure admin session token.
 * Default validity: 30 days (720 hours).
 */
export function generateAdminToken(ttlHours = 720): string {
    const token = crypto.randomBytes(32).toString('hex');
    adminSessions.set(token, Date.now() + ttlHours * 3600 * 1000);
    return token;
}

/**
 * Verify if a given token is a valid active admin session.
 */
export function isValidAdminToken(token: string | null | undefined): boolean {
    if (!token) return false;
    const clean = token.trim();
    
    // Check in-memory active sessions
    const exp = adminSessions.get(clean);
    if (exp) {
        if (Date.now() > exp) {
            adminSessions.delete(clean);
            return false;
        }
        return true;
    }

    // Allow master admin password as a valid bearer token
    if (config.ADMIN_PASSWORD && clean === config.ADMIN_PASSWORD) {
        return true;
    }

    return false;
}

/**
 * Revoke an admin session token (logout).
 */
export function revokeAdminToken(token: string): boolean {
    return adminSessions.delete(token.trim());
}
