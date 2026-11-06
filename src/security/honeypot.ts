import type { Request, Response, NextFunction } from 'express';
import { threatDetector } from './threatDetector';

const HONEYPOT_PATHS = [
    // Sensitive environment & credentials
    '/.env',
    '/.env.local',
    '/.env.production',
    '/.env.backup',
    '/.env.save',
    '/.git',
    '/.git/config',
    '/.git/head',
    '/.aws',
    '/.ssh',
    '/credentials.json',
    '/config.json',
    '/database.sql',
    '/dump.sql',
    '/backup.sql',

    // WordPress & CMS scanners
    '/wp-admin',
    '/wp-login.php',
    '/xmlrpc.php',
    '/wp-content',
    '/wp-includes',

    // Database & Admin interfaces
    '/phpmyadmin',
    '/pma',
    '/mysql',
    '/adminer.php',
    '/dbadmin',

    // Web shells & code execution probes
    '/shell.php',
    '/c99.php',
    '/wso.php',
    '/eval.php',
    '/setup.php',
    '/install.php',
    '/actuator',
    '/actuator/health'
];

/**
 * Honeypot Middleware: Traps automated malicious bots and vulnerability scanners.
 * Any request to these paths is guaranteed to be a scanner bot.
 */
export function honeypotMiddleware(req: Request, res: Response, next: NextFunction) {
    const rawPath = req.path.toLowerCase();

    const isHoneypot = HONEYPOT_PATHS.some(hp => {
        return rawPath === hp || rawPath.startsWith(`${hp}/`) || rawPath.endsWith(hp);
    });

    if (isHoneypot) {
        const ip = threatDetector.extractClientIp(req);
        const userAgent = req.headers['user-agent'] || 'Unknown';

        threatDetector.recordThreat({
            ip,
            type: 'HONEYPOT_HIT',
            points: 100, // Instant Jail
            details: `Probed malicious honeypot path: ${req.path} (UA: ${userAgent.slice(0, 80)})`,
            path: req.path
        });

        return res.status(403).json({
            success: false,
            error: 'Forbidden'
        });
    }

    next();
}
