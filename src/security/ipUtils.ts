/**
 * IP Normalization and Validation Utilities
 * Ensures IP addresses with brackets, quotes, IPv4-mapped IPv6 prefixes,
 * and port numbers are cleanly normalized for consistent security checks.
 */

/**
 * Normalizes an IP string by:
 * 1. Stripping leading/trailing whitespace
 * 2. Stripping enclosing brackets (<...>, [...], (...)) and quotes ("...", '...')
 * 3. Stripping ::ffff: IPv4-mapped IPv6 prefix
 * 4. Stripping port suffixes (e.g. 196.190.156.57:8080 -> 196.190.156.57)
 */
export function normalizeIp(raw: string | null | undefined): string {
    if (!raw) return '';
    let ip = String(raw).trim();

    // Strip surrounding brackets < > [ ] ( ) and quotes " '
    ip = ip.replace(/^[\s<\[\("']+|[\s>\]\)"']+$/g, '').trim();

    // Strip ::ffff: IPv4-mapped IPv6 prefix
    if (ip.startsWith('::ffff:')) {
        ip = ip.slice(7).trim();
    }

    // Strip port suffix for IPv4 (e.g. 192.168.1.1:3000 -> 192.168.1.1)
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/.test(ip)) {
        ip = ip.split(':')[0].trim();
    }

    return ip;
}

/**
 * Validates whether a string is a syntactically valid IPv4 or IPv6 address.
 */
export function isValidIp(raw: string | null | undefined): boolean {
    const ip = normalizeIp(raw);
    if (!ip) return false;

    // Strict IPv4 validation (each octet 0-255)
    const ipv4Regex = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
    if (ipv4Regex.test(ip)) {
        return true;
    }

    // Standard IPv6 validation
    const ipv6Regex = /^(?:[a-fA-F0-9]{1,4}:){7}[a-fA-F0-9]{1,4}$|^::1$|^[a-fA-F0-9:]+$/;
    if (ipv6Regex.test(ip) && ip.includes(':')) {
        return true;
    }

    return false;
}
