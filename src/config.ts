import dotenv from 'dotenv';
dotenv.config();

export const config = {
    BOT_TOKEN: process.env.BOT_TOKEN || '',
    DATABASE_URL: process.env.DATABASE_URL || '',
    ADMIN_USER_ID: process.env.ADMIN_USER_ID || '',
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'habesha_bingo_admin_2026',
    BINGO_APP_URL: process.env.BINGO_APP_URL || 'https://localhost:3001',
    PORT: process.env.PORT || '3001',
    CHANNEL_URL: process.env.CHANNEL_URL || 'https://t.me/BaronBingochannel',
    SUPPORT_URL: process.env.SUPPORT_URL || 'https://t.me/BaronBingobot',
    
    // Telebirr Configuration (Placeholders for real keys)
    TELEBIRR_APP_ID: process.env.TELEBIRR_APP_ID || '',
    TELEBIRR_APP_KEY: process.env.TELEBIRR_APP_KEY || '',
    TELEBIRR_PUBLIC_KEY: process.env.TELEBIRR_PUBLIC_KEY || '',
};

if (!config.BOT_TOKEN) {
    console.warn('WARNING: BOT_TOKEN is missing in .env file');
}
