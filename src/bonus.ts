import { prisma } from './db';
import {
    getNewUserBonus as getNewUserBonusSetting,
    getReferralBonus as getReferralBonusSetting,
    setBonusSettings as setBonusSettingsHelper
} from './settings';

export interface DeductResult {
    success: boolean;
    bonusUsed: number;
    withdrawableUsed: number;
}

export let NEW_USER_BONUS = 10;
export let REFERRAL_BONUS = 5;

export function getNewUserBonus(): number {
    return getNewUserBonusSetting();
}

export function getReferralBonus(): number {
    return getReferralBonusSetting();
}

export function setBonusSettings(newUserBonus: number, referralBonus: number): { newUserBonus: number; referralBonus: number } {
    const res = setBonusSettingsHelper(newUserBonus, referralBonus);
    NEW_USER_BONUS = res.newUserBonus;
    REFERRAL_BONUS = res.referralBonus;
    return res;
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
