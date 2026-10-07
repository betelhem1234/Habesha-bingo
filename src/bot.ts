
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { Bot, Context, InlineKeyboard, Keyboard, InputFile } from 'grammy';
import { config } from './config';
import { prisma } from './db';
import { proofPath, proofUrl } from './uploads';
import { NEW_USER_BONUS } from './bonus';
import { GameRooms } from './game/GameRooms';
import { generateAdminToken } from './auth';

// Simple in-memory language preference
const userLangs = new Map<string, string>();

const TEXTS = {
    welcome: {
        en: 'Welcome to **Habesha Bingo**! 🔥 FIRST JOIN 30 Birr BONUS 🔥',
        am: 'እንኳን ወደ **Habesha Bingo** በደህና መጡ! 🔥 FIRST JOIN 30 Birr BONUS 🔥',
        om: 'Baga nagaan gara **Habesha Bingo** dhuftan! 🔥 FIRST JOIN 30 Birr BONUS 🔥'
    },
    playBtn: {
        en: '🎮 PLAY NOW',
        am: '🎮 ጨዋታውን ይጀምሩ (PLAY)',
        om: '🎮 TAPHA JALQABI'
    },
    regBtn: {
        en: '📱 Register Phone',
        am: '📱 ለመመዝገብ ስልክዎን ያስገቡ',
        om: '📱 Galmaa\'uuf bilbila galchaa'
    },
    instructionsBtn: {
        en: '📖 Instructions',
        am: '📖 አጨዋወት (ህጎች)',
        om: '📖 Qajeelfama'
    },
    feedbackBtn: {
        en: '✍️ Feedback',
        am: '✍️ አስተያየት መስጫ',
        om: '✍️ Yaada'
    }
};

function escapeHtmlBot(str: string): string {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

const INSTRUCTIONS_TEXT = `🎮 *Habesha Bingo — የቢንጎ ጨዋታ ህጎች*

🃏 *መጫወቻ ካርድ*
ጨዋታውን ለመጀመር ከሚመጣልን ከ1-500 የመጫወቻ ካርድ ውስጥ አንዱን እንመርጣለን
የመጫወቻ ካርዱ ላይ በቀይ ቀለም የተመረጡ ቁጥሮች የሚያሳዩት መጫወቻ ካርድ በሌላ ተጫዋች መመረጡን ነው
የመጫወቻ ካርድ ስንነካው ከታች በኩል ካርድ ቁጥሩ የሚይዘዉን መጫወቻ ካርድ ያሳየናል
ወደ ጨዋታው ለመግባት የምንፈልገዉን ካርድ ከመረጥን ለምዝገባ የተሰጠው ሰኮንድ ዜሮ ሲሆን ቀጥታ ወደ ጨዋታ ያስገባናል

🎲 *ጨዋታ*
ወደ ጨዋታው ስንገባ በመረጥነው የካርድ ቁጥር መሰረት የመጫወቻ ካርድ እናገኛለን
ከላይ በቀኝ በኩል ጨዋታው ለመጀመር ያለዉን ቀሪ ሴኮንድ መቁጠር ይጀምራል
ጨዋታው ሲጀምር የተለያዪ ቁጥሮች ከ1 እስከ 75 መጥራት ይጀምራል
የሚጠራው ቁጥር የኛ መጫወቻ ካርድ ዉስጥ ካለ የተጠራዉን ቁጥር ክሊክ በማረግ መምረጥ እንችላለን
የመረጥነዉን ቁጥር ማጥፋት ከፈለግን መልሰን እራሱን ቁጠር ክሊክ በማረግ ማጥፋት እንችላለን

🏆 *አሸናፊ*
ቁጥሮቹ ሲጠሩ ከመጫወቻ ካርዳችን ላይ እየመረጥን ወደጎን ወይም ወደታች ወይም ወደሁለቱም አግዳሚ ወይም አራቱን ማእዘናት ከመረጥን ወዲአዉኑ ከታች በኩል bingo የሚለዉን በመንካት ማሸነፍ እንችላለን
ወደጎን ወይም ወደታች ወዪም ወደሁለቱም አግዳሚ ወይም አራቱን ማእዘናት ሳይጠሩ bingo የሚለዉን ክሊክ ካደረግን ከጨዋታው እንታገዳለን
ሁለት ወይም ከዚያ በላይ ተጫዋቾች እኩል ቢያሸንፉ ደራሹ ለ ቀጥራቸው ይካፈላል።`;

import { TelebirrService } from './payments/Telebirr';
import { startAdminServer } from './adminServer';


const bot = new Bot(config.BOT_TOKEN);
const gameRooms = new GameRooms(bot);

const BINGO_APP_URL = config.BINGO_APP_URL;
const BINGO_APP_VERSION = 'v2';

// --- State Management ---
// Simple in-memory state for conversations (Deposit/Withdraw)
// In production, use Redis for this!
type UserState = {
    step: 'NONE' | 'WAITING_DEPOSIT_AMOUNT' | 'WAITING_WITHDRAW_AMOUNT' | 'WAITING_WITHDRAW_PHONE' | 'WAITING_BROADCAST' | 'WAITING_BROADCAST_CAPTION' | 'CONFIRM_BROADCAST'
        | 'WAITING_BANK_NAME' | 'WAITING_BANK_ACCOUNT' | 'WAITING_BANK_HOLDER' | 'WAITING_FEEDBACK';
    tempAmount?: number;
    tempBank?: { bankName: string; accountNumber: string };
    broadcastDraft?: {
        photoFileId?: string;
        caption?: string;
        text?: string;
    };
};
const userStates: Map<bigint, UserState> = new Map();

function getState(userId: bigint): UserState {
    if (!userStates.has(userId)) {
        userStates.set(userId, { step: 'NONE' });
    }
    return userStates.get(userId)!;
}

function clearState(userId: bigint) {
    userStates.set(userId, { step: 'NONE' });
}

export function getBroadcastKeyboard(userId: bigint | string) {
    const kb = new InlineKeyboard()
        .webApp('🎮 ይጫወቱ', `${config.BINGO_APP_URL}/index.html?userId=${userId.toString()}`).row()
        .text('💰 ገንዘብ አስገባ', 'menu_deposit').row();

    if (config.CHANNEL_URL) {
        kb.url('📣 Channel', config.CHANNEL_URL);
    }
    kb.text('✍️ Feedback', 'menu_feedback');
    return kb;
}

function getBannerPhoto(): InputFile | string {
    const localBanner = path.join(__dirname, 'public/images/habesha_bingo_banner.jpg');
    if (existsSync(localBanner)) {
        return new InputFile(localBanner);
    }
    return `${config.BINGO_APP_URL}/images/habesha_bingo_banner.jpg`;
}

// --- Commands ---

async function sendMainMenu(ctx: Context, user: { id: bigint; phone?: string | null }) {
    const userId = user.id;
    const playUrl = `${config.BINGO_APP_URL}/index.html?userId=${userId}&v=${Date.now()}`;
    console.log(`[BOT] Sending PLAY NOW URL: ${playUrl}`);

    const kb = new InlineKeyboard()
        .webApp(TEXTS.playBtn.en, playUrl).row()
        .text('💰 Deposit', 'menu_deposit')
        .text('💸 Withdraw', 'menu_withdraw').row()
        .text('💼 Balance', 'menu_balance')
        .text('📖 Instructions', 'menu_instructions').row()
        .text('✍️ Feedback', 'menu_feedback');

    if (userId.toString() === config.ADMIN_USER_ID) {
        const v = gameRooms.getCallerVoice();
        const vLabel = v === 'female' ? '👩 Voice: Female' : '👨 Voice: Male';
        kb.row()
            .text('📋 Requests', 'menu_admin_requests')
            .text('📊 Status', 'menu_admin_status').row()
            .text('🏦 Banks', 'menu_admin_banks')
            .text('📣 Broadcast', 'menu_admin_broadcast').row()
            .text('▶️ Start', 'menu_admin_start')
            .text('⏹ Stop', 'menu_admin_stop').row()
            .text(`🎙️ ${vLabel}`, 'menu_admin_voice');
    }

    try {
        await ctx.replyWithPhoto(getBannerPhoto(), {
            caption: TEXTS.welcome.en,
            parse_mode: 'Markdown',
            reply_markup: kb
        });
    } catch (e) {
        await ctx.reply(TEXTS.welcome.en, {
            parse_mode: 'Markdown',
            reply_markup: kb
        });
    }
}

bot.command('resetme', async (ctx: Context) => {
    if (!ctx.from) return;
    const userId = BigInt(ctx.from.id);
    await prisma.user.update({
        where: { id: userId },
        data: { phone: null }
    });
    await ctx.reply(
        '🔄 *Registration Reset!*\n\n' +
        'Send /start now to test the new first-time registration experience.',
        {
            parse_mode: 'Markdown',
            reply_markup: { remove_keyboard: true }
        }
    );
});

bot.command('start', async (ctx: Context) => {
    if (!ctx.from) return;

    const startParam = String(ctx.match ?? '');
    const refId = /^\d+$/.test(startParam) ? BigInt(startParam) : null;

    // Check if user exists
    let user = await prisma.user.findUnique({ where: { id: BigInt(ctx.from.id) } });
    if (!user) {
        user = await prisma.user.create({
            data: {
                id: BigInt(ctx.from.id),
                username: ctx.from.username ?? null,
                firstName: ctx.from.first_name,
                lastName: ctx.from.last_name ?? null,
                balance: 0, // Balance starts at 0 — credited after the user deposits
                bonus: NEW_USER_BONUS,    // Starting bonus: used for the first paid game
                referredById: refId ?? undefined
            }
        });

        // Reward the referrer with 5 Birr when their invite joins
        if (refId && refId !== user.id) {
            try {
                const referrer = await prisma.user.findUnique({ where: { id: refId } });
                if (referrer) {
                    const REFERRAL_BONUS = 5; // Birr paid to the referrer when their invite joins
                    await prisma.user.update({
                        where: { id: refId },
                        data: { balance: { increment: REFERRAL_BONUS } }
                    });
                    try {
                        await bot.api.sendMessage(Number(refId),
                            `🎉 *Referral Bonus Earned!*\n\n${ctx.from.first_name || 'Your friend'} joined through your invite link. You earned *${REFERRAL_BONUS} Birr*!`,
                            { parse_mode: "Markdown" });
                    } catch (e) {}
                }
            } catch (e) {
                console.error('Referral reward error:', e);
            }
        }
    }

    // 1. If user is NOT registered (no phone number), show ONLY registration prompt
    if (!user.phone) {
        const regKb = new Keyboard()
            .requestContact('📱 Register / Share Phone Number')
            .resized()
            .oneTime();

        await ctx.reply(
            `👋 *Welcome to Habesha Bingo!*\n\n` +
            `To get started and secure your account, please register by sharing your phone number below 👇`,
            {
                parse_mode: 'Markdown',
                reply_markup: regKb
            }
        );
        return;
    }

    // 2. If user is registered, show Main Menu directly with PLAY NOW button
    await sendMainMenu(ctx, user);
});

// --- Language Selection Handler ---
bot.callbackQuery(/^lang_(en|am|om)$/, async (ctx) => {
    const lang = ctx.match[1];
    userLangs.set(ctx.from.id.toString(), lang);
    await ctx.deleteMessage().catch(() => {});
    
    // Trigger start logic again manually since they picked language
    // But we need to use a clean context or just resend the start menu
    const t = lang;
    const kb = new InlineKeyboard()
        .webApp(TEXTS.playBtn[t], `${config.BINGO_APP_URL}/index.html?userId=${ctx.from.id}`).row()
        .text('💰 Deposit', 'menu_deposit')
        .text('💸 Withdraw', 'menu_withdraw').row()
        .text('💼 Balance', 'menu_balance')
        .text(TEXTS.instructionsBtn[t] || '📖 Instructions', 'menu_instructions').row()
        .text(TEXTS.feedbackBtn[t] || '✍️ Feedback', 'menu_feedback');

    try {
        const user = await prisma.user.findUnique({ where: { id: BigInt(ctx.from.id) } });
        if (!user || !user.phone) {
            kb.row().text(TEXTS.regBtn[t], 'menu_register');
        }
    } catch(e) {}

    if (ctx.from.id.toString() === config.ADMIN_USER_ID) {
        const v = gameRooms.getCallerVoice();
        const vLabel = v === 'female' ? '👩 Voice: Female' : '👨 Voice: Male';
        kb.row()
            .text('📋 Requests', 'menu_admin_requests')
            .text('📊 Status', 'menu_admin_status').row()
            .text('🏦 Banks', 'menu_admin_banks')
            .text('📣 Broadcast', 'menu_admin_broadcast').row()
            .text(`🎙️ ${vLabel}`, 'menu_admin_voice');
    }

    await ctx.replyWithPhoto(getBannerPhoto(), {
        caption: TEXTS.welcome[t],
        parse_mode: 'Markdown',
        reply_markup: kb
    });
});

// --- Admin menu handlers ---


bot.callbackQuery('menu_admin_requests', async (ctx) => {
    if (!ctx.from || ctx.from.id.toString() !== config.ADMIN_USER_ID) {
        return ctx.answerCallbackQuery({ text: '⛔ Admin only.', show_alert: true });
    }
    await ctx.answerCallbackQuery();
    await ctx.reply('📋 Loading requests…');
    await sendRequests(ctx, 0);
});

bot.callbackQuery('menu_admin_status', async (ctx) => {
    if (!ctx.from || ctx.from.id.toString() !== config.ADMIN_USER_ID) {
        return ctx.answerCallbackQuery({ text: '⛔ Admin only.', show_alert: true });
    }
    await ctx.answerCallbackQuery();
    try {
        const now = new Date();
        const weekAgo = new Date(now.getTime() - 7 * 86400000);
        const twoWeeksAgo = new Date(now.getTime() - 14 * 86400000);
        const [users, newUsers, prevUsers, depAgg, wdrAgg, pendCount] = await Promise.all([
            prisma.user.count(),
            prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
            prisma.user.count({ where: { createdAt: { gte: twoWeeksAgo, lt: weekAgo } } }),
            prisma.transactionRequest.aggregate({ where: { type: 'deposit', status: 'APPROVED' }, _sum: { amount: true } }),
            prisma.transactionRequest.aggregate({ where: { type: 'withdraw', status: 'APPROVED' }, _sum: { amount: true } }),
            prisma.transactionRequest.count({ where: { status: 'PENDING' } })
        ]);
        const dep = depAgg._sum.amount ? Number(depAgg._sum.amount) : 0;
        const wdr = wdrAgg._sum.amount ? Number(wdrAgg._sum.amount) : 0;
        const growth = prevUsers > 0 ? Math.round(((newUsers - prevUsers) / prevUsers) * 100) : (newUsers > 0 ? 100 : 0);
        const kb = new InlineKeyboard().url('📊 Open Dashboard', `${BINGO_APP_URL}/admin-stats.html`);
        await ctx.reply(
            `📊 *Admin Status*\n\n` +
            `👥 Users: *${users}* (${growth >= 0 ? '+' : ''}${growth}% this week)\n` +
            `💳 Deposits: *${dep} Birr*\n` +
            `⬆️ Withdrawals: *${wdr} Birr*\n` +
            `💰 Net: *${dep - wdr} Birr*\n` +
            `⏳ Pending: *${pendCount}*\n`,
            { parse_mode: 'Markdown', reply_markup: kb }
        );
    } catch (e) {
        console.error('admin status error', e);
        await ctx.reply('⚠️ Failed to load status.');
    }
});

async function showBroadcastPreview(ctx: Context, userId: bigint, draft: { photoFileId?: string; caption?: string; text?: string }) {
    const previewKb = getBroadcastKeyboard(userId);
    const usersCount = await prisma.user.count();

    await ctx.reply('👇 *Broadcast Message Preview:*', { parse_mode: 'Markdown' });

    if (draft.photoFileId) {
        await ctx.replyWithPhoto(draft.photoFileId, {
            caption: draft.caption || '',
            parse_mode: 'Markdown',
            reply_markup: previewKb
        }).catch(async () => {
            await ctx.replyWithPhoto(draft.photoFileId!, {
                caption: draft.caption || '',
                reply_markup: previewKb
            });
        });
    } else if (draft.text) {
        await ctx.reply(draft.text, {
            parse_mode: 'Markdown',
            reply_markup: previewKb
        }).catch(async () => {
            await ctx.reply(draft.text!, {
                reply_markup: previewKb
            });
        });
    }

    const actionKb = new InlineKeyboard()
        .text(`🚀 Send Broadcast (${usersCount} users)`, 'broadcast_confirm').row();

    if (draft.photoFileId) {
        actionKb.text('✏️ Edit Caption / Description', 'broadcast_edit_caption').row();
    }
    actionKb.text('❌ Cancel Broadcast', 'broadcast_cancel');

    await ctx.reply(
        `❓ *Ready to send this broadcast to ${usersCount} users?*`,
        { parse_mode: 'Markdown', reply_markup: actionKb }
    );
}

bot.callbackQuery('menu_admin_broadcast', async (ctx) => {
    if (!ctx.from || ctx.from.id.toString() !== config.ADMIN_USER_ID) {
        return ctx.answerCallbackQuery({ text: '⛔ Admin only.', show_alert: true });
    }
    const userId = BigInt(ctx.from.id);
    const state = getState(userId);
    state.step = 'WAITING_BROADCAST';
    delete state.broadcastDraft;
    await ctx.answerCallbackQuery();
    await ctx.reply(
        `📣 *Broadcast Announcement Mode*\n\n` +
        `Send your announcement message now:\n` +
        `• **Option A**: Send a **Photo** with a caption description written under it\n` +
        `• **Option B**: Send a **Photo** first (I will ask for caption next)\n` +
        `• **Option C**: Send a **Text message** only\n\n` +
        `*The bot will automatically attach game action buttons (🎮 Play, 💰 Deposit, Channel, Feedback) and show a preview before sending!*`,
        { parse_mode: 'Markdown' }
    );
});

bot.callbackQuery('broadcast_skip_caption', async (ctx) => {
    if (!ctx.from || ctx.from.id.toString() !== config.ADMIN_USER_ID) {
        return ctx.answerCallbackQuery({ text: '⛔ Admin only.', show_alert: true });
    }
    const adminId = BigInt(ctx.from.id);
    const state = getState(adminId);
    if (!state.broadcastDraft || !state.broadcastDraft.photoFileId) {
        clearState(adminId);
        return ctx.answerCallbackQuery({ text: 'No broadcast draft found.', show_alert: true });
    }

    state.broadcastDraft.caption = '';
    state.step = 'CONFIRM_BROADCAST';
    await ctx.answerCallbackQuery();
    await showBroadcastPreview(ctx, adminId, state.broadcastDraft);
});

bot.callbackQuery('broadcast_edit_caption', async (ctx) => {
    if (!ctx.from || ctx.from.id.toString() !== config.ADMIN_USER_ID) {
        return ctx.answerCallbackQuery({ text: '⛔ Admin only.', show_alert: true });
    }
    const adminId = BigInt(ctx.from.id);
    const state = getState(adminId);
    if (!state.broadcastDraft || !state.broadcastDraft.photoFileId) {
        clearState(adminId);
        return ctx.answerCallbackQuery({ text: 'No broadcast draft found.', show_alert: true });
    }

    state.step = 'WAITING_BROADCAST_CAPTION';
    await ctx.answerCallbackQuery();
    await ctx.reply('📝 *Send the description text (caption) to display below the image:*', { parse_mode: 'Markdown' });
});

bot.callbackQuery('broadcast_confirm', async (ctx) => {
    if (!ctx.from || ctx.from.id.toString() !== config.ADMIN_USER_ID) {
        return ctx.answerCallbackQuery({ text: '⛔ Admin only.', show_alert: true });
    }
    const adminId = BigInt(ctx.from.id);
    const state = getState(adminId);
    const draft = state.broadcastDraft;

    if (!draft || (!draft.photoFileId && !draft.text)) {
        clearState(adminId);
        return ctx.answerCallbackQuery({ text: 'No broadcast draft found.', show_alert: true });
    }

    await ctx.answerCallbackQuery();
    await ctx.editMessageText('🚀 *Broadcasting message to all players...*', { parse_mode: 'Markdown' }).catch(() => {});

    const users = await prisma.user.findMany({ select: { id: true } });
    let sent = 0;
    let failed = 0;

    for (const u of users) {
        try {
            const userKb = getBroadcastKeyboard(u.id);
            if (draft.photoFileId) {
                await bot.api.sendPhoto(Number(u.id), draft.photoFileId, {
                    caption: draft.caption || '',
                    parse_mode: 'Markdown',
                    reply_markup: userKb
                }).catch(async () => {
                    await bot.api.sendPhoto(Number(u.id), draft.photoFileId!, {
                        caption: draft.caption || '',
                        reply_markup: userKb
                    });
                });
            } else if (draft.text) {
                await bot.api.sendMessage(Number(u.id), draft.text, {
                    parse_mode: 'Markdown',
                    reply_markup: userKb
                }).catch(async () => {
                    await bot.api.sendMessage(Number(u.id), draft.text!, {
                        reply_markup: userKb
                    });
                });
            }
            sent++;
            await new Promise(res => setTimeout(res, 35));
        } catch (e) {
            failed++;
        }
    }

    clearState(adminId);
    await ctx.reply(
        `✅ *Broadcast Completed!*\n\n` +
        `📊 *Summary:*\n` +
        `• Successfully delivered: *${sent}*\n` +
        `• Failed / Blocked: *${failed}*`,
        { parse_mode: 'Markdown' }
    );
});

bot.callbackQuery('broadcast_cancel', async (ctx) => {
    if (!ctx.from || ctx.from.id.toString() !== config.ADMIN_USER_ID) {
        return ctx.answerCallbackQuery({ text: '⛔ Admin only.', show_alert: true });
    }
    clearState(BigInt(ctx.from.id));
    await ctx.answerCallbackQuery({ text: 'Broadcast cancelled.' });
    await ctx.editMessageText('❌ *Broadcast draft cancelled.*', { parse_mode: 'Markdown' }).catch(() => {});
});

bot.callbackQuery('menu_admin_start', async (ctx) => {
    if (!ctx.from || ctx.from.id.toString() !== config.ADMIN_USER_ID) {
        return ctx.answerCallbackQuery({ text: '⛔ Admin only.', show_alert: true });
    }
    await ctx.answerCallbackQuery();
    const rooms = gameRooms.roomsList();
    let started = 0;
    for (const room of rooms) {
        if (room.players.length >= 2 && room.state !== 'PLAYING') {
            await room.startGame();
            started++;
        }
    }
    await ctx.reply(started === 0 ? '⚠️ No room has at least 2 players in the lobby yet.' : `✅ Started ${started} game(s)!`);
});

bot.callbackQuery('menu_admin_stop', async (ctx) => {
    if (!ctx.from || ctx.from.id.toString() !== config.ADMIN_USER_ID) {
        return ctx.answerCallbackQuery({ text: '⛔ Admin only.', show_alert: true });
    }
    await ctx.answerCallbackQuery();
    const rooms = gameRooms.roomsList();
    let stopped = 0;
    for (const room of rooms) {
        if (room.state === 'PLAYING') {
            room.state = 'WAITING';
            room.players = [];
            room.drawnNumbers.clear();
            room.lobbyCountdown = 0;
            stopped++;
        }
    }
    await ctx.reply(stopped === 0 ? '⚠️ No game is currently running.' : `✅ Stopped ${stopped} game(s) and lobby reset.`);
});

bot.callbackQuery('menu_admin_voice', async (ctx) => {
    if (!ctx.from || ctx.from.id.toString() !== config.ADMIN_USER_ID) {
        return ctx.answerCallbackQuery({ text: '⛔ Admin only.', show_alert: true });
    }
    const current = gameRooms.getCallerVoice();
    const newVoice = current === 'male' ? 'female' : 'male';
    gameRooms.setCallerVoice(newVoice);
    const icon = newVoice === 'female' ? '👩' : '👨';
    const label = newVoice === 'female' ? 'Female (የሴት ድምፅ)' : 'Male (የወንድ ድምፅ)';
    await ctx.answerCallbackQuery({
        text: `✅ Voice changed to ${icon} ${label}! All players updated.`,
        show_alert: true
    });
    const kb = new InlineKeyboard()
        .text('👨 Set Male Voice (ወንድ)', 'voice_set_male')
        .text('👩 Set Female Voice (ሴት)', 'voice_set_female');
    await ctx.reply(
        `🎙️ *Caller Voice Changed!*\n\n` +
        `Current active voice for all players: ${icon} *${label}*.\n` +
        `All live and upcoming games will use this voice for all players.`,
        { parse_mode: 'Markdown', reply_markup: kb }
    );
});

bot.callbackQuery(/^voice_set_(male|female)$/, async (ctx) => {
    if (!ctx.from || ctx.from.id.toString() !== config.ADMIN_USER_ID) {
        return ctx.answerCallbackQuery({ text: '⛔ Admin only.', show_alert: true });
    }
    const voice = ctx.match[1] as 'male' | 'female';
    gameRooms.setCallerVoice(voice);
    const icon = voice === 'female' ? '👩' : '👨';
    const label = voice === 'female' ? 'Female (የሴት ድምፅ)' : 'Male (የወንድ ድምፅ)';
    await ctx.answerCallbackQuery({
        text: `✅ Set to ${icon} ${label}!`,
        show_alert: true
    });
    await ctx.reply(
        `🎙️ *Caller Voice Updated!*\n\nAll players will now hear: ${icon} *${label}* announcements.`,
        { parse_mode: 'Markdown' }
    );
});

// --- Admin: payout account (bank) management ---

async function adminBanksList(ctx: any, msgId?: number) {
    const accounts = await prisma.paymentAccount.findMany({
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { requests: true } } }
    });
    let text = `🏦 *Payout Accounts* (${accounts.length})\n\n`;
    if (accounts.length === 0) {
        text += 'No accounts yet. Add one so players know where to send money.\n';
    } else {
        for (const a of accounts) {
            text += `${a.isActive ? '🟢' : '⚪️'} #${a.id} *${a.bankName}* — \`${a.accountNumber}\`\n` +
                (a.accountName ? `   👤 ${a.accountName}\n` : '') +
                `   📥 ${a._count.requests} deposits\n\n`;
        }
    }
    const kb = new InlineKeyboard()
        .text('➕ Add account', 'bank_add');
    for (const a of accounts) {
        kb.row().text(`${a.isActive ? '⛔ Deactivate' : '✅ Activate'} #${a.id} ${a.bankName}`, `bank_toggle_${a.id}`);
    }
    kb.row().text('🔙 Back', 'menu_admin_requests');
    const opts = { parse_mode: 'Markdown', reply_markup: kb };
    if (msgId) await ctx.editMessageText(text, opts).catch(() => {});
    else await ctx.reply(text, opts);
}

bot.callbackQuery('menu_admin_banks', async (ctx) => {
    if (!ctx.from || ctx.from.id.toString() !== config.ADMIN_USER_ID) {
        return ctx.answerCallbackQuery({ text: '⛔ Admin only.', show_alert: true });
    }
    await ctx.answerCallbackQuery();
    try {
        await adminBanksList(ctx);
    } catch (e) {
        console.error('adminBanksList error', e);
        ctx.reply('⚠️ Failed to load accounts.');
    }
});

bot.callbackQuery('bank_add', async (ctx) => {
    if (!ctx.from || ctx.from.id.toString() !== config.ADMIN_USER_ID) {
        return ctx.answerCallbackQuery({ text: '⛔ Admin only.', show_alert: true });
    }
    await ctx.answerCallbackQuery();
    const state = getState(BigInt(ctx.from.id));
    state.step = 'WAITING_BANK_NAME';
    delete state.tempBank;
    await ctx.reply('Send the *bank name* (e.g. Telebirr, CBE, Awash…):', { parse_mode: 'Markdown' });
});

bot.callbackQuery(/^bank_toggle_(\d+)$/, async (ctx) => {
    if (!ctx.from || ctx.from.id.toString() !== config.ADMIN_USER_ID) {
        return ctx.answerCallbackQuery({ text: '⛔ Admin only.', show_alert: true });
    }
    const id = parseInt(ctx.match![1]!, 10);
    try {
        const account = await prisma.paymentAccount.findUnique({ where: { id } });
        if (!account) return ctx.answerCallbackQuery({ text: 'Account not found.', show_alert: true });
        await prisma.paymentAccount.update({ where: { id }, data: { isActive: !account.isActive } });
        await ctx.answerCallbackQuery({ text: `${account.bankName} ${account.isActive ? 'deactivated' : 'activated'}.` });
        await adminBanksList(ctx, ctx.callbackQuery.message?.message_id);
    } catch (e) {
        console.error('bank_toggle error', e);
        ctx.answerCallbackQuery({ text: 'Failed.', show_alert: true });
    }
});

bot.command('banks', async (ctx) => {
    if (!ctx.from || ctx.from.id.toString() !== config.ADMIN_USER_ID) {
        return ctx.reply("⛔ This command is admin-only.");
    }
    await adminBanksList(ctx);
});

bot.command('addbank', async (ctx) => {
    if (!ctx.from || ctx.from.id.toString() !== config.ADMIN_USER_ID) {
        return ctx.reply("⛔ This command is admin-only.");
    }
    // Parse: split bank name from account number
    const m = (ctx.message?.text || '').replace(/^\/addbank\s*/i, '').trim().match(/^(.+?)\s+([0-9]+)\s*(.*)$/);
    if (!m) {
        return ctx.reply('Usage: `/addbank <bankName> <accountNumber> [accountHolder]`\nExample: `/addbank Telebirr 0912345678`', { parse_mode: 'Markdown' });
    }
    const bankName = m[1]!.trim();
    const accountNumber = m[2]!.trim();
    const accountName = (m[3] ?? '').trim() || null;
    try {
        const account = await prisma.paymentAccount.create({
            data: { bankName, accountNumber, accountName }
        });
        await ctx.reply(`✅ Added bank account:\n🏦 *${account.bankName}* — \`${account.accountNumber}\`${account.accountName ? `\n👤 ${account.accountName}` : ''}\n\nUse /banks to manage.`, { parse_mode: 'Markdown' });
    } catch (e) {
        console.error('addbank error', e);
        ctx.reply('⚠️ Failed to add account.');
    }
});

bot.command('rmbank', async (ctx) => {
    if (!ctx.from || ctx.from.id.toString() !== config.ADMIN_USER_ID) {
        return ctx.reply("⛔ This command is admin-only.");
    }
    const id = parseInt((ctx.message?.text || '').replace(/^\/rmbank\s*/i, '').trim(), 10);
    if (isNaN(id)) return ctx.reply('Usage: `/rmbank <id>` — use /banks to see ids.', { parse_mode: 'Markdown' });
    try {
        const account = await prisma.paymentAccount.findUnique({ where: { id } });
        if (!account) return ctx.reply('Account not found.');
        await prisma.paymentAccount.update({ where: { id }, data: { isActive: !account.isActive } });
        await ctx.reply(`${account.isActive ? '✅ Reactivated' : '⛔ Deactivated'} account #${id} (${account.bankName}).`);
    } catch (e) {
        console.error('rmbank error', e);
        ctx.reply('⚠️ Failed.');
    }
});

bot.callbackQuery('menu_register', async (ctx) => {
    const kb = new Keyboard().requestContact('📱 Share Phone Number').resized().oneTime();
    await ctx.reply('To complete your registration, please click the button below to share your phone number.', { reply_markup: kb });
    await ctx.answerCallbackQuery();
});

bot.on('message:contact', async (ctx) => {
    const contact = ctx.message.contact;
    if (!ctx.from) return;
    if (!contact?.phone_number) return;

    const userId = BigInt(ctx.from.id);
    const phone = contact.phone_number.replace(/[^\d+]/g, '');

    const existing = await prisma.user.findUnique({ where: { phone } });
    if (existing && existing.id !== userId) {
        return ctx.reply('❌ This phone number is already registered to another account. If this is your account, please contact support.\n\n📱 Already registered: ' + existing.phone, {
            reply_markup: { remove_keyboard: true }
        });
    }

    const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { phone }
    });

    await ctx.reply('✅ *Registration Complete!*\n\nWelcome to Habesha Bingo! Get ready to play and win.', {
        parse_mode: 'Markdown',
        reply_markup: { remove_keyboard: true }
    });

    await sendMainMenu(ctx, updatedUser);
});

bot.callbackQuery('menu_invite', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;

    const botInfo = await bot.api.getMe();
    const link = `https://t.me/${botInfo.username}?start=${ctx.from.id}`;

    await ctx.reply(
        `🔗 *Invite Friends & Earn!*\n\n` +
        `Share this referral link with your friends. When they join using your link, you get *5 Birr*! 🎉\n\n` +
        `\`${link}\`\n\n` +
        `👉 Share it now and grow your team!`,
        { parse_mode: "Markdown" }
    );
});

bot.callbackQuery('menu_playbingo', async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendPlayBingoMenu(ctx);
});

bot.command('playbingo', async (ctx) => {
    await sendPlayBingoMenu(ctx);
});

async function sendPlayBingoMenu(ctx: any) {
    const userId = ctx.from?.id;
    if (!userId) return;
    const user = await prisma.user.findUnique({ where: { id: BigInt(userId) } });
    if (!user?.phone) {
        const regKb = new Keyboard()
            .requestContact('📱 Register / Share Phone Number')
            .resized()
            .oneTime();
        return ctx.reply(
            `⚠️ *Registration Required*\n\nPlease click below to register your phone number before playing:`,
            { parse_mode: 'Markdown', reply_markup: regKb }
        );
    }
    const kb = new InlineKeyboard()
        .webApp('🎮 Play Habesha Bingo', `${BINGO_APP_URL}/index.html?userId=${userId}&v=${BINGO_APP_VERSION}`).row()
        .webApp('📋 Select Boards', `${BINGO_APP_URL}/boards.html?userId=${userId}&v=${BINGO_APP_VERSION}`);
        
    await ctx.reply('🍀 Best of luck on your Bingo game adventure! 🎮', { reply_markup: kb });
}

bot.callbackQuery('menu_deposit', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const accounts = await prisma.paymentAccount.findMany({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });
    if (accounts.length === 0) {
        return ctx.reply(
            `💳 *Deposit*\n\nNo payout account is configured yet. Please contact support.\n\n👉 Open wallet: ${BINGO_APP_URL}/wallet.html?userId=${ctx.from.id}`,
            { parse_mode: 'Markdown' }
        );
    }
    const kb = new InlineKeyboard();
    accounts.forEach(a => { kb.text(`🏦 ${a.bankName}`, `dep_bank_${a.id}`); kb.row(); });
    kb.webApp('📲 Open Deposit Page', `${BINGO_APP_URL}/deposit.html?userId=${ctx.from.id}`);
    await ctx.reply(
        `💳 *Deposit*\n\nChoose the account you will send the money to, then open the deposit page to submit the amount and your payment screenshot.\n\nSelect an account:`,
        { parse_mode: 'Markdown', reply_markup: kb }
    );
});

bot.callbackQuery(/^dep_bank_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const id = parseInt(ctx.match![1]!, 10);
    const account = await prisma.paymentAccount.findUnique({ where: { id } });
    if (!account || !account.isActive) {
        return ctx.reply('⚠️ This account is no longer available. Pick another:').then(() => ctx.reply('/start'));
    }
    const url = `${BINGO_APP_URL}/deposit.html?userId=${ctx.from.id}&acct=${id}`;
    const kb = new InlineKeyboard()
        .webApp('📲 Open Deposit Page', url).row()
        .text('🔙 Change account', 'menu_deposit');
    await ctx.reply(
        `🏦 *${account.bankName}*\n\nSend the money to this account, then open the deposit page to submit the amount and your payment screenshot.\n\n` +
        `📌 *Account number:*\n\`${account.accountNumber}\`\n` +
        (account.accountName ? `👤 *Name:* ${account.accountName}\n` : '') +
        `\n⬇️ After transferring, tap below to submit your deposit:`,
        { parse_mode: 'Markdown', reply_markup: kb }
    );
});

bot.callbackQuery('menu_balance', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const user = await prisma.user.findUnique({ where: { id: BigInt(ctx.from.id) } });
    const bonusText = user && user.bonus.toNumber() > 0 ? `\n🎁 *Bonus:* ${user.bonus} Birr` : '';
    await ctx.reply(`💰 Your current balance is: *${user?.balance || 0} Birr*${bonusText}`, { parse_mode: "Markdown" });
});

bot.callbackQuery(['menu_instructions', 'menu_support'], async (ctx) => {
    await ctx.answerCallbackQuery();
    const playUrl = `${config.BINGO_APP_URL}/index.html?userId=${ctx.from?.id}&v=${Date.now()}`;
    const kb = new InlineKeyboard()
        .webApp('🎮 አሁኑኑ ይጫወቱ (Play Now)', playUrl).row()
        .text('✍️ አስተያየት መስጫ (Feedback)', 'menu_feedback');

    await ctx.reply(INSTRUCTIONS_TEXT, {
        parse_mode: 'Markdown',
        reply_markup: kb
    });
});

bot.command(['instructions', 'rules', 'heg'], async (ctx) => {
    const playUrl = `${config.BINGO_APP_URL}/index.html?userId=${ctx.from?.id}&v=${Date.now()}`;
    const kb = new InlineKeyboard()
        .webApp('🎮 አሁኑኑ ይጫወቱ (Play Now)', playUrl).row()
        .text('✍️ አስተያየት መስጫ (Feedback)', 'menu_feedback');

    await ctx.reply(INSTRUCTIONS_TEXT, {
        parse_mode: 'Markdown',
        reply_markup: kb
    });
});

bot.callbackQuery(['menu_feedback', 'btn_feedback'], async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const userId = BigInt(ctx.from.id);
    const state = getState(userId);
    state.step = 'WAITING_FEEDBACK';

    const cancelKb = new InlineKeyboard().text('❌ ሰርዝ (Cancel)', 'cancel_feedback');
    await ctx.reply(
        `✍️ *አስተያየት፣ ጥቆማ ወይም ቅሬታ ይጻፉልን*\n\n` +
        `እባክዎ የሚፈልጉትን ማንኛውንም አስተያየት ወይም ጥያቄ በዚህ መልእክት ይላኩልን። መልእክትዎ በቀጥታ ለአስተዳዳሪው ይደርሳል!\n\n` +
        `_ለመሰረዝ ከታች ያለውን ሰርዝ የሚለውን ይጫኑ ወይም /cancel ይበሉ።_`,
        { parse_mode: 'Markdown', reply_markup: cancelKb }
    );
});

bot.command('feedback', async (ctx) => {
    if (!ctx.from) return;
    const userId = BigInt(ctx.from.id);
    const state = getState(userId);
    state.step = 'WAITING_FEEDBACK';

    const cancelKb = new InlineKeyboard().text('❌ ሰርዝ (Cancel)', 'cancel_feedback');
    await ctx.reply(
        `✍️ *አስተያየት፣ ጥቆማ ወይም ቅሬታ ይጻፉልን*\n\n` +
        `እባክዎ የሚፈልጉትን ማንኛውንም አስተያየት ወይም ጥያቄ በዚህ መልእክት ይላኩልን። መልእክትዎ በቀጥታ ለአስተዳዳሪው ይደርሳል!\n\n` +
        `_ለመሰረዝ ከታች ያለውን ሰርዝ የሚለውን ይጫኑ ወይም /cancel ይበሉ።_`,
        { parse_mode: 'Markdown', reply_markup: cancelKb }
    );
});

bot.callbackQuery('cancel_feedback', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    clearState(BigInt(ctx.from.id));
    await ctx.reply('❌ አስተያየት መላክ ተሰርዟል። ወደ ዋናው ሜኑ ለመመለስ /start ይበሉ።');
});

bot.command('cancel', async (ctx) => {
    if (!ctx.from) return;
    const userId = BigInt(ctx.from.id);
    const state = getState(userId);
    if (state.step !== 'NONE') {
        clearState(userId);
        return ctx.reply('❌ ክንውኑ ተሰርዟል (Cancelled). ወደ ዋናው ሜኑ ለመመለስ /start ይበሉ።');
    }
    return ctx.reply('ምንም የሚሰረዝ ንቁ ክንውን የለም።');
});

bot.command('start_game', async (ctx) => {
    if (!ctx.from) return;
    const rooms = gameRooms.roomsList();
    let started = 0;
    for (const room of rooms) {
        if (room.players.length >= 2 && room.state !== 'PLAYING') {
            await room.startGame();
            started++;
        }
    }
    if (started === 0) {
        return ctx.reply(`⚠️ No room has at least 2 players in the lobby yet. Ask players to click Play Bingo first!`);
    }
    await ctx.reply(`✅ Started ${started} game(s)!`);
});

bot.command('stop_game', async (ctx) => {
    if (!ctx.from) return;
    const rooms = gameRooms.roomsList();
    let stopped = 0;
    for (const room of rooms) {
        if (room.state === 'PLAYING') {
            room.state = 'WAITING';
            room.players = [];
            room.drawnNumbers.clear();
            room.lobbyCountdown = 0;
            stopped++;
        }
    }
    if (stopped === 0) {
        return ctx.reply(`⚠️ No game is currently running.`);
    }
    await ctx.reply(`✅ Stopped ${stopped} game(s) and lobby reset.`);
});

bot.command('admin', async (ctx) => {
    if (!ctx.from) return;
    if (ctx.from.id.toString() !== config.ADMIN_USER_ID) {
        return ctx.reply("⛔ This command is admin-only.");
    }
    const token = generateAdminToken();
    const adminUrl = `${config.BINGO_APP_URL}/admin.html?token=${token}`;
    const statsUrl = `${config.BINGO_APP_URL}/admin-stats.html?token=${token}`;

    const v = gameRooms.getCallerVoice();
    const vText = v === 'female' ? '👩 Female (ሴት)' : '👨 Male (ወንድ)';
    const kb = new InlineKeyboard()
        .url('🚀 Open Admin Dashboard (1-Click Login)', adminUrl).row()
        .url('📊 Open Stats & Analytics', statsUrl).row()
        .text('📋 Requests', 'menu_admin_requests')
        .text('📊 Status', 'menu_admin_status').row()
        .text('🏦 Banks', 'menu_admin_banks')
        .text('📣 Broadcast', 'menu_admin_broadcast').row()
        .text('▶️ Start Game', 'menu_admin_start')
        .text('⏹ Stop Game', 'menu_admin_stop').row()
        .text(`🎙️ Voice: ${vText}`, 'menu_admin_voice');

    await ctx.reply(
        "🔒 *Habesha Bingo Admin Portal*\n\n" +
        "• Click the buttons below for secure **1-Click Web Access**.\n" +
        "• `/requests` — view & approve/reject deposits/withdrawals\n" +
        "• `/banks` — manage payout accounts\n" +
        "• `/voice [male|female]` — switch caller voice for all players\n" +
        "• `/broadcast <msg>` — send an announcement to all users\n" +
        "• `/start_game` — force start games\n" +
        "• `/stop_game` — stop running games\n\n" +
        `🎙️ *Active Caller Voice:* *${vText}*`,
        { parse_mode: "Markdown", reply_markup: kb }
    );
});

bot.command(['voice', 'caller'], async (ctx) => {
    if (!ctx.from || ctx.from.id.toString() !== config.ADMIN_USER_ID) {
        return ctx.reply("⛔ This command is admin-only.");
    }
    const args = (ctx.match || '').toString().trim().toLowerCase();
    if (args === 'male' || args === 'female') {
        gameRooms.setCallerVoice(args as 'male' | 'female');
        const icon = args === 'female' ? '👩' : '👨';
        const label = args === 'female' ? 'Female (የሴት ድምፅ)' : 'Male (የወንድ ድምፅ)';
        return ctx.reply(`✅ *Caller Voice Updated!*\n\nAll players are now playing with ${icon} *${label}*.`, { parse_mode: 'Markdown' });
    }

    const cur = gameRooms.getCallerVoice();
    const curLabel = cur === 'female' ? '👩 Female (የሴት ድምፅ)' : '👨 Male (የወንድ ድምፅ)';
    const kb = new InlineKeyboard()
        .text('👨 Set Male Voice (ወንድ)', 'voice_set_male')
        .text('👩 Set Female Voice (ሴት)', 'voice_set_female');

    await ctx.reply(
        `🎙️ *Bingo Caller Voice Control*\n\n` +
        `Current active voice for all players: *${curLabel}*\n\n` +
        `Tap a button below to switch the voice immediately:`,
        { parse_mode: 'Markdown', reply_markup: kb }
    );
});


bot.command('income', async (ctx) => {
    if (!ctx.from || ctx.from.id.toString() !== config.ADMIN_USER_ID) {
        return ctx.reply("⛔ This command is admin-only.");
    }
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const allTime = await prisma.houseIncome.aggregate({
            _sum: { houseProfit: true, totalCollected: true },
            _count: { id: true }
        });

        const daily = await prisma.houseIncome.aggregate({
            where: { createdAt: { gte: today } },
            _sum: { houseProfit: true, totalCollected: true },
            _count: { id: true }
        });

        const msg = `💰 *House Income Report* 💰\n\n*📅 Today:*\nGames Played: ${daily._count.id}\nTotal Collected: ${daily._sum.totalCollected || 0} ETB\n*House Profit: ${daily._sum.houseProfit || 0} ETB*\n\n*📈 All-Time:*\nGames Played: ${allTime._count.id}\nTotal Collected: ${allTime._sum.totalCollected || 0} ETB\n*House Profit: ${allTime._sum.houseProfit || 0} ETB*`;
        
        await ctx.reply(msg, { parse_mode: 'Markdown' });
    } catch (e) {
        await ctx.reply('Error fetching income data: ' + e);
    }
});

bot.command('requests', async (ctx) => {
    if (!ctx.from || ctx.from.id.toString() !== config.ADMIN_USER_ID) {
        return ctx.reply("⛔ This command is admin-only.");
    }
    await ctx.reply("Loading requests...");
    await sendRequests(ctx, 0);
});

async function sendRequests(ctx: any, offset: number) {
    const PAGE = 10;
    try {
        const [requests, total] = await Promise.all([
            prisma.transactionRequest.findMany({
                where: { status: 'PENDING' },
                orderBy: { createdAt: 'asc' },
                skip: offset,
                take: PAGE,
                include: { user: { select: { firstName: true, username: true } } }
            }),
            prisma.transactionRequest.count({ where: { status: 'PENDING' } })
        ]);

        if (requests.length === 0) {
            return ctx.reply("✅ No pending requests. All caught up!");
        }

        await ctx.reply(`📋 *Pending Requests (${total})*`, { parse_mode: 'Markdown' });
        for (const r of requests) {
            const { text, kb } = renderRow(r);
            await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
            await sendProofPhoto(ctx, r);
        }

        // Pagination hint
        const page = Math.floor(offset / PAGE);
        const totalPages = Math.max(1, Math.ceil(total / PAGE));
        if (totalPages > 1) {
            const kb = new InlineKeyboard();
            const nav: any[] = [];
            if (page > 0) nav.push({ text: '⬅️ Prev', callback_data: `req_page_${offset - PAGE}` });
            nav.push({ text: `📄 ${page + 1}/${totalPages}`, callback_data: 'req_none' });
            if ((page + 1) * PAGE < total) nav.push({ text: 'Next ➡️', callback_data: `req_page_${offset + PAGE}` });
            kb.row(...nav);
            await ctx.reply(`Page ${page + 1} of ${totalPages}`, { reply_markup: kb });
        }
    } catch (e) {
        console.error('sendRequests error', e);
        ctx.reply('⚠️ Failed to load requests.');
    }
}

function renderRow(r: any) {
    const user = r.user;
    const isDep = r.type === 'deposit';
    const icon = isDep ? '💳' : '⬆️';
    const uname = user?.username ? `@${user?.username}` : `ID:${r.userId}`;
    const time = r.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const phone = r.phone ? ` · 📱 ${r.phone}` : '';
    const proof = r.proof && isDep ? `<a href="${proofUrl(r.proof)}"> · 📎 Screenshot</a>` : '';
    const account = isDep && r.bankName ? ` · 🏦 ${r.bankName}` : '';
    const text =
        `${icon} <b>#${r.id}</b> ${isDep ? 'Deposit' : 'Withdraw'} · <b>${r.amount.toNumber()} Birr</b>\n` +
        `👤 ${user?.firstName || 'Player'} (${uname}) · 🕒 ${time}${phone}${proof}${account}`;

    const kb = new InlineKeyboard()
        .text('✅ Approve', `req_approve_${r.id}`)
        .text('❌ Reject', `req_reject_${r.id}`);
    return { text, kb };
}

async function sendProofPhoto(ctx: any, r: any) {
    if (r.type !== 'deposit' || !r.proof) return;
    try {
        const file = readFileSync(proofPath(r.proof));
        await ctx.replyWithPhoto(new InputFile(file), { caption: `📎 Deposit proof for request #${r.id}` });
    } catch (e) {
        console.error('sendProofPhoto failed', e);
        await ctx.reply(`📎 Proof for #${r.id}: ${proofUrl(r.proof)}`).catch(() => {});
    }
}

bot.callbackQuery(/^req_none$/, async (ctx) => {
    await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^req_page_(\d+)$/, async (ctx) => {
    if (!ctx.from || ctx.from.id.toString() !== config.ADMIN_USER_ID) {
        return ctx.answerCallbackQuery({ text: "⛔ Admin only.", show_alert: true });
    }
    const offset = parseInt(ctx.match[1], 10);
    try {
        const [requests, total] = await Promise.all([
            prisma.transactionRequest.findMany({
                where: { status: 'PENDING' },
                orderBy: { createdAt: 'asc' },
                skip: offset,
                take: 10,
                include: { user: { select: { firstName: true, username: true } } }
            }),
            prisma.transactionRequest.count({ where: { status: 'PENDING' } })
        ]);
        if (requests.length === 0) return ctx.answerCallbackQuery({ text: 'No more requests.', show_alert: true });

        await ctx.answerCallbackQuery();
        await ctx.editMessageText(`📋 *Pending Requests (${total})*`, { parse_mode: 'Markdown' });
        for (const r of requests) {
            const { text, kb } = renderRow(r);
            await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
            await sendProofPhoto(ctx, r);
        }

        const page = Math.floor(offset / 10);
        const totalPages = Math.max(1, Math.ceil(total / 10));
        if (totalPages > 1) {
            const kb = new InlineKeyboard();
            const nav: any[] = [];
            if (page > 0) nav.push({ text: '⬅️ Prev', callback_data: `req_page_${offset - 10}` });
            nav.push({ text: `📄 ${page + 1}/${totalPages}`, callback_data: 'req_none' });
            if ((page + 1) * 10 < total) nav.push({ text: 'Next ➡️', callback_data: `req_page_${offset + 10}` });
            kb.row(...nav);
            await ctx.reply(`Page ${page + 1} of ${totalPages}`, { reply_markup: kb });
        }
    } catch (e) {
        console.error('req_page error', e);
        await ctx.answerCallbackQuery({ text: 'Failed to load page.', show_alert: true });
    }
});

bot.callbackQuery(/^req_(approve|reject)_(\d+)$/, async (ctx) => {
    if (!ctx.from || ctx.from.id.toString() !== config.ADMIN_USER_ID) {
        return ctx.answerCallbackQuery({ text: "⛔ Admin only.", show_alert: true });
    }
    const action = ctx.match[1];
    const id = parseInt(ctx.match[2], 10);

    try {
        const request = await prisma.transactionRequest.findUnique({ where: { id } });
        if (!request) return ctx.answerCallbackQuery({ text: "Request not found.", show_alert: true });
        if (request.status !== 'PENDING') return ctx.answerCallbackQuery({ text: "This request was already handled.", show_alert: true });

        if (action === 'approve') {
            if (request.type === 'deposit') {
                await prisma.$transaction([
                    prisma.user.update({ where: { id: request.userId }, data: { balance: { increment: request.amount } } }),
                    prisma.transactionRequest.update({ where: { id }, data: { status: 'APPROVED' } })
                ]);
            } else {
                const user = await prisma.user.findUnique({ where: { id: request.userId } });
                if (!user || user.balance.toNumber() < request.amount.toNumber()) {
                    return ctx.answerCallbackQuery({ text: "❌ User has insufficient balance for this withdrawal.", show_alert: true });
                }
                await prisma.$transaction([
                    prisma.user.update({ where: { id: request.userId }, data: { balance: { decrement: request.amount } } }),
                    prisma.transactionRequest.update({ where: { id }, data: { status: 'APPROVED' } })
                ]);
            }
            try { await bot.api.sendMessage(Number(request.userId), `✅ *Your ${request.type} request of ${request.amount.toNumber()} Birr has been approved!*`, { parse_mode: "Markdown" }); } catch (e) {}
            await ctx.answerCallbackQuery({ text: `✅ Approved ${request.type} request #${id}.` });
            await ctx.editMessageText(
                `✅ <s>${stripHtml(ctx.update.callback_query.message?.text || '')}</s>\n\n<b>Approved by admin</b>`,
                { parse_mode: 'HTML', reply_markup: undefined }
            ).catch(() => {});
        } else {
            await prisma.transactionRequest.update({ where: { id }, data: { status: 'REJECTED' } });
            try { await bot.api.sendMessage(Number(request.userId), `❌ *Your ${request.type} request of ${request.amount.toNumber()} Birr was rejected.*\nPlease contact support if you have questions.`, { parse_mode: "Markdown" }); } catch (e) {}
            await ctx.answerCallbackQuery({ text: `❌ Rejected ${request.type} request #${id}.` });
            await ctx.editMessageText(
                `❌ <s>${stripHtml(ctx.update.callback_query.message?.text || '')}</s>\n\n<b>Rejected by admin</b>`,
                { parse_mode: 'HTML', reply_markup: undefined }
            ).catch(() => {});
        }
    } catch (e) {
        console.error('Handle request error', e);
        await ctx.answerCallbackQuery({ text: "⚠️ Failed to process request.", show_alert: true });
    }
});

function stripHtml(s: string) {
    return s.replace(/<[^>]+>/g, '').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
}

bot.command('broadcast', async (ctx) => {
    if (!ctx.from || ctx.from.id.toString() !== config.ADMIN_USER_ID) return;
    const msg = ctx.message?.text?.replace(/^\/broadcast\s*/i, '').trim();
    const userId = BigInt(ctx.from.id);
    const state = getState(userId);

    if (!msg) {
        state.step = 'WAITING_BROADCAST';
        delete state.broadcastDraft;
        return ctx.reply(
            `📣 *Broadcast Announcement Mode*\n\n` +
            `Send your announcement message now:\n` +
            `• Send a **Photo / Banner Image** (with caption description)\n` +
            `• Or send a **Text message**\n\n` +
            `*The bot will automatically attach game buttons (🎮 Play, 💰 Deposit, Channel, Feedback) and let you preview before broadcasting to all players.*`,
            { parse_mode: 'Markdown' }
        );
    }

    state.broadcastDraft = { text: msg };
    state.step = 'CONFIRM_BROADCAST';

    const previewKb = getBroadcastKeyboard(userId);
    await ctx.reply('👇 *Broadcast Message Preview:*', { parse_mode: 'Markdown' });
    await ctx.reply(msg, {
        parse_mode: 'Markdown',
        reply_markup: previewKb
    }).catch(async () => {
        await ctx.reply(msg, { reply_markup: previewKb });
    });

    const usersCount = await prisma.user.count();
    const actionKb = new InlineKeyboard()
        .text(`🚀 Send Broadcast (${usersCount} users)`, 'broadcast_confirm').row()
        .text('❌ Cancel Broadcast', 'broadcast_cancel');

    await ctx.reply(
        `❓ *Ready to broadcast this message to ${usersCount} users?*`,
        { parse_mode: 'Markdown', reply_markup: actionKb }
    );
});

bot.on('message:photo', async (ctx) => {
    if (!ctx.from) return;
    const userId = BigInt(ctx.from.id);
    const state = getState(userId);

    if (state.step === 'WAITING_FEEDBACK') {
        clearState(userId);
        const user = await prisma.user.findUnique({ where: { id: userId } });
        const fullName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || 'Player';
        const usernameStr = ctx.from.username ? `@${ctx.from.username}` : 'None';
        const phoneStr = user?.phone || 'Not shared';
        const caption = ctx.message.caption || '(No caption)';
        const photos = ctx.message.photo;
        const photoFileId = photos[photos.length - 1].file_id;

        if (config.ADMIN_USER_ID) {
            try {
                await bot.api.sendPhoto(
                    config.ADMIN_USER_ID,
                    photoFileId,
                    {
                        caption: `📬 <b>አዲስ የተጠቃሚ አስተያየት (ፎቶ)!</b>\n\n` +
                            `👤 <b>ተጫዋች:</b> ${escapeHtmlBot(fullName)} (${escapeHtmlBot(usernameStr)})\n` +
                            `🆔 <b>ID:</b> <code>${ctx.from.id}</code> | 📱 <code>${escapeHtmlBot(phoneStr)}</code>\n\n` +
                            `💬 <b>መልእክት:</b> ${escapeHtmlBot(caption)}`,
                        parse_mode: 'HTML'
                    }
                );
            } catch (err) {
                console.error('[BOT] Failed to forward feedback photo to admin:', err);
            }
        }

        return ctx.reply(
            `✅ *ፎቶዎ እና አስተያየትዎ በተሳካ ሁኔታ ለአስተዳዳሪው ደርሷል!*\n\nእናመሰግናለን። 🎮`,
            { parse_mode: 'Markdown' }
        );
    }

    if (state.step === 'WAITING_BROADCAST') {
        if (ctx.from.id.toString() !== config.ADMIN_USER_ID) {
            clearState(userId);
            return ctx.reply("⛔ Not allowed.");
        }
        
        const photos = ctx.message.photo;
        const photoFileId = photos[photos.length - 1].file_id;
        const caption = (ctx.message.caption || '').trim();

        if (caption) {
            state.broadcastDraft = { photoFileId, caption };
            state.step = 'CONFIRM_BROADCAST';
            await showBroadcastPreview(ctx, userId, state.broadcastDraft);
        } else {
            state.broadcastDraft = { photoFileId, caption: '' };
            state.step = 'WAITING_BROADCAST_CAPTION';

            const skipKb = new InlineKeyboard().text('⏩ Skip Caption (Send Image Only)', 'broadcast_skip_caption');
            await ctx.reply(
                `🖼 *Photo Received!*\n\n` +
                `Now please send the **description text** (caption) to display below this image:\n` +
                `_(Or press Skip if no text description is needed)_`,
                { parse_mode: 'Markdown', reply_markup: skipKb }
            );
        }
    }
});

// --- Text Handler for Conversations ---

bot.on('message:text', async (ctx) => {
    if (!ctx.from) return;
    const userId = BigInt(ctx.from.id);
    const state = getState(userId);
    const text = ctx.message.text.trim();

    if (state.step === 'WAITING_FEEDBACK') {
        clearState(userId);
        const user = await prisma.user.findUnique({ where: { id: userId } });
        const fullName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || 'Player';
        const usernameStr = ctx.from.username ? `@${ctx.from.username}` : 'None';
        const phoneStr = user?.phone || 'Not shared';
        const timeStr = new Date().toLocaleString('en-US', { timeZone: 'Africa/Addis_Ababa' });

        if (config.ADMIN_USER_ID) {
            try {
                await bot.api.sendMessage(
                    config.ADMIN_USER_ID,
                    `📬 <b>አዲስ የተጠቃሚ አስተያየት (New Player Feedback)!</b>\n\n` +
                    `👤 <b>ተጫዋች:</b> ${escapeHtmlBot(fullName)}\n` +
                    `🏷 <b>Username:</b> ${escapeHtmlBot(usernameStr)}\n` +
                    `🆔 <b>User ID:</b> <code>${ctx.from.id}</code>\n` +
                    `📱 <b>ስልክ:</b> <code>${escapeHtmlBot(phoneStr)}</code>\n` +
                    `⏰ <b>ሰዓት:</b> ${escapeHtmlBot(timeStr)}\n\n` +
                    `💬 <b>መልእክት:</b>\n${escapeHtmlBot(text)}`,
                    { parse_mode: 'HTML' }
                );
            } catch (err) {
                console.error('[BOT] Failed to forward feedback to admin:', err);
            }
        }

        return ctx.reply(
            `✅ *አስተያየትዎ በተሳካ ሁኔታ ለአስተዳዳሪው ደርሷል!*\n\n` +
            `ሀሳብዎን ስላጋሩን ከልብ እናመሰግናለን። መልካም ጨዋታ ይሁንልዎ! 🎮`,
            { parse_mode: 'Markdown' }
        );
    }

    if (state.step === 'WAITING_BROADCAST_CAPTION') {
        if (ctx.from.id.toString() !== config.ADMIN_USER_ID) {
            clearState(userId);
            return ctx.reply("⛔ Not allowed.");
        }

        if (!state.broadcastDraft || !state.broadcastDraft.photoFileId) {
            state.step = 'WAITING_BROADCAST';
            return ctx.reply("No photo draft found. Please send a photo first.");
        }

        state.broadcastDraft.caption = text;
        state.step = 'CONFIRM_BROADCAST';
        await showBroadcastPreview(ctx, userId, state.broadcastDraft);
        return;
    }

    if (state.step === 'WAITING_BROADCAST') {
        if (ctx.from.id.toString() !== config.ADMIN_USER_ID) {
            clearState(userId);
            return ctx.reply("⛔ Not allowed.");
        }
        
        const textMsg = text;
        if (!textMsg) return ctx.reply("Please provide a message.");

        state.broadcastDraft = { text: textMsg };
        state.step = 'CONFIRM_BROADCAST';
        await showBroadcastPreview(ctx, userId, state.broadcastDraft);
        return;
    }

    if (state.step === 'WAITING_BANK_NAME') {
        if (ctx.from.id.toString() !== config.ADMIN_USER_ID) { clearState(userId); return ctx.reply("⛔ Not allowed."); }
        if (text.length < 2) return ctx.reply("Please enter a valid bank name (e.g. Telebirr, CBE, Awash).");
        state.tempBank = { bankName: text, accountNumber: '' };
        state.step = 'WAITING_BANK_ACCOUNT';
        return ctx.reply(`🏦 Bank: *${text}*\n\nNow send the *account number* (e.g. 0912345678):`, { parse_mode: 'Markdown' });
    }

    if (state.step === 'WAITING_BANK_ACCOUNT') {
        if (ctx.from.id.toString() !== config.ADMIN_USER_ID) { clearState(userId); return ctx.reply("⛔ Not allowed."); }
        if (!/^[0-9\-\s]{4,}$/.test(text)) return ctx.reply("Please enter a valid account number (digits only).");
        state.tempBank = { ...state.tempBank!, accountNumber: text.replace(/[^0-9]/g, '') };
        state.step = 'WAITING_BANK_HOLDER';
        return ctx.reply(`📌 Account number: \`${state.tempBank!.accountNumber}\`\n\nSend the *account holder name* (or type \`skip\` to skip):`, { parse_mode: 'Markdown' });
    }

    if (state.step === 'WAITING_BANK_HOLDER') {
        if (ctx.from.id.toString() !== config.ADMIN_USER_ID) { clearState(userId); return ctx.reply("⛔ Not allowed."); }
        const holder = text.toLowerCase() === 'skip' ? null : text;
        const b = state.tempBank!;
        try {
            const account = await prisma.paymentAccount.create({
                data: { bankName: b.bankName, accountNumber: b.accountNumber, accountName: holder }
            });
            await ctx.reply(
                `✅ Bank account added!\n\n🏦 *${account.bankName}*\n📌 \`${account.accountNumber}\`\n👤 ${account.accountName || '—'}\n\nPlayers can now select it when depositing.`,
                { parse_mode: 'Markdown' }
            );
        } catch (e) {
            console.error('add bank error', e);
            await ctx.reply('⚠️ Failed to save account.');
        }
        clearState(userId);
        return;
    }

    if (state.step === 'WAITING_DEPOSIT_AMOUNT') {
        const amount = parseFloat(text);
        if (isNaN(amount) || amount < 10) {
            return ctx.reply("Please enter a valid amount (Minimum 10 Birr).");
        }
        
        const payUrl = await TelebirrService.generatePaymentUrl(userId, amount);
        clearState(userId);
        
        const keyboard = new InlineKeyboard().url('💳 Pay with Telebirr', payUrl);
        return ctx.reply(`You requested to deposit *${amount} Birr*.\n\nClick the button below to complete your payment via Telebirr.`, { parse_mode: "Markdown", reply_markup: keyboard });
    }

    if (state.step === 'WAITING_WITHDRAW_AMOUNT') {
        const amount = parseFloat(text);
        if (isNaN(amount) || amount < 10) {
            return ctx.reply("Please enter a valid amount (Minimum 10 Birr).");
        }
        
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user || user.balance.toNumber() < amount) {
            clearState(userId);
            return ctx.reply("❌ Insufficient balance for this withdrawal.");
        }

        state.tempAmount = amount;
        state.step = 'WAITING_WITHDRAW_PHONE';
        return ctx.reply("Please enter your Telebirr phone number (e.g., 0911234567):");
    }

    if (state.step === 'WAITING_WITHDRAW_PHONE') {
        const phone = text;
        const amount = state.tempAmount!;
        
        if (phone.length < 9) {
            return ctx.reply("Please enter a valid phone number.");
        }

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user || user.balance.toNumber() < amount) {
            clearState(userId);
            return ctx.reply("❌ Insufficient balance. Transaction cancelled.");
        }

        await prisma.user.update({
            where: { id: userId },
            data: { balance: { decrement: amount } }
        });

        const success = await TelebirrService.processWithdrawal(userId, phone, amount);
        clearState(userId);

        if (success) {
            return ctx.reply(`✅ *Withdrawal Successful!*\n\n${amount} Birr has been sent to ${phone} via Telebirr.`, { parse_mode: "Markdown" });
        } else {
            await prisma.user.update({
                where: { id: userId },
                data: { balance: { increment: amount } }
            });
            return ctx.reply("❌ Withdrawal failed due to an error with Telebirr. Your balance has been refunded.");
        }
    }
});

// --- Callbacks ---

bot.callbackQuery('wallet', async (ctx) => {
    if (!ctx.from) return;
    const userId = BigInt(ctx.from.id);
    clearState(userId);
    
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return ctx.answerCallbackQuery("User not found.");

    const bonusText = user.bonus.toNumber() > 0 ? `\n🎁 *Bonus:* ${user.bonus} Birr` : '';
    const keyboard = new InlineKeyboard()
        .url('⬇️ Deposit', `${BINGO_APP_URL}/deposit.html?userId=${ctx.from.id}`)
        .url('⬆️ Withdraw', `${BINGO_APP_URL}/withdraw.html?userId=${ctx.from.id}`).row()
        .text('🔙 Back', 'main_menu');

    await ctx.editMessageText(
        `💰 *Your Wallet*\n\nBalance: *${user.balance.toString()} Birr*${bonusText}`,
        { parse_mode: "Markdown", reply_markup: keyboard }
    );
});

bot.callbackQuery('deposit', async (ctx) => {
    if (!ctx.from) return;
    await ctx.answerCallbackQuery();
    await ctx.reply(`Open the deposit page to submit a request:\n${BINGO_APP_URL}/deposit.html?userId=${ctx.from.id}`);
});

bot.callbackQuery('withdraw', async (ctx) => {
    if (!ctx.from) return;
    const userId = BigInt(ctx.from.id);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.balance.toNumber() < 10) {
        return ctx.answerCallbackQuery({ text: "You need at least 10 Birr to withdraw.", show_alert: true });
    }

    await ctx.answerCallbackQuery();
    await ctx.reply(`Open the withdrawal page to submit a request:\n${BINGO_APP_URL}/withdraw.html?userId=${ctx.from.id}`);
});

bot.callbackQuery('referral_link', async (ctx) => {
    if (!ctx.from) return;
    const userId = BigInt(ctx.from.id);
    clearState(userId);
    
    const botInfo = await bot.api.getMe();
    const link = `https://t.me/${botInfo.username}?start=${ctx.from.id}`;
    
    const keyboard = new InlineKeyboard().text('🔙 Back', 'main_menu');
    
    await ctx.editMessageText(
        `🔗 *Your Referral Link*\n\nShare this link with your friends. For every friend who joins, you will earn *5 Birr*!\n\n\`${link}\``,
        { parse_mode: "Markdown", reply_markup: keyboard }
    );
});

bot.callbackQuery('main_menu', async (ctx) => {
    if (!ctx.from) return;
    clearState(BigInt(ctx.from.id));
    
    const keyboard = new InlineKeyboard()
        .text('💰 My Wallet', 'wallet')
        .text('🎮 Play Bingo', 'play_bingo').row()
        .text('🔗 My Referral Link', 'referral_link');

    await ctx.editMessageText(
        `Welcome to *Habesha Bingo Bot*! 🎮💰\n\nPlay multiplayer Bingo, invite friends, and win big.`,
        { parse_mode: "Markdown", reply_markup: keyboard }
    );
});

bot.callbackQuery('play_bingo', async (ctx) => {
    if (!ctx.from) return;
    const userId = BigInt(ctx.from.id);
    clearState(userId);
    
    const gameManager = gameRooms.getRoom(10);
    const res = await gameManager.joinGame(userId);
    if (res.success && res.keyboard) {
        // Get the message_id BEFORE editing (editMessageText returns `true` not a Message in grammY)
        const messageId = ctx.callbackQuery.message?.message_id;
        await ctx.editMessageText(res.msg, { parse_mode: "Markdown", reply_markup: res.keyboard });
        if (messageId) {
            gameManager.setPlayerMessageId(userId, messageId);
        }
    } else {
        await ctx.answerCallbackQuery({ text: res.msg, show_alert: true });
    }
});

bot.callbackQuery(/^daub_(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const num = parseInt(ctx.match[1]);
    const userId = BigInt(ctx.from.id);
    
    const gameManager = gameRooms.findPlayer(userId);
    if (!gameManager) {
        return ctx.answerCallbackQuery({ text: "You are not in a game.", show_alert: true });
    }
    const res = await gameManager.daubNumber(userId, num);
    if (res.success && res.keyboard) {
        await ctx.editMessageReplyMarkup({ reply_markup: res.keyboard });
        if (res.msg === "BINGO!") {
            await ctx.answerCallbackQuery({ text: "BINGO! You won!", show_alert: true });
        } else {
            await ctx.answerCallbackQuery();
        }
    } else {
        await ctx.answerCallbackQuery({ text: res.msg || "Error", show_alert: true });
    }
});

bot.callbackQuery('ignore', async (ctx) => {
    await ctx.answerCallbackQuery();
});

// --- Init ---

bot.catch((err) => {
    console.error(`Error while handling update ${err.ctx.update.update_id}:`);
    console.error(err.error);
});

process.on('uncaughtException', (err) => {
    console.error('[Process] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[Process] Unhandled Rejection at:', promise, 'reason:', reason);
});

let adminServerStarted = false;
function ensureAdminServer() {
    if (!adminServerStarted) {
        adminServerStarted = true;
        startAdminServer(gameRooms, bot);
    }
}

// Start admin/game web server immediately so WebSockets and HTTP are always available
ensureAdminServer();

async function startPollingLoop() {
    while (true) {
        try {
            console.log('[Bot] Starting Telegram polling...');
            await bot.start({
                onStart: (botInfo) => {
                    console.log(`Bot @${botInfo.username} started successfully!`);
                }
            });
            console.warn('[Bot] Polling stopped. Reconnecting in 3 seconds...');
        } catch (err: any) {
            console.error('[Bot] Polling loop error:', err?.message || err);
            console.log('[Bot] Reconnecting in 5 seconds...');
        }
        await new Promise((res) => setTimeout(res, 5000));
    }
}

startPollingLoop();
