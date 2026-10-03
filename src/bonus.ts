import { prisma } from './db';

export interface DeductResult {
    success: boolean;
    bonusUsed: number;
}

export const NEW_USER_BONUS = 10;

// Deducts an entry fee preferring the user's bonus first, then their balance.
// New users get a 10 Birr bonus which is consumed on their first paid game,
// after which normal balance is used. Demo (fee <= 0) is always free.
export async function deductFee(userId: bigint, fee: number): Promise<DeductResult> {
    if (fee <= 0) return { success: true, bonusUsed: 0 };

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return { success: false, bonusUsed: 0 };

    const bonus = user.bonus.toNumber();
    const balance = user.balance.toNumber();
    if (balance + bonus < fee) return { success: false, bonusUsed: 0 };

    const bonusUsed = Math.min(bonus, fee);
    const fromBalance = fee - bonusUsed;

    await prisma.user.update({
        where: { id: userId },
        data: {
            balance: { decrement: fromBalance },
            bonus: { decrement: bonusUsed }
        }
    });

    return { success: true, bonusUsed };
}