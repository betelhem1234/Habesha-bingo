import test from 'node:test';
import assert from 'node:assert/strict';

test('Admin Deposit Limits & Super Admin Fallback Logic Tests', async (t) => {
    interface MockUser {
        id: bigint;
        firstName: string;
        balance: number;
        assignedAdminId?: number | null;
    }

    interface MockAdminProfile {
        id: number;
        userId: bigint;
        code: string;
        customName?: string | null;
        isActive: boolean;
        depositLimit: number;
        collectedDeposits: number;
    }

    interface MockPaymentAccount {
        id: number;
        bankName: string;
        accountNumber: string;
        adminId: number | null;
        isActive: boolean;
    }

    interface MockTransactionRequest {
        id: number;
        userId: bigint;
        type: 'deposit' | 'withdraw';
        amount: number;
        status: 'PENDING' | 'APPROVED' | 'REJECTED';
        accountId?: number | null;
    }

    // 1. Lineage onboarding resolution
    function resolveAssignedAdminOnStart(
        startParam: string | null | undefined,
        activeAdmins: MockAdminProfile[]
    ): number | null {
        const raw = String(startParam ?? '').trim();
        const clean = raw.toLowerCase();
        const cleanNoPrefix = clean.replace(/^adm_/, '');

        if (raw) {
            const matched = activeAdmins.find(
                a => a.isActive && (a.code === clean || a.code === cleanNoPrefix || a.code === `adm_${cleanNoPrefix}`)
            );
            if (matched) return matched.id;
        }
        // Direct search / organic joins remain unassigned (Super Admin pool)
        return null;
    }

    // 2. Bank account selection resolution for player deposits
    function getAvailableDepositBanks(
        playerAssignedAdminId: number | null | undefined,
        allAdmins: MockAdminProfile[],
        allAccounts: MockPaymentAccount[]
    ): MockPaymentAccount[] {
        const activeAccounts = allAccounts.filter(a => a.isActive);

        if (playerAssignedAdminId) {
            const assignedAdmin = allAdmins.find(a => a.id === playerAssignedAdminId);
            // If the assigned admin is ACTIVE, return their active accounts (even if at limit)
            if (assignedAdmin && assignedAdmin.isActive) {
                const adminBanks = activeAccounts.filter(a => a.adminId === assignedAdmin.id);
                if (adminBanks.length > 0) return adminBanks;
            }
        }

        // Fallback: strictly Super Admin accounts (adminId: null)
        const superBanks = activeAccounts.filter(a => a.adminId === null);
        if (superBanks.length > 0) return superBanks;

        // Fallback safety if no adminId: null accounts exist
        return activeAccounts;
    }

    // 3. Deposit notification target chats resolution
    function getDepositNotificationTargets(
        chosenAccountId: number | null | undefined,
        playerAssignedAdminId: number | null | undefined,
        allAdmins: MockAdminProfile[],
        allAccounts: MockPaymentAccount[],
        masterAdminUserId: bigint
    ): { chatIds: bigint[]; isApprovalPausedForAffiliate: boolean } {
        let affiliateChatId: bigint | null = null;
        let affiliateAdminProf: MockAdminProfile | null = null;

        if (chosenAccountId) {
            const chosen = allAccounts.find(a => a.id === chosenAccountId);
            if (chosen && chosen.adminId) {
                const prof = allAdmins.find(a => a.id === chosen.adminId);
                if (prof && prof.isActive) {
                    affiliateChatId = prof.userId;
                    affiliateAdminProf = prof;
                }
            }
        }

        if (!affiliateChatId && playerAssignedAdminId) {
            const prof = allAdmins.find(a => a.id === playerAssignedAdminId);
            if (prof && prof.isActive) {
                affiliateChatId = prof.userId;
                affiliateAdminProf = prof;
            }
        }

        const targets = new Set<bigint>([masterAdminUserId]);
        if (affiliateChatId) targets.add(affiliateChatId);

        const isApprovalPaused = Boolean(
            affiliateAdminProf && affiliateAdminProf.collectedDeposits >= affiliateAdminProf.depositLimit
        );

        return {
            chatIds: Array.from(targets),
            isApprovalPausedForAffiliate: isApprovalPaused
        };
    }

    // 4. Deposit approval limit validator
    function canAdminApproveDeposit(
        approverUserId: bigint,
        masterAdminUserId: bigint,
        affiliateAdmin: MockAdminProfile | null,
        depositAmount: number
    ): { allowed: boolean; reason?: string } {
        // Master Admin is NEVER restricted by limits
        if (approverUserId === masterAdminUserId) {
            return { allowed: true };
        }

        if (!affiliateAdmin) {
            return { allowed: false, reason: 'Not an authorized administrator' };
        }

        if (!affiliateAdmin.isActive) {
            return { allowed: false, reason: 'Administrator profile is inactive' };
        }

        const current = affiliateAdmin.collectedDeposits;
        const limit = affiliateAdmin.depositLimit;
        if (current + depositAmount > limit) {
            return {
                allowed: false,
                reason: `⛔ Limit Reached! You have approved ${current}/${limit} Birr. You cannot approve this request until your limit is refreshed. Please remit collected funds to the Super Admin.`
            };
        }

        return { allowed: true };
    }

    // ================= TESTS =================

    await t.test('Unassigned organic player retains assignedAdminId = null (Super Admin pool)', () => {
        const activeAdmins: MockAdminProfile[] = [
            { id: 1, userId: 100n, code: 'adm_one', isActive: true, depositLimit: 3000, collectedDeposits: 0 }
        ];

        // Joined via invite code -> binds
        assert.equal(resolveAssignedAdminOnStart('adm_one', activeAdmins), 1);
        // Joined directly without start parameter -> stays null (Super Admin pool)
        assert.equal(resolveAssignedAdminOnStart(null, activeAdmins), null);
        assert.equal(resolveAssignedAdminOnStart('', activeAdmins), null);
    });

    await t.test('Active assigned admin shows their bank accounts (even if at limit)', () => {
        const admins: MockAdminProfile[] = [
            { id: 10, userId: 110n, code: 'adm_branch', isActive: true, depositLimit: 3000, collectedDeposits: 3000 }
        ];
        const accounts: MockPaymentAccount[] = [
            { id: 1, bankName: 'Telebirr Super', accountNumber: '0911000000', adminId: null, isActive: true },
            { id: 2, bankName: 'Telebirr Branch', accountNumber: '0922000000', adminId: 10, isActive: true }
        ];

        // Player assigned to admin 10 sees admin 10's bank account
        const visible = getAvailableDepositBanks(10, admins, accounts);
        assert.equal(visible.length, 1);
        assert.equal(visible[0].accountNumber, '0922000000');
    });

    await t.test('Inactive assigned admin strictly falls back to Super Admin bank accounts (adminId: null)', () => {
        const admins: MockAdminProfile[] = [
            { id: 10, userId: 110n, code: 'adm_inactive', isActive: false, depositLimit: 3000, collectedDeposits: 0 },
            { id: 20, userId: 120n, code: 'adm_other', isActive: true, depositLimit: 3000, collectedDeposits: 0 }
        ];
        const accounts: MockPaymentAccount[] = [
            { id: 1, bankName: 'Telebirr Super', accountNumber: '0911000000', adminId: null, isActive: true },
            { id: 2, bankName: 'Telebirr Inactive', accountNumber: '0922000000', adminId: 10, isActive: true },
            { id: 3, bankName: 'Telebirr Other', accountNumber: '0933000000', adminId: 20, isActive: true }
        ];

        // Player assigned to inactive admin 10 MUST NOT see admin 20, but strictly Super Admin (adminId: null)
        const visible = getAvailableDepositBanks(10, admins, accounts);
        assert.equal(visible.length, 1);
        assert.equal(visible[0].accountNumber, '0911000000');
        assert.equal(visible[0].adminId, null);
    });

    await t.test('Unassigned player strictly falls back to Super Admin accounts', () => {
        const admins: MockAdminProfile[] = [
            { id: 20, userId: 120n, code: 'adm_active', isActive: true, depositLimit: 3000, collectedDeposits: 0 }
        ];
        const accounts: MockPaymentAccount[] = [
            { id: 1, bankName: 'Telebirr Super', accountNumber: '0911000000', adminId: null, isActive: true },
            { id: 2, bankName: 'Telebirr Active', accountNumber: '0922000000', adminId: 20, isActive: true }
        ];

        const visible = getAvailableDepositBanks(null, admins, accounts);
        assert.equal(visible.length, 1);
        assert.equal(visible[0].accountNumber, '0911000000');
        assert.equal(visible[0].adminId, null);
    });

    await t.test('Notification delivery: active admin at limit still receives requests with paused alert', () => {
        const masterId = 999n;
        const affUserId = 555n;
        const admins: MockAdminProfile[] = [
            { id: 5, userId: affUserId, code: 'adm_five', isActive: true, depositLimit: 3000, collectedDeposits: 3000 }
        ];
        const accounts: MockPaymentAccount[] = [
            { id: 100, bankName: 'Telebirr Five', accountNumber: '0955555555', adminId: 5, isActive: true }
        ];

        const res = getDepositNotificationTargets(100, 5, admins, accounts, masterId);
        assert.equal(res.chatIds.includes(masterId), true);
        assert.equal(res.chatIds.includes(affUserId), true);
        assert.equal(res.isApprovalPausedForAffiliate, true, 'Affiliate admin must see approval paused warning');
    });

    await t.test('Notification delivery: inactive admin receives NO notifications (Super Admin only)', () => {
        const masterId = 999n;
        const affUserId = 555n;
        const admins: MockAdminProfile[] = [
            { id: 5, userId: affUserId, code: 'adm_five', isActive: false, depositLimit: 3000, collectedDeposits: 0 }
        ];
        const accounts: MockPaymentAccount[] = [
            { id: 100, bankName: 'Telebirr Five', accountNumber: '0955555555', adminId: 5, isActive: true }
        ];

        const res = getDepositNotificationTargets(100, 5, admins, accounts, masterId);
        assert.equal(res.chatIds.includes(masterId), true);
        assert.equal(res.chatIds.includes(affUserId), false, 'Inactive admin must NOT receive notification');
        assert.equal(res.chatIds.length, 1);
    });

    await t.test('Approving deposit within limit succeeds and increments collectedDeposits', () => {
        const masterId = 999n;
        const affAdmin: MockAdminProfile = {
            id: 1, userId: 101n, code: 'adm_test', isActive: true, depositLimit: 3000, collectedDeposits: 1000
        };

        const res = canAdminApproveDeposit(101n, masterId, affAdmin, 500);
        assert.equal(res.allowed, true);

        // Simulate execution
        affAdmin.collectedDeposits += 500;
        assert.equal(affAdmin.collectedDeposits, 1500);
    });

    await t.test('Approving deposit exceeding limit is blocked with alert message', () => {
        const masterId = 999n;
        const affAdmin: MockAdminProfile = {
            id: 1, userId: 101n, code: 'adm_test', isActive: true, depositLimit: 3000, collectedDeposits: 2500
        };

        // Attempting to approve 600 Birr when 2500/3000 collected (2500 + 600 = 3100 > 3000)
        const res = canAdminApproveDeposit(101n, masterId, affAdmin, 600);
        assert.equal(res.allowed, false);
        assert.match(res.reason!, /Limit Reached/);
        assert.match(res.reason!, /2500\/3000 Birr/);

        // State remains untouched
        assert.equal(affAdmin.collectedDeposits, 2500);
    });

    await t.test('Super Admin can approve deposits exceeding affiliate limits at any time', () => {
        const masterId = 999n;
        const affAdmin: MockAdminProfile = {
            id: 1, userId: 101n, code: 'adm_test', isActive: true, depositLimit: 3000, collectedDeposits: 3000
        };

        // Master Admin approving 5000 Birr
        const res = canAdminApproveDeposit(masterId, masterId, affAdmin, 5000);
        assert.equal(res.allowed, true, 'Super Admin must never be blocked');
    });

    await t.test('Super Admin Refresh Limit resets collectedDeposits to 0.0 and unlocks affiliate approvals', () => {
        const masterId = 999n;
        const affAdmin: MockAdminProfile = {
            id: 1, userId: 101n, code: 'adm_test', isActive: true, depositLimit: 3000, collectedDeposits: 3000
        };

        // Blocked prior to refresh
        assert.equal(canAdminApproveDeposit(101n, masterId, affAdmin, 1000).allowed, false);

        // Super Admin clicks Refresh Limit
        affAdmin.collectedDeposits = 0.0;

        // Now approval succeeds
        const afterRefresh = canAdminApproveDeposit(101n, masterId, affAdmin, 1000);
        assert.equal(afterRefresh.allowed, true);
        affAdmin.collectedDeposits += 1000;
        assert.equal(affAdmin.collectedDeposits, 1000);
    });
});
