import fs from 'fs';
import path from 'path';
import { prisma } from './db';

export interface DeductResult {
    success: boolean;
    bonusUsed: number;
    withdrawableUsed: number;
}

const SETTINGS_PATH = path.join(process.cwd(), 'data', 'settings.json');

export let NEW_USER_BONUS = 10;
export let REFERRAL_BONUS = 5;

function loadBonusSettings() {
    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
            const data = JSON.parse(raw);
            if (typeof data.newUserBonus === 'number' && data.newUserBonus >= 0) {
                NEW_USER_BONUS = Math.floor(data.newUserBonus);
            }
            if (typeof data.referralBonus === 'number' && data.referralBonus >= 0) {
                REFERRAL_BONUS = Math.floor(data.referralBonus);
            }
        }
    } catch (e) {
        console.error('[Bonus] Error reading settings file:', e);
    }
}

// Initial load from persistent storage
loadBonusSettings();

export function getNewUserBonus(): number {
    return NEW_USER_BONUS;
}

export function getReferralBonus(): number {
    return REFERRAL_BONUS;
}

export function setBonusSettings(newUserBonus: number, referralBonus: number): { newUserBonus: number; referralBonus: number } {
    if (typeof newUserBonus !== 'number' || isNaN(newUserBonus) || newUserBonus < 0) {
        throw new Error('Invalid newUserBonus: must be a non-negative number');
    }
    if (typeof referralBonus !== 'number' || isNaN(referralBonus) || referralBonus < 0) {
        throw new Error('Invalid referralBonus: must be a non-negative number');
    }

    NEW_USER_BONUS = Math.floor(newUserBonus);
    REFERRAL_BONUS = Math.floor(referralBonus);

    try {
        const dir = path.dirname(SETTINGS_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        let currentData: any = {};
        if (fs.existsSync(SETTINGS_PATH)) {
            try {
                currentData = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
            } catch {}
        }
        currentData.newUserBonus = NEW_USER_BONUS;
        currentData.referralBonus = REFERRAL_BONUS;
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(currentData, null, 2), 'utf8');
    } catch (e) {
        console.error('[Bonus] Error saving settings file:', e);
    }

    return { newUserBonus: NEW_USER_BONUS, referralBonus: REFERRAL_BONUS };
}

// Deducts an entry fee preferring the user's bonus first, then their balance.
// New users get a welcome bonus which is consumed on their first paid game,
// after which normal balance is used. Demo (fee <= 0) is always free.
export async function deductFee(userId: bigint, fee: number): Promise<DeductResult> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return { success: false, bonusUsed: 0, withdrawableUsed: 0 };

    if (fee <= 0) return { success: true, bonusUsed: 0, withdrawableUsed: 0 };

    const bonus = user.bonus.toNumber();
    const balance = user.balance.toNumber();
    if (balance + bonus < fee) return { success: false, bonusUsed: 0, withdrawableUsed: 0 };

    const bonusUsed = Math.min(bonus, fee);
    const fromBalance = fee - bonusUsed;

    const currentWithdrawable = user.withdrawableBalance ? user.withdrawableBalance.toNumber() : 0;
    const newBalance = Math.max(0, balance - fromBalance);
    const newWithdrawable = Math.max(0, Math.min(newBalance, currentWithdrawable));
    const withdrawableUsed = Math.max(0, currentWithdrawable - newWithdrawable);

    await prisma.user.update({
        where: { id: userId },
        data: {
            balance: { decrement: fromBalance },
            bonus: { decrement: bonusUsed },
            withdrawableBalance: { set: newWithdrawable }
        }
    });

    return { success: true, bonusUsed, withdrawableUsed };
}