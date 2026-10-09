import test from 'node:test';
import assert from 'node:assert/strict';

test('Admin Affiliate Lineage & Multi-Bank Routing System Tests', async (t) => {
    // Simulated models
    interface MockAdminProfile {
        id: number;
        userId: bigint;
        code: string;
        customName?: string | null;
        isActive: boolean;
        assignedCount: number;
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
        referredById?: bigint | null;
    }

    // Helper: simulate bot start lineage resolution
    function resolveLineageOnStart(
        startParam: string | null | undefined,
        inviterUser: MockUser | null,
        activeAdmins: MockAdminProfile[]
    ): { assignedAdminId: number | null; refId: bigint | null } {
        const raw = String(startParam ?? '').trim();
        const clean = raw.toLowerCase();
        const cleanNoPrefix = clean.replace(/^adm_/, '');

        let assignedAdminId: number | null = null;
        let refId: bigint | null = null;

        // 1. Check if matches admin code
        if (raw) {
            const matchedAdmin = activeAdmins.find(
                a => a.isActive && (a.code === clean || a.code === cleanNoPrefix || a.code === `adm_${cleanNoPrefix}`)
            );
            if (matchedAdmin) {
                assignedAdminId = matchedAdmin.id;
            }
        }

        // 2. Check if player referral
        const refParam = raw.replace(/^ref_?/, '');
        if (/^\d+$/.test(refParam)) {
            refId = BigInt(refParam);
            if (!assignedAdminId && inviterUser?.assignedAdminId) {
                assignedAdminId = inviterUser.assignedAdminId;
            }
        }

        // 3. Fallback: organic auto-balance
        if (!assignedAdminId && activeAdmins.length > 0) {
            const sorted = [...activeAdmins.filter(a => a.isActive)].sort((a, b) => a.assignedCount - b.assignedCount);
            if (sorted.length > 0) {
                assignedAdminId = sorted[0].id;
            }
        }

        return { assignedAdminId, refId };
    }

    // Helper: simulate deposit accounts filter
    function filterDepositAccounts(
        playerAssignedAdminId: number | null,
        allAccounts: MockPaymentAccount[]
    ): MockPaymentAccount[] {
        const active = allAccounts.filter(a => a.isActive);
        if (playerAssignedAdminId) {
            const adminAccounts = active.filter(a => a.adminId === playerAssignedAdminId);
            if (adminAccounts.length > 0) return adminAccounts;
        }
        // Fallback to active pool accounts
        return active;
    }

    // Helper: simulate 1-click callback auth
    function isAuthorizedForApproval(
        callerTelegramId: bigint,
        masterAdminId: string,
        activeAdmins: MockAdminProfile[]
    ): boolean {
        if (callerTelegramId.toString() === masterAdminId) return true;
        const affiliate = activeAdmins.find(a => a.userId === callerTelegramId && a.isActive);
        return Boolean(affiliate);
    }

    await t.test('affiliate link parsing correctly binds to specific admin code (adm_abebe, adm_1)', () => {
        const admins: MockAdminProfile[] = [
            { id: 1, userId: 1001n, code: 'adm_abebe', isActive: true, assignedCount: 10 },
            { id: 2, userId: 1002n, code: 'adm_1', isActive: true, assignedCount: 5 },
            { id: 3, userId: 1003n, code: 'branch_addis', isActive: true, assignedCount: 2 }
        ];

        // Matching adm_abebe (case-insensitive and with/without adm_ prefix)
        assert.equal(resolveLineageOnStart('adm_abebe', null, admins).assignedAdminId, 1);
        assert.equal(resolveLineageOnStart('ADM_ABEBE', null, admins).assignedAdminId, 1);
        assert.equal(resolveLineageOnStart('abebe', null, admins).assignedAdminId, 1);

        // Matching adm_1
        assert.equal(resolveLineageOnStart('adm_1', null, admins).assignedAdminId, 2);
        assert.equal(resolveLineageOnStart('1', null, admins).assignedAdminId, 2);

        // Matching custom code
        assert.equal(resolveLineageOnStart('branch_addis', null, admins).assignedAdminId, 3);
        assert.equal(resolveLineageOnStart('adm_branch_addis', null, admins).assignedAdminId, 3);
    });

    await t.test('downline player referral inherits inviter assigned admin', () => {
        const admins: MockAdminProfile[] = [
            { id: 10, userId: 5555n, code: 'adm_leader', isActive: true, assignedCount: 100 }
        ];

        const playerA: MockUser = {
            id: 2001n,
            firstName: 'Player A',
            assignedAdminId: 10
        };

        // Player B joins via Player A's referral link (ref_2001)
        const result = resolveLineageOnStart('ref_2001', playerA, admins);
        assert.equal(result.refId, 2001n);
        assert.equal(result.assignedAdminId, 10, 'Player B must inherit Player A assigned admin ID');
    });

    await t.test('direct organic search auto-balances to active admin with lowest downline count', () => {
        const admins: MockAdminProfile[] = [
            { id: 1, userId: 101n, code: 'adm_high', isActive: true, assignedCount: 50 },
            { id: 2, userId: 102n, code: 'adm_low', isActive: true, assignedCount: 2 },
            { id: 3, userId: 103n, code: 'adm_medium', isActive: true, assignedCount: 15 }
        ];

        // Joining with no start parameters
        const result = resolveLineageOnStart('', null, admins);
        assert.equal(result.assignedAdminId, 2, 'Should balance to admin #2 who has the fewest downlines (2)');
        assert.equal(result.refId, null);
    });

    await t.test('deposit page displays only the assigned admin multi-bank accounts', () => {
        const accounts: MockPaymentAccount[] = [
            { id: 1, bankName: 'Telebirr', accountNumber: '0911000001', isActive: true, adminId: 1 },
            { id: 2, bankName: 'CBE', accountNumber: '100011111111', isActive: true, adminId: 1 },
            { id: 3, bankName: 'Awash', accountNumber: '013200000000', isActive: true, adminId: 2 },
            { id: 4, bankName: 'Telebirr', accountNumber: '0922000002', isActive: true, adminId: 2 }
        ];

        // Player assigned to Admin #1 (Abebe)
        const admin1Banks = filterDepositAccounts(1, accounts);
        assert.equal(admin1Banks.length, 2);
        assert.deepEqual(admin1Banks.map(b => b.id), [1, 2], 'Admin 1 players see Telebirr & CBE belonging to Admin 1');

        // Player assigned to Admin #2
        const admin2Banks = filterDepositAccounts(2, accounts);
        assert.equal(admin2Banks.length, 2);
        assert.deepEqual(admin2Banks.map(b => b.id), [3, 4], 'Admin 2 players see Awash & Telebirr belonging to Admin 2');
    });

    await t.test('fallback ensures deposits are never blocked if assigned admin has no accounts configured', () => {
        const accounts: MockPaymentAccount[] = [
            { id: 1, bankName: 'Telebirr', accountNumber: '0900000000', isActive: true, adminId: null },
            { id: 2, bankName: 'CBE', accountNumber: '1000000000', isActive: true, adminId: null }
        ];

        // Admin #3 has no accounts assigned yet
        const banksForAdmin3 = filterDepositAccounts(3, accounts);
        assert.equal(banksForAdmin3.length, 2, 'Must fallback to general pool accounts so player is not blocked');
    });

    await t.test('telegram 1-click button authorization allows assigned admin and master admin, blocks unauthorized users', () => {
        const masterAdminId = '999999999';
        const admins: MockAdminProfile[] = [
            { id: 1, userId: 1783441823n, code: 'adm_abebe', isActive: true, assignedCount: 12 },
            { id: 2, userId: 2847592812n, code: 'adm_inactive', isActive: false, assignedCount: 0 }
        ];

        // 1. Master admin click
        assert.equal(isAuthorizedForApproval(999999999n, masterAdminId, admins), true, 'Master admin is authorized');

        // 2. Active affiliate admin Abebe
        assert.equal(isAuthorizedForApproval(1783441823n, masterAdminId, admins), true, 'Promoted affiliate admin is authorized');

        // 3. Inactive admin
        assert.equal(isAuthorizedForApproval(2847592812n, masterAdminId, admins), false, 'Inactive affiliate admin must be rejected');

        // 4. Regular player
        assert.equal(isAuthorizedForApproval(1234567890n, masterAdminId, admins), false, 'Regular player must be rejected with ⛔ Admin only');
    });
});
