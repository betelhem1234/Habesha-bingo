import type { Request, Response, NextFunction } from 'express';
import { Bot, InlineKeyboard } from 'grammy';
import { config, formatEthioTime } from '../config';
import { normalizeIp, isValidIp } from './ipUtils';
import { revokeSessionsForIp } from '../auth';

export { normalizeIp, isValidIp };

export type ThreatType =
    | 'HONEYPOT_HIT'
    | 'ADMIN_BRUTE_FORCE'
    | 'RATE_LIMIT_SPIKE'
    | 'SUSPICIOUS_USER_AGENT'
    | 'AUTH_FORGERY'
    | 'MANUAL_BAN';

export interface ThreatRecord {
    ip: string;
    type: ThreatType;
    details: string;
    path?: string;
    timestamp: number;
}

export interface JailedIpInfo {
    ip: string;
    reason: string;
    bannedAt: number;
    expiresAt: number;
    threatScore: number;
    details?: string;
}

export class ThreatDetector {
    private static instance: ThreatDetector;
    private bot: Bot | null = null;

    // In-memory jailed IPs: IP -> Info
    private jailedIps = new Map<string, JailedIpInfo>();

    // IP Threat Tracking: IP -> { score, lastSeen, attempts }
    private ipThreats = new Map<string, { score: number; lastSeen: number; attempts: number }>();

    // Audit log of recent threat events (last 100)
    private recentEvents: ThreatRecord[] = [];

    // Alert debounce: ip_type -> timestamp
    private alertDebounce = new Map<string, number>();

    // Default 2 hours jail duration (7,200,000 ms)
    private readonly defaultJailDurationMs = 2 * 60 * 60 * 1000;
    private readonly threatThreshold = 100;

    private constructor() {
        // Prune expired bans every 5 minutes
        const interval = setInterval(() => {
            const now = Date.now();
            for (const [ip, info] of this.jailedIps.entries()) {
                if (now > info.expiresAt) {
                    this.jailedIps.delete(ip);
                }
            }
            // Also decay old threat scores older than 2 hours
            for (const [ip, threat] of this.ipThreats.entries()) {
                if (now - threat.lastSeen > 2 * 60 * 60 * 1000) {
                    this.ipThreats.delete(ip);
                }
            }
        }, 5 * 60 * 1000);
        interval.unref();
    }

    public static getInstance(): ThreatDetector {
        if (!ThreatDetector.instance) {
            ThreatDetector.instance = new ThreatDetector();
        }
        return ThreatDetector.instance;
    }

    public setBot(bot: Bot) {
        this.bot = bot;
    }

    /**
     * Accurately extracts the real client IP, prioritizing Cloudflare & proxy headers,
     * and normalizes out brackets, ports, and ::ffff: prefixes.
     */
    public extractClientIp(req: Request): string {
        let ip = '';
        const cfIp = req.headers['cf-connecting-ip'];
        if (typeof cfIp === 'string' && cfIp.trim()) {
            ip = cfIp.trim();
        } else {
            const forwarded = req.headers['x-forwarded-for'];
            if (typeof forwarded === 'string' && forwarded.trim()) {
                ip = forwarded.split(',')[0].trim();
            } else {
                const realIp = req.headers['x-real-ip'];
                if (typeof realIp === 'string' && realIp.trim()) {
                    ip = realIp.trim();
                } else {
                    ip = req.ip || req.socket?.remoteAddress || '127.0.0.1';
                }
            }
        }
        return normalizeIp(ip) || '127.0.0.1';
    }

    /**
     * Check if an IP is actively banned. Automatically unbans if expired.
     */
    public isIpJailed(ip: string): boolean {
        if (!ip) return false;
        const normalized = normalizeIp(ip);
        if (!normalized) return false;
        const info = this.jailedIps.get(normalized);
        if (!info) return false;

        if (Date.now() > info.expiresAt) {
            this.jailedIps.delete(normalized);
            return false;
        }

        return true;
    }

    /**
     * Manually or automatically jail an IP address.
     * Automatically purges active admin sessions and pending logins for that IP.
     */
    public jailIp(ip: string, reason: string, durationMs = this.defaultJailDurationMs, details?: string) {
        const normalized = normalizeIp(ip);
        if (!normalized) return;

        // Immediately revoke any active admin sessions or pending logins for this IP!
        revokeSessionsForIp(normalized);

        const now = Date.now();
        const info: JailedIpInfo = {
            ip: normalized,
            reason,
            bannedAt: now,
            expiresAt: now + durationMs,
            threatScore: (this.ipThreats.get(normalized)?.score || 0) + 100,
            details
        };

        this.jailedIps.set(normalized, info);
        console.warn(`[Security] 🚨 JAILED IP: ${normalized} | Reason: ${reason} | Duration: ${Math.round(durationMs / 60000)}m`);

        // Send instant emergency alert
        this.notifyAdminOfBan(info);
    }

    /**
     * Unban an IP address.
     */
    public unbanIp(ip: string): boolean {
        const normalized = normalizeIp(ip);
        if (!normalized) return false;
        const removed = this.jailedIps.delete(normalized);
        this.ipThreats.delete(normalized);
        if (removed) {
            console.log(`[Security] ✅ UNBANNED IP: ${normalized}`);
        }
        return removed;
    }

    /**
     * Record a security event, update IP threat score, and auto-jail if threshold is crossed.
     */
    public recordThreat(event: {
        ip: string;
        type: ThreatType;
        points: number;
        details: string;
        path?: string;
    }) {
        const normalized = normalizeIp(event.ip);
        if (!normalized) return;
        const now = Date.now();

        // 1. Audit log
        this.recentEvents.unshift({
            ip: normalized,
            type: event.type,
            details: event.details,
            path: event.path,
            timestamp: now
        });
        if (this.recentEvents.length > 100) {
            this.recentEvents.pop();
        }

        // 2. Accumulate Threat Score
        const existing = this.ipThreats.get(normalized) || { score: 0, lastSeen: now, attempts: 0 };
        existing.score += event.points;
        existing.lastSeen = now;
        existing.attempts += 1;
        this.ipThreats.set(normalized, existing);

        console.warn(`[Security] ⚠️ Threat detected: ${event.type} from ${normalized} | +${event.points} pts (Total: ${existing.score}) | ${event.details}`);

        // 3. Auto-Jail Check
        if (existing.score >= this.threatThreshold && !this.isIpJailed(normalized)) {
            const jailMinutes = event.type === 'HONEYPOT_HIT' ? 240 : 120; // 4 hours for honeypot, 2 hours for brute force
            this.jailIp(normalized, `Exceeded threat score threshold (${existing.score} pts) via ${event.type}`, jailMinutes * 60 * 1000, event.details);
        } else if (!this.isIpJailed(normalized)) {
            // Send warning alert for high severity attempts
            this.sendWarningAlert(normalized, event);
        }
    }

    private escapeHtml(str: string): string {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    /**
     * Debounced warning alert before full ban
     */
    private async sendWarningAlert(ip: string, event: { type: ThreatType; details: string; path?: string }) {
        if (!this.bot || !config.ADMIN_USER_ID) return;
        const key = `${ip}_${event.type}`;
        const now = Date.now();
        const lastSent = this.alertDebounce.get(key) || 0;

        // Debounce: at most once every 5 minutes per IP/threat type
        if (now - lastSent < 5 * 60 * 1000) return;
        this.alertDebounce.set(key, now);

        const text =
            `⚠️ <b>Security Warning: Suspicious Activity</b>\n\n` +
            `📍 <b>IP:</b> <code>${this.escapeHtml(ip)}</code>\n` +
            `🎯 <b>Type:</b> <code>${this.escapeHtml(event.type)}</code>\n` +
            (event.path ? `🔗 <b>Path:</b> <code>${this.escapeHtml(event.path)}</code>\n` : '') +
            `📝 <b>Details:</b> ${this.escapeHtml(event.details)}\n` +
            `⏱ <b>Time:</b> ${new Date(now).toISOString()}\n\n` +
            `<i>System is monitoring this IP.</i>`;

        const kb = new InlineKeyboard().text(`🚫 Ban IP Now`, `sec_ban_${ip}`);

        try {
            await this.bot.api.sendMessage(Number(config.ADMIN_USER_ID), text, {
                parse_mode: 'HTML',
                reply_markup: kb
            });
        } catch (e: any) {
            console.error('[Security] Failed to deliver warning alert to Telegram, retrying plain text:', e?.message);
            try {
                await this.bot.api.sendMessage(Number(config.ADMIN_USER_ID), `⚠️ Security Warning: ${event.type} from ${ip}\n${event.details}`, { reply_markup: kb });
            } catch {}
        }
    }

    /**
     * Emergency alert when an IP is Jailed / Banned
     */
    private async notifyAdminOfBan(info: JailedIpInfo) {
        if (!this.bot || !config.ADMIN_USER_ID) return;

        const durationMinutes = Math.round((info.expiresAt - info.bannedAt) / 60000);
        const text =
            `🚨 <b>EMERGENCY: Malicious Bot / Attacker Jailed!</b>\n\n` +
            `🚫 <b>Jailed IP:</b> <code>${this.escapeHtml(info.ip)}</code>\n` +
            `🛑 <b>Reason:</b> ${this.escapeHtml(info.reason)}\n` +
            (info.details ? `📝 <b>Details:</b> ${this.escapeHtml(info.details)}\n` : '') +
            `⏱ <b>Duration:</b> ${durationMinutes} minutes\n` +
            `📊 <b>Threat Score:</b> ${info.threatScore} pts\n` +
            `⏰ <b>Banned At:</b> ${formatEthioTime(info.bannedAt)}\n\n` +
            `<i>All incoming requests from this IP are blocked with HTTP 403.</i>`;

        const kb = new InlineKeyboard()
            .text(`🔓 Unban IP`, `sec_unban_${info.ip}`)
            .text(`📋 Security Dashboard`, `sec_stats`);

        try {
            await this.bot.api.sendMessage(Number(config.ADMIN_USER_ID), text, {
                parse_mode: 'HTML',
                reply_markup: kb
            });
        } catch (e: any) {
            console.error('[Security] Failed to deliver ban alert to Telegram, retrying plain text:', e?.message);
            try {
                await this.bot.api.sendMessage(Number(config.ADMIN_USER_ID), `🚨 JAILED IP: ${info.ip}\nReason: ${info.reason}\nDuration: ${durationMinutes}m`, { reply_markup: kb });
            } catch {}
        }
    }

    /**
     * Returns stats for admin dashboard and /security command
     */
    public getStats() {
        const now = Date.now();
        const activeJails = Array.from(this.jailedIps.values()).filter(j => j.expiresAt > now);
        return {
            totalJailedIps: activeJails.length,
            jailedList: activeJails.map(j => ({
                ip: j.ip,
                reason: j.reason,
                expiresInMinutes: Math.max(0, Math.round((j.expiresAt - now) / 60000)),
                threatScore: j.threatScore
            })),
            recentEvents: this.recentEvents.slice(0, 20)
        };
    }

    /**
     * Express Middleware: Placed at the very top of the app.
     * Immediately drops traffic from jailed IPs with HTTP 403 Forbidden.
     */
    public ipJailMiddleware = (req: Request, res: Response, next: NextFunction) => {
        const ip = this.extractClientIp(req);
        if (this.isIpJailed(ip)) {
            const info = this.jailedIps.get(ip);
            return res.status(403).json({
                success: false,
                error: 'Forbidden: Your IP has been temporarily restricted due to suspicious activity.',
                reason: info?.reason || 'Security policy violation'
            });
        }
        next();
    };
}

export const threatDetector = ThreatDetector.getInstance();
