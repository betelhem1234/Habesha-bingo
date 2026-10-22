import test from 'node:test';
import assert from 'node:assert/strict';

test('Admin Lifecycle, Fair Round-Robin Balancing & Handover Tests', async (t) => {
    interface MockAdminProfile {
        id: number;
        userId: bigint;
        code: string;
        customName?: string | null;
        isActive: boolean;
        assignedUsersCount: number;
        isWithdrawalAdmin?: boolean;
    }

    interface MockPaymentAccount {
        id: number;
        bankName: string;
        accountNumber: string;
        accountName?: string | null;
        isActive: boolean;
        adminId: number | null;
    }

    interface MockUser {
        id: bigint;
        username?: string | null;
        firstName: string;
        assignedAdminId?: number | null;
    }

    interface MockTransactionRequest {
        id: number;
        userId: bigint;
        type: 'deposit' | 'withdraw';
        amount: number;
        status: 'PENDING' | 'APPROVED' | 'REJECTED';
        assignedAdminId: number | null;
    }

    // 1. Fair Round-Robin Balancing logic
    function resolveBalancedAdmin(admins: MockAdminProfile[]): number | null {
        const active = admins.filter(a => a.isActive);
        if (active.length === 0) return null;
        const sorted = [...active].sort((a, b) => {
            if (a.assignedUsersCount !== b.assignedUsersCount) {
                return a.assignedUsersCount - b.assignedUsersCount;
            }
            return a.id - b.id;
        });
        return sorted[0]?.id ?? null;
    }

    // 2. Resilient Bank Account Resolution logic
    function resolveDepositAccounts(
        assignedAdminId: number | null,
        admins: MockAdminProfile[],
        allAccounts: MockPaymentAccount[]
    ): MockPaymentAccount[] {
        let accounts: MockPaymentAccount[] = [];
        if (assignedAdminId) {
            const admin = admins.find(a => a.id === assignedAdminId && a.isActive);
            if (admin) {
                accounts = allAccounts.filter(acc => acc.isActive && acc.adminId === assignedAdminId);
            }
        }
        // Resilient Fallback: If assigned admin has NO active accounts, fall back to Super Admin house accounts (adminId: null)
        if (accounts.length === 0) {
            accounts = allAccounts.filter(acc => acc.isActive && acc.adminId === null);
        }
        // Ultimate fallback
        if (accounts.length === 0) {
            accounts = allAccounts.filter(acc => acc.isActive);
        }
        return accounts;
    }

    // 3. Admin Handover / Replacement execution logic
    function executeAdminHandover(
        sourceAdminId: number,
        targetAdminId: number | null,
        users: MockUser[],
        requests: MockTransactionRequest[],
        accounts: MockPaymentAccount[],
        admins: MockAdminProfile[],
        options: {
            deactivateSourceAdmin?: boolean;
            deactivateSourceBanks?: boolean;
            transferPendingRequests?: boolean;
        } = {}
    ) {
        const {
            deactivateSourceAdmin = true,
            deactivateSourceBanks = true,
            transferPendingRequests = true
        } = options;

        const source = admins.find(a => a.id === sourceAdminId);
        assert.ok(source, 'Source admin must exist');

        let target: MockAdminProfile | undefined;
        if (targetAdminId !== null) {
            target = admins.find(a => a.id === targetAdminId);
            assert.ok(target, 'Target admin must exist if provided');
        }

        // Reassign users
        let reassignedUsers = 0;
        users.forEach(u => {
            if (u.assignedAdminId === sourceAdminId) {
                u.assignedAdminId = targetAdminId;
                reassignedUsers++;
            }
        });

        // Transfer pending requests
        let transferredRequests = 0;
        if (transferPendingRequests) {
            requests.forEach(r => {
                if (r.assignedAdminId === sourceAdminId && r.status === 'PENDING') {
                    r.assignedAdminId = targetAdminId;
                    transferredRequests++;
                }
            });
        }

        // Deactivate bank accounts
        let deactivatedBanks = 0;
        if (deactivateSourceBanks) {
            accounts.forEach(acc => {
                if (acc.adminId === sourceAdminId) {
                    acc.isActive = false;
                    deactivatedBanks++;
                }
            });
        }

        // Update admin profile
        if (deactivateSourceAdmin) {
            source.isActive = false;
        }
        if (source.isWithdrawalAdmin && target) {
            source.isWithdrawalAdmin = false;
            target.isWithdrawalAdmin = true;
        }

        return { reassignedUsers, transferredRequests, deactivatedBanks };
    }

    // 4. Referral / Invite Link with Inactive Admin Safeguard
    function resolveStartInvite(
        code: string,
        admins: MockAdminProfile[]
    ): number | null {
        const clean = code.trim().toLowerCase().replace(/^adm_/, '');
        const matched = admins.find(a => a.code.toLowerCase().replace(/^adm_/, '') === clean);
        if (matched && matched.isActive) {
            return matched.id;
        }
        // If matched but inactive (departed), or no match, fall back to balanced active admin
        return resolveBalancedAdmin(admins);
    }

    await t.test('1. Fair Round-Robin correctly chooses admin with lowest player count', () => {
        const admins: MockAdminProfile[] = [
            { id: 1, userId: 1783441823n, code: 'adm_1', customName: 'Tinshu Bro', isActive: true, assignedUsersCount: 5 },
            { id: 2, userId: 8684362724n, code: 'adm_2', customName: 'Tilku Bro', isActive: true, assignedUsersCount: 0 }
        ];

        // Admin 2 has 0 players vs Admin 1 has 5 -> Must choose Admin 2!
        assert.equal(resolveBalancedAdmin(admins), 2, 'Must balance organic traffic to Admin 2');

        // Increment Admin 2 to 5 players -> Both equal -> Break tie by lowest id (Admin 1)
        admins[1].assignedUsersCount = 5;
        assert.equal(resolveBalancedAdmin(admins), 1, 'When equal, tie break by lowest ID');

        // Admin 1 now has 6 players -> Next organic player goes to Admin 2
        admins[0].assignedUsersCount = 6;
        assert.equal(resolveBalancedAdmin(admins), 2, 'Next goes to Admin 2');
    });

    await t.test('2. Round-Robin ignores inactive admins', () => {
        const admins: MockAdminProfile[] = [
            { id: 1, userId: 1783441823n, code: 'adm_1', isActive: false, assignedUsersCount: 0 },
            { id: 2, userId: 8684362724n, code: 'adm_2', isActive: true, assignedUsersCount: 10 }
        ];

        assert.equal(resolveBalancedAdmin(admins), 2, 'Inactive admin with 0 players is ignored');
    });

    await t.test('3. Resilient bank fallback gives platform house accounts when admin has no active banks', () => {
        const admins: MockAdminProfile[] = [
            { id: 1, userId: 1783441823n, code: 'adm_1', isActive: true, assignedUsersCount: 5 },
            { id: 2, userId: 8684362724n, code: 'adm_2', isActive: true, assignedUsersCount: 2 }
        ];

        const accounts: MockPaymentAccount[] = [
            // Admin 1's account is inactive
            { id: 4, bankName: 'Telebirr', accountNumber: '0974756860', isActive: false, adminId: 1 },
            // Admin 2's account is active
            { id: 5, bankName: 'Telebirr', accountNumber: '0905397485', isActive: true, adminId: 2 },
            // Platform house accounts
            { id: 1, bankName: 'Telebirr', accountNumber: '0923526309', isActive: true, adminId: null },
            { id: 2, bankName: 'CBE', accountNumber: '1000123456', isActive: true, adminId: null }
        ];

        // Player assigned to Admin 1 (whose personal bank is inactive)
        const acctsForUser1 = resolveDepositAccounts(1, admins, accounts);
        assert.equal(acctsForUser1.length, 2, 'Must gracefully fall back to 2 platform house accounts');
        assert.equal(acctsForUser1[0].accountNumber, '0923526309');

        // Player assigned to Admin 2 (whose personal bank is active)
        const acctsForUser2 = resolveDepositAccounts(2, admins, accounts);
        assert.equal(acctsForUser2.length, 1);
        assert.equal(acctsForUser2[0].accountNumber, '0905397485');
    });

    await t.test('4. Admin Handover atomically reassigns players, pending requests, and closes banks', () => {
        const admins: MockAdminProfile[] = [
            { id: 1, userId: 1783441823n, code: 'adm_1', customName: 'Tinshu Bro', isActive: true, assignedUsersCount: 5, isWithdrawalAdmin: true },
            { id: 2, userId: 8684362724n, code: 'adm_2', customName: 'Tilku Bro', isActive: true, assignedUsersCount: 0, isWithdrawalAdmin: false }
        ];

        const users: MockUser[] = [
            { id: 101n, firstName: 'User A', assignedAdminId: 1 },
            { id: 102n, firstName: 'User B', assignedAdminId: 1 },
            { id: 103n, firstName: 'User C', assignedAdminId: 1 },
            { id: 104n, firstName: 'User D', assignedAdminId: 1 },
            { id: 105n, firstName: 'User E', assignedAdminId: 1 }
        ];

        const requests: MockTransactionRequest[] = [
            { id: 1, userId: 101n, type: 'deposit', amount: 50, status: 'PENDING', assignedAdminId: 1 },
            { id: 2, userId: 102n, type: 'deposit', amount: 100, status: 'APPROVED', assignedAdminId: 1 },
            { id: 3, userId: 103n, type: 'withdraw', amount: 200, status: 'PENDING', assignedAdminId: 1 }
        ];

        const accounts: MockPaymentAccount[] = [
            { id: 4, bankName: 'Telebirr', accountNumber: '0974756860', isActive: true, adminId: 1 },
            { id: 5, bankName: 'Telebirr', accountNumber: '0905397485', isActive: true, adminId: 2 }
        ];

        // Execute Handover from Admin 1 to Admin 2
        const result = executeAdminHandover(1, 2, users, requests, accounts, admins);

        assert.equal(result.reassignedUsers, 5, 'All 5 users transferred');
        assert.equal(result.transferredRequests, 2, 'Only 2 PENDING requests transferred (APPROVED untouched)');
        assert.equal(result.deactivatedBanks, 1, 'Admin 1 bank account deactivated');

        // Check user assignments
        users.forEach(u => assert.equal(u.assignedAdminId, 2, 'User now belongs to Admin 2'));

        // Check pending requests
        assert.equal(requests[0].assignedAdminId, 2, 'Pending request reassigned to Admin 2');
        assert.equal(requests[1].assignedAdminId, 1, 'Historical approved request stays with Admin 1');
        assert.equal(requests[2].assignedAdminId, 2, 'Pending withdraw reassigned to Admin 2');

        // Check bank accounts
        assert.equal(accounts[0].isActive, false, 'Admin 1 bank is now inactive to prevent wrong transfers');
        assert.equal(accounts[1].isActive, true, 'Admin 2 bank remains active');

        // Check Admin states
        assert.equal(admins[0].isActive, false, 'Source admin is marked inactive');
        assert.equal(admins[0].isWithdrawalAdmin, false, 'Duty transferred from source');
        assert.equal(admins[1].isWithdrawalAdmin, true, 'Target admin receives withdrawal duty');
    });

    await t.test('5. Departed admin invite code redirects to active balanced admin', () => {
        const admins: MockAdminProfile[] = [
            { id: 1, userId: 1783441823n, code: 'adm_tinshu', isActive: false, assignedUsersCount: 0 },
            { id: 2, userId: 8684362724n, code: 'adm_tilku', isActive: true, assignedUsersCount: 3 }
        ];

        // Someone clicks old promotional link "start=adm_tinshu"
        const assigned = resolveStartInvite('adm_tinshu', admins);
        assert.equal(assigned, 2, 'Seamlessly redirects traffic from departed admin to active Admin 2');
    });
});
