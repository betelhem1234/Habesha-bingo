import test from 'node:test';
import assert from 'node:assert/strict';

test('Duty Withdrawal Admin & Game Winnings Restriction Tests', async (t) => {
    // ----------------------------------------------------
    // Mock Models & State
    // ----------------------------------------------------
    interface MockUser {
        id: bigint;
        username?: string | null;
        firstName: string;
        balance: number;
        bonus: number;
        withdrawableBalance: number;
        assignedAdminId?: number | null;
    }

    interface MockAdminProfile {
        id: number;
        userId: bigint;
        code: string;
        customName?: string | null;
        isActive: boolean;
        isWithdrawalAdmin: boolean;
    }

    interface MockTransactionRequest {
        id: number;
        userId: bigint;
        type: 'deposit' | 'withdraw';
        amount: number;
        phone: string;
        status: 'PENDING' | 'APPROVED' | 'REJECTED';
        accountId?: number | null;
    }

    // 1. Test Deposit Approval does NOT increment withdrawableBalance
    await t.test('Depositing money adds to balance only (withdrawable remains 0)', () => {
        const user: MockUser = {
            id: 1001n,
            firstName: 'Abebe',
            balance: 0,
            bonus: 10,
            withdrawableBalance: 0
        };

        const depositAmount = 250;
        // Approve deposit
        user.balance += depositAmount;
        // withdrawableBalance should NOT increase!
        assert.equal(user.balance, 250);
        assert.equal(user.bonus, 10);
        assert.equal(user.withdrawableBalance, 0, 'Deposited Birr must NOT be withdrawable');
    });

    // 2. Test Deducting Fees: consumes bonus first, then balance; caps withdrawableBalance
    await t.test('Deduct fee consumes bonus first, preserves winnings while balance > winnings', () => {
        const user: MockUser = {
            id: 1002n,
            firstName: 'Chala',
            balance: 150, // 100 deposit + 50 winnings
            bonus: 10,
            withdrawableBalance: 50
        };

        function deductFee(u: MockUser, fee: number) {
            if (u.balance + u.bonus < fee) return false;
            const bonusUsed = Math.min(u.bonus, fee);
            const fromBalance = fee - bonusUsed;

            u.bonus -= bonusUsed;
            u.balance -= fromBalance;
            const currentWithdrawable = u.withdrawableBalance;
            u.withdrawableBalance = Math.max(0, Math.min(u.balance, currentWithdrawable));
            return true;
        }

        // Fee of 10 -> consumed entirely by bonus
        const res1 = deductFee(user, 10);
        assert.equal(res1, true);
        assert.equal(user.bonus, 0);
        assert.equal(user.balance, 150);
        assert.equal(user.withdrawableBalance, 50, 'Winnings intact when paid from bonus');

        // Fee of 20 -> consumed from balance (150 -> 130)
        const res2 = deductFee(user, 20);
        assert.equal(res2, true);
        assert.equal(user.balance, 130);
        assert.equal(user.withdrawableBalance, 50, 'Winnings intact because balance (130) > winnings (50)');

        // Player loses more bets: fee of 100 -> balance becomes 30
        const res3 = deductFee(user, 100);
        assert.equal(res3, true);
        assert.equal(user.balance, 30);
        assert.equal(user.withdrawableBalance, 30, 'Withdrawable capped at remaining balance when balance drops below winnings');
    });

    // 3. Test Game Win Payout: credits both balance and withdrawableBalance
    await t.test('Winning Bingo credits both balance and withdrawableBalance', () => {
        const user: MockUser = {
            id: 1003n,
            firstName: 'Dawit',
            balance: 80,
            bonus: 0,
            withdrawableBalance: 10
        };

        const winPayout = 120;
        user.balance += winPayout;
        user.withdrawableBalance += winPayout;

        assert.equal(user.balance, 200);
        assert.equal(user.withdrawableBalance, 130, 'Winnings directly increase withdrawableBalance');
    });

    // 4. Test Pre-game Board Deselect Refund restores withdrawableBalance
    await t.test('Pre-game board cancellation restores withdrawable balance if consumed', () => {
        const user: MockUser = {
            id: 1004n,
            firstName: 'Eden',
            balance: 20,
            bonus: 0,
            withdrawableBalance: 20
        };

        // Select board for 10 Birr
        const currentWithdrawable = user.withdrawableBalance;
        user.balance -= 10;
        const newWithdrawable = Math.max(0, Math.min(user.balance, currentWithdrawable));
        const withdrawableUsed = currentWithdrawable - newWithdrawable; // 10
        user.withdrawableBalance = newWithdrawable; // 10

        assert.equal(user.balance, 10);
        assert.equal(user.withdrawableBalance, 10);
        assert.equal(withdrawableUsed, 10);

        // Deselect board before game starts (refund)
        user.balance += 10;
        user.withdrawableBalance += withdrawableUsed;

        assert.equal(user.balance, 20);
        assert.equal(user.withdrawableBalance, 20, 'Withdrawable balance restored after board deselect');
    });

    // 5. Test Withdrawal Validation: Only game winnings allowed
    await t.test('Withdrawal request rejects amounts greater than withdrawable winnings', () => {
        const user: MockUser = {
            id: 1005n,
            firstName: 'Fikru',
            balance: 500, // Deposited 450 Birr, won 50 Birr
            bonus: 20,
            withdrawableBalance: 50
        };

        function validateWithdrawal(u: MockUser, amount: number): { valid: boolean; error?: string } {
            if (amount < 10) return { valid: false, error: 'Minimum withdrawal is 10 Birr.' };
            if (amount > u.balance) return { valid: false, error: 'Insufficient balance.' };
            if (amount > u.withdrawableBalance) {
                return {
                    valid: false,
                    error: `You can only withdraw game winnings (${u.withdrawableBalance.toFixed(2)} Birr available). Deposited funds and bonuses must be played in the game.`
                };
            }
            return { valid: true };
        }

        // Attempting to withdraw deposited funds
        const res1 = validateWithdrawal(user, 100);
        assert.equal(res1.valid, false);
        assert.match(res1.error!, /You can only withdraw game winnings \(50\.00 Birr available\)/);

        // Attempting to withdraw bonus
        const res2 = validateWithdrawal(user, 60);
        assert.equal(res2.valid, false);

        // Withdrawing exact winnings
        const res3 = validateWithdrawal(user, 50);
        assert.equal(res3.valid, true);

        // Withdrawing partial winnings
        const res4 = validateWithdrawal(user, 25);
        assert.equal(res4.valid, true);
    });

    // 6. Test Withdrawal Approval decrements both balance and withdrawableBalance
    await t.test('Approving withdrawal decrements both balance and withdrawableBalance', () => {
        const user: MockUser = {
            id: 1006n,
            firstName: 'Girma',
            balance: 300,
            bonus: 0,
            withdrawableBalance: 120
        };

        const withdrawAmount = 100;
        assert.ok(withdrawAmount <= user.withdrawableBalance);

        // Execute approval
        user.balance -= withdrawAmount;
        user.withdrawableBalance -= withdrawAmount;

        assert.equal(user.balance, 200);
        assert.equal(user.withdrawableBalance, 20);
    });

    // 7. Test Routing Separation: Deposits to affiliate admin, Withdrawals to Duty Withdrawal Admin
    await t.test('Routing delivers deposits to affiliate admin and withdrawals exclusively to duty withdrawal admin', () => {
        const affiliateAdminA: MockAdminProfile = {
            id: 1,
            userId: 5001n,
            code: 'adm_admin_a',
            isActive: true,
            isWithdrawalAdmin: false
        };

        const dutyWithdrawalAdminB: MockAdminProfile = {
            id: 2,
            userId: 5002n,
            code: 'adm_admin_b',
            isActive: true,
            isWithdrawalAdmin: true
        };

        const masterAdminId = 999999n;

        function resolveNotificationRecipients(
            type: 'deposit' | 'withdraw',
            assignedAdminId: number | null,
            admins: MockAdminProfile[]
        ): bigint[] {
            const recipients = new Set<bigint>([masterAdminId]);

            if (type === 'withdraw') {
                const duty = admins.find(a => a.isWithdrawalAdmin && a.isActive);
                if (duty) recipients.add(duty.userId);
            } else {
                if (assignedAdminId) {
                    const aff = admins.find(a => a.id === assignedAdminId && a.isActive);
                    if (aff) recipients.add(aff.userId);
                }
            }

            return Array.from(recipients);
        }

        const admins = [affiliateAdminA, dutyWithdrawalAdminB];

        // Case A: Deposit for player assigned to Admin A
        const depositRecipients = resolveNotificationRecipients('deposit', affiliateAdminA.id, admins);
        assert.ok(depositRecipients.includes(affiliateAdminA.userId), 'Affiliate Admin A gets deposit alert');
        assert.ok(!depositRecipients.includes(dutyWithdrawalAdminB.userId), 'Duty withdrawal admin B does NOT get deposit alert');

        // Case B: Withdrawal for player
        const withdrawRecipients = resolveNotificationRecipients('withdraw', affiliateAdminA.id, admins);
        assert.ok(withdrawRecipients.includes(dutyWithdrawalAdminB.userId), 'Duty withdrawal admin B gets withdrawal alert');
        assert.ok(!withdrawRecipients.includes(affiliateAdminA.userId), 'Affiliate Admin A does NOT get withdrawal alert');
    });

    // 8. Test Callback Authorization: Non-duty admin blocked from approving withdrawals
    await t.test('Affiliate admins without withdrawal duty are blocked from approving withdrawals', () => {
        const affiliateAdmin: MockAdminProfile = {
            id: 1,
            userId: 6001n,
            code: 'adm_affiliate',
            isActive: true,
            isWithdrawalAdmin: false
        };

        const dutyAdmin: MockAdminProfile = {
            id: 2,
            userId: 6002n,
            code: 'adm_duty',
            isActive: true,
            isWithdrawalAdmin: true
        };

        const masterAdminId = 999999n;

        function canHandleRequest(
            callerId: bigint,
            requestType: 'deposit' | 'withdraw',
            admins: MockAdminProfile[]
        ): { allowed: boolean; reason?: string } {
            const isMaster = callerId === masterAdminId;
            const profile = admins.find(a => a.userId === callerId && a.isActive);

            if (!isMaster && !profile) {
                return { allowed: false, reason: '⛔ Admin only.' };
            }

            if (requestType === 'withdraw') {
                const isDuty = profile?.isWithdrawalAdmin === true;
                if (!isMaster && !isDuty) {
                    return { allowed: false, reason: '⛔ Only the designated Duty Withdrawal Admin can handle withdrawals.' };
                }
            }

            return { allowed: true };
        }

        const allAdmins = [affiliateAdmin, dutyAdmin];

        // Affiliate admin attempting to approve deposit: allowed
        const depAffRes = canHandleRequest(affiliateAdmin.userId, 'deposit', allAdmins);
        assert.equal(depAffRes.allowed, true);

        // Affiliate admin attempting to approve withdrawal: BLOCKED!
        const wdrAffRes = canHandleRequest(affiliateAdmin.userId, 'withdraw', allAdmins);
        assert.equal(wdrAffRes.allowed, false);
        assert.equal(wdrAffRes.reason, '⛔ Only the designated Duty Withdrawal Admin can handle withdrawals.');

        // Duty admin attempting to approve withdrawal: ALLOWED!
        const wdrDutyRes = canHandleRequest(dutyAdmin.userId, 'withdraw', allAdmins);
        assert.equal(wdrDutyRes.allowed, true);

        // Master admin attempting to approve withdrawal: ALLOWED!
        const wdrMasterRes = canHandleRequest(masterAdminId, 'withdraw', allAdmins);
        assert.equal(wdrMasterRes.allowed, true);
    });

    // 9. Test Reassigning Duty Withdrawal Admin
    await t.test('Assigning new withdrawal admin replaces previous duty assignment', () => {
        const admins: MockAdminProfile[] = [
            { id: 1, userId: 7001n, code: 'adm_1', isActive: true, isWithdrawalAdmin: true },
            { id: 2, userId: 7002n, code: 'adm_2', isActive: true, isWithdrawalAdmin: false },
            { id: 3, userId: 7003n, code: 'adm_3', isActive: true, isWithdrawalAdmin: false }
        ];

        function setDutyAdmin(newAdminId: number | null, adminList: MockAdminProfile[]) {
            for (const a of adminList) a.isWithdrawalAdmin = false;
            if (newAdminId) {
                const target = adminList.find(a => a.id === newAdminId);
                if (target && target.isActive) target.isWithdrawalAdmin = true;
            }
        }

        // Change from admin 1 to admin 2
        setDutyAdmin(2, admins);
        assert.equal(admins[0].isWithdrawalAdmin, false);
        assert.equal(admins[1].isWithdrawalAdmin, true);
        assert.equal(admins[2].isWithdrawalAdmin, false);

        // Reset to Master Admin (clear = true)
        setDutyAdmin(null, admins);
        assert.equal(admins.filter(a => a.isWithdrawalAdmin).length, 0, 'No affiliate admin has duty; routes to Master Admin');
    });

    // 10. Test User Management Serialization includes withdrawableBalance
    await t.test('User management serialization maps withdrawableBalance correctly', () => {
        interface RawDbUser {
            id: bigint;
            username: string | null;
            firstName: string;
            lastName: string | null;
            phone: string | null;
            balance: { toNumber: () => number };
            withdrawableBalance?: { toNumber: () => number } | null;
            bonus: { toNumber: () => number };
            banned: boolean;
            gamesPlayed: number;
            wins: number;
            _count: { referrals: number };
            createdAt: Date;
        }

        const rawUsers: RawDbUser[] = [
            {
                id: 101n,
                username: 'winner_player',
                firstName: 'Dawit',
                lastName: 'Haile',
                phone: '0911223344',
                balance: { toNumber: () => 500 },
                withdrawableBalance: { toNumber: () => 350 },
                bonus: { toNumber: () => 10 },
                banned: false,
                gamesPlayed: 5,
                wins: 2,
                _count: { referrals: 1 },
                createdAt: new Date()
            },
            {
                id: 102n,
                username: 'depositor_only',
                firstName: 'Sara',
                lastName: null,
                phone: null,
                balance: { toNumber: () => 200 },
                withdrawableBalance: null, // No winnings yet
                bonus: { toNumber: () => 0 },
                banned: false,
                gamesPlayed: 0,
                wins: 0,
                _count: { referrals: 0 },
                createdAt: new Date()
            }
        ];

        const serialized = rawUsers.map(u => ({
            id: u.id.toString(),
            username: u.username,
            firstName: u.firstName,
            balance: u.balance.toNumber(),
            withdrawableBalance: u.withdrawableBalance ? u.withdrawableBalance.toNumber() : 0,
            bonus: u.bonus.toNumber()
        }));

        assert.equal(serialized[0].balance, 500);
        assert.equal(serialized[0].withdrawableBalance, 350);
        assert.equal(serialized[1].balance, 200);
        assert.equal(serialized[1].withdrawableBalance, 0, 'Null withdrawableBalance safely defaults to 0');
    });

    // 11. Test Admin User Update for withdrawableBalance
    await t.test('Admin PUT /api/admin/user/:userId updates withdrawableBalance correctly', () => {
        const userState = {
            id: 101n,
            balance: 500,
            bonus: 10,
            withdrawableBalance: 350,
            phone: '0911223344',
            username: 'dawit',
            firstName: 'Dawit',
            banned: false
        };

        function simulateUpdateUser(reqBody: any) {
            const data: any = {};
            if (reqBody.balance !== undefined && !isNaN(Number(reqBody.balance))) data.balance = Number(reqBody.balance);
            if (reqBody.bonus !== undefined && !isNaN(Number(reqBody.bonus))) data.bonus = Number(reqBody.bonus);
            if (reqBody.withdrawableBalance !== undefined && !isNaN(Number(reqBody.withdrawableBalance))) data.withdrawableBalance = Number(reqBody.withdrawableBalance);
            if (reqBody.phone !== undefined) data.phone = reqBody.phone ? String(reqBody.phone).trim() : null;
            if (reqBody.banned !== undefined) data.banned = Boolean(reqBody.banned);

            Object.assign(userState, data);
            return {
                id: userState.id.toString(),
                balance: userState.balance,
                withdrawableBalance: userState.withdrawableBalance,
                bonus: userState.bonus,
                banned: userState.banned
            };
        }

        // Admin adjusts user's withdrawable balance to 450 Birr
        const res1 = simulateUpdateUser({ withdrawableBalance: 450 });
        assert.equal(res1.withdrawableBalance, 450);
        assert.equal(userState.withdrawableBalance, 450);
        assert.equal(userState.balance, 500, 'Regular balance remains untouched');

        // Admin adjusts both balance and withdrawableBalance
        const res2 = simulateUpdateUser({ balance: 600, withdrawableBalance: 600 });
        assert.equal(res2.balance, 600);
        assert.equal(res2.withdrawableBalance, 600);
    });
});
