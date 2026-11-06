import dotenv from 'dotenv';
dotenv.config();

// Default server timezone to East Africa Time (Ethiopia: UTC+3)
process.env.TZ = process.env.TZ || 'Africa/Addis_Ababa';

export function formatEthioTime(date: Date | number | string = new Date()): string {
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleTimeString('en-US', {
        timeZone: 'Africa/Addis_Ababa',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });
}

export function formatEthioDateTime(date: Date | number | string = new Date()): string {
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleString('en-US', {
        timeZone: 'Africa/Addis_Ababa',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });
}

export const config = {
    BOT_TOKEN: process.env.BOT_TOKEN || '',
    DATABASE_URL: process.env.DATABASE_URL || '',
    ADMIN_USER_ID: process.env.ADMIN_USER_ID || '',
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'eBFqKW8mpvp528ApSKQ&zWpfM4t&',
    BINGO_APP_URL: process.env.BINGO_APP_URL || 'https://localhost:3001',
    PORT: process.env.PORT || '3001',
    CHANNEL_URL: process.env.CHANNEL_URL || 'https://t.me/ethioBingoOne',
    SUPPORT_URL: process.env.SUPPORT_URL || '',
    
    // Telebirr Configuration (Placeholders for real keys)
    TELEBIRR_APP_ID: process.env.TELEBIRR_APP_ID || '',
    TELEBIRR_APP_KEY: process.env.TELEBIRR_APP_KEY || '',
    TELEBIRR_PUBLIC_KEY: process.env.TELEBIRR_PUBLIC_KEY || '',
};

if (!config.BOT_TOKEN) {
    console.warn('WARNING: BOT_TOKEN is missing in .env file');
}
