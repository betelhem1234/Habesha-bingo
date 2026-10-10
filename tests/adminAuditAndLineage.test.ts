import test from 'node:test';
import assert from 'node:assert/strict';

test('Admin Request Lineage Attribution & Audit Stats Logic Tests', async (t) => {
    interface MockAdminProfile {
        id: number;
        userId: bigint;
        code: string;
        customName?: string | null;
        isActive: boolean;
        isWithdrawalAdmin: boolean;
        depositLimit: number;
        collectedDeposits: number;
        username?: string | null;
    }

    interface MockPaymentAccount {
        id: number;
        bankName: string;
        accountNumber: string;
        adminId: number | null;
        isActive: boolean;
    }

    interface MockUser {
        id: bigint;
        firstName: string;
        balance: number;
        withdrawableBalance: number;
        assignedAdminId?: number | null;
    }

    interface MockTransactionRequest {
        id: number;
        userId: bigint;
        type: 'deposit' | 'withdraw';
        amount: number;
        status: 'PENDING' | 'APPROVED' | 'REJECTED';
        accountId?: number | null;
        bankName?: string | null;
        assignedAdminId: number | null;
        processedByAdminId: number | null;
        processedByName: string | null;
        actionAt: Date | null;
        createdAt: Date;
    }

    // 1. Lineage assignment for Deposit requests
    function resolveDepositAssignedAdmin(
        accountId: number | null,
        userId: bigint,
        accounts: MockPaymentAccount[],
        users: MockUser[],
        admins: MockAdminProfile[]
    ): number | null {
        if (accountId) {
            const acct = accounts.find(a => a.id === accountId && a.isActive);
            if (acct?.adminId) {
                const adm = admins.find(a => a.id === acct.adminId && a.isActive);
                if (adm) return adm.id;
            }
        }
        const user = users.find(u => u.id === userId);
        if (user?.assignedAdminId) {
            const adm = admins.find(a => a.id === user.assignedAdminId && a.isActive);
            if (adm) return adm.id;
        }
        return null; // Fallback to Super Admin
    }

    // 2. Lineage assignment for Withdrawal requests
    function resolveWithdrawalAssignedAdmin(
        admins: MockAdminProfile[]
    ): number | null {
        const dutyAdmin = admins.find(a => a.isWithdrawalAdmin && a.isActive);
        return dutyAdmin ? dutyAdmin.id : null; // Fallback to Super Admin
    }

    // 3. Approval action attribution
    function applyApprovalAttribution(
        req: MockTransactionRequest,
        isMasterAdmin: boolean,
        adminProf: MockAdminProfile | null,
        now: Date = new Date()
    ): MockTransactionRequest {
        const actorName = isMasterAdmin
            ? 'Super Admin'
            : (adminProf ? (adminProf.customName || adminProf.code) : 'Admin');
        const actorAdminId = isMasterAdmin ? null : (adminProf ? adminProf.id : null);

        return {
            ...req,
            status: 'APPROVED',
            processedByName: actorName,
            processedByAdminId: actorAdminId,
            actionAt: now
        };
    }

    // 4. Rejection action attribution
    function applyRejectionAttribution(
        req: MockTransactionRequest,
        isMasterAdmin: boolean,
        adminProf: MockAdminProfile | null,
        now: Date = new Date()
    ): MockTransactionRequest {
        const actorName = isMasterAdmin
            ? 'Super Admin'
            : (adminProf ? (adminProf.customName || adminProf.code) : 'Admin');
        const actorAdminId = isMasterAdmin ? null : (adminProf ? adminProf.id : null);

        return {
            ...req,
            status: 'REJECTED',
            processedByName: actorName,
            processedByAdminId: actorAdminId,
            actionAt: now
        };
    }

    // 5. Aggregate audit stats generator
    function calculateAdminAuditStats(
        requests: MockTransactionRequest[],
        admins: MockAdminProfile[],
        superAdminId: string
    ) {
        function createEmptyMetrics() {
            return {
                depositsApprovedCount: 0,
                depositsApprovedAmount: 0,
                depositsPendingCount: 0,
                depositsPendingAmount: 0,
                depositsRejectedCount: 0,
                depositsRejectedAmount: 0,
                withdrawalsApprovedCount: 0,
                withdrawalsApprovedAmount: 0,
                withdrawalsPendingCount: 0,
                withdrawalsPendingAmount: 0,
                withdrawalsRejectedCount: 0,
                withdrawalsRejectedAmount: 0,
                totalSettledVolume: 0
            };
        }

        const superAdminMetrics = createEmptyMetrics();
        const adminMetricsMap = new Map<number, ReturnType<typeof createEmptyMetrics>>();
        for (const a of admins) {
            adminMetricsMap.set(a.id, createEmptyMetrics());
        }

        for (const r of requests) {
            const amt = r.amount;
            const isDeposit = r.type === 'deposit';

            if (r.status === 'PENDING') {
                const targetMetrics = (r.assignedAdminId && adminMetricsMap.has(r.assignedAdminId))
                    ? adminMetricsMap.get(r.assignedAdminId)!
                    : superAdminMetrics;

                if (isDeposit) {
                    targetMetrics.depositsPendingCount++;
                    targetMetrics.depositsPendingAmount += amt;
                } else {
                    targetMetrics.withdrawalsPendingCount++;
                    targetMetrics.withdrawalsPendingAmount += amt;
                }
            } else if (r.status === 'APPROVED') {
                const targetMetrics = (r.processedByAdminId && adminMetricsMap.has(r.processedByAdminId))
                    ? adminMetricsMap.get(r.processedByAdminId)!
                    : superAdminMetrics;

                if (isDeposit) {
                    targetMetrics.depositsApprovedCount++;
                    targetMetrics.depositsApprovedAmount += amt;
                    targetMetrics.totalSettledVolume += amt;
                } else {
                    targetMetrics.withdrawalsApprovedCount++;
                    targetMetrics.withdrawalsApprovedAmount += amt;
                    targetMetrics.totalSettledVolume += amt;
                }
            } else if (r.status === 'REJECTED') {
                const processorId = r.processedByAdminId ?? r.assignedAdminId;
                const targetMetrics = (processorId && adminMetricsMap.has(processorId))
                    ? adminMetricsMap.get(processorId)!
                    : superAdminMetrics;

                if (isDeposit) {
                    targetMetrics.depositsRejectedCount++;
                    targetMetrics.depositsRejectedAmount += amt;
                } else {
                    targetMetrics.withdrawalsRejectedCount++;
                    targetMetrics.withdrawalsRejectedAmount += amt;
                }
            }
        }

        const superAdminRow = {
            id: null,
            isSuperAdmin: true,
            displayName: '👑 Super Admin',
            code: 'master',
            userId: superAdminId,
            metrics: superAdminMetrics
        };

        const affiliateRows = admins.map(a => ({
            id: a.id,
            isSuperAdmin: false,
            displayName: a.customName || a.code,
            code: a.code,
            userId: a.userId.toString(),
            metrics: adminMetricsMap.get(a.id) || createEmptyMetrics()
        }));

        const totals = {
            depositsApprovedCount: superAdminMetrics.depositsApprovedCount + affiliateRows.reduce((s, a) => s + a.metrics.depositsApprovedCount, 0),
            depositsApprovedAmount: superAdminMetrics.depositsApprovedAmount + affiliateRows.reduce((s, a) => s + a.metrics.depositsApprovedAmount, 0),
            depositsPendingCount: superAdminMetrics.depositsPendingCount + affiliateRows.reduce((s, a) => s + a.metrics.depositsPendingCount, 0),
            depositsPendingAmount: superAdminMetrics.depositsPendingAmount + affiliateRows.reduce((s, a) => s + a.metrics.depositsPendingAmount, 0),
            depositsRejectedCount: superAdminMetrics.depositsRejectedCount + affiliateRows.reduce((s, a) => s + a.metrics.depositsRejectedCount, 0),
            depositsRejectedAmount: superAdminMetrics.depositsRejectedAmount + affiliateRows.reduce((s, a) => s + a.metrics.depositsRejectedAmount, 0),

            withdrawalsApprovedCount: superAdminMetrics.withdrawalsApprovedCount + affiliateRows.reduce((s, a) => s + a.metrics.withdrawalsApprovedCount, 0),
            withdrawalsApprovedAmount: superAdminMetrics.withdrawalsApprovedAmount + affiliateRows.reduce((s, a) => s + a.metrics.withdrawalsApprovedAmount, 0),
            withdrawalsPendingCount: superAdminMetrics.withdrawalsPendingCount + affiliateRows.reduce((s, a) => s + a.metrics.withdrawalsPendingCount, 0),
            withdrawalsPendingAmount: superAdminMetrics.withdrawalsPendingAmount + affiliateRows.reduce((s, a) => s + a.metrics.withdrawalsPendingAmount, 0),
            withdrawalsRejectedCount: superAdminMetrics.withdrawalsRejectedCount + affiliateRows.reduce((s, a) => s + a.metrics.withdrawalsRejectedCount, 0),
            withdrawalsRejectedAmount: superAdminMetrics.withdrawalsRejectedAmount + affiliateRows.reduce((s, a) => s + a.metrics.withdrawalsRejectedAmount, 0),

            totalSettledVolume: superAdminMetrics.totalSettledVolume + affiliateRows.reduce((s, a) => s + a.metrics.totalSettledVolume, 0)
        };

        return { superAdminRow, affiliateRows, totals };
    }

    // --- TEST SUITE ---

    await t.test('1. Deposit Lineage: assigns admin from bank account owner', () => {
        const admins: MockAdminProfile[] = [
            { id: 1, userId: 101n, code: 'adm_abebe', customName: 'Abebe Admin', isActive: true, isWithdrawalAdmin: false, depositLimit: 3000, collectedDeposits: 0 },
            { id: 2, userId: 202n, code: 'adm_kebede', customName: 'Kebede Admin', isActive: true, isWithdrawalAdmin: false, depositLimit: 3000, collectedDeposits: 0 }
        ];
        const accounts: MockPaymentAccount[] = [
            { id: 10, bankName: 'Telebirr', accountNumber: '0911000000', adminId: 1, isActive: true },
            { id: 20, bankName: 'CBE', accountNumber: '1000111111', adminId: 2, isActive: true }
        ];
        const users: MockUser[] = [
            { id: 999n, firstName: 'Player1', balance: 0, withdrawableBalance: 0, assignedAdminId: null }
        ];

        const assigned1 = resolveDepositAssignedAdmin(10, 999n, accounts, users, admins);
        assert.equal(assigned1, 1, 'Should assign to Abebe Admin (id 1)');

        const assigned2 = resolveDepositAssignedAdmin(20, 999n, accounts, users, admins);
        assert.equal(assigned2, 2, 'Should assign to Kebede Admin (id 2)');
    });

    await t.test('2. Deposit Lineage: falls back to user assignedAdminId or Super Admin', () => {
        const admins: MockAdminProfile[] = [
            { id: 1, userId: 101n, code: 'adm_abebe', customName: 'Abebe Admin', isActive: true, isWithdrawalAdmin: false, depositLimit: 3000, collectedDeposits: 0 }
        ];
        const accounts: MockPaymentAccount[] = [
            { id: 30, bankName: 'Awash', accountNumber: '0922000000', adminId: null, isActive: true } // Platform pool account
        ];
        const userWithAdmin: MockUser[] = [
            { id: 501n, firstName: 'DownlinePlayer', balance: 0, withdrawableBalance: 0, assignedAdminId: 1 }
        ];
        const organicUser: MockUser[] = [
            { id: 502n, firstName: 'OrganicPlayer', balance: 0, withdrawableBalance: 0, assignedAdminId: null }
        ];

        const assignedDownline = resolveDepositAssignedAdmin(30, 501n, accounts, userWithAdmin, admins);
        assert.equal(assignedDownline, 1, 'Should resolve to player assigned admin if pool account chosen');

        const assignedOrganic = resolveDepositAssignedAdmin(30, 502n, accounts, organicUser, admins);
        assert.equal(assignedOrganic, null, 'Should fallback to Super Admin (null) for organic player on pool account');
    });

    await t.test('3. Withdrawal Lineage: routes to active Duty Withdrawal Admin', () => {
        const adminsWithDuty: MockAdminProfile[] = [
            { id: 1, userId: 101n, code: 'adm_abebe', isActive: true, isWithdrawalAdmin: false, depositLimit: 3000, collectedDeposits: 0 },
            { id: 2, userId: 202n, code: 'adm_duty', customName: 'Duty Agent', isActive: true, isWithdrawalAdmin: true, depositLimit: 3000, collectedDeposits: 0 }
        ];
        const adminsNoDuty: MockAdminProfile[] = [
            { id: 1, userId: 101n, code: 'adm_abebe', isActive: true, isWithdrawalAdmin: false, depositLimit: 3000, collectedDeposits: 0 }
        ];

        const assignedDuty = resolveWithdrawalAssignedAdmin(adminsWithDuty);
        assert.equal(assignedDuty, 2, 'Should assign to Duty Withdrawal Admin (id 2)');

        const assignedMaster = resolveWithdrawalAssignedAdmin(adminsNoDuty);
        assert.equal(assignedMaster, null, 'Should route to Super Admin (null) when no duty admin assigned');
    });

    await t.test('4. Action Execution: records processor name, ID, and action timestamp', () => {
        const pendingReq: MockTransactionRequest = {
            id: 101,
            userId: 777n,
            type: 'deposit',
            amount: 500,
            status: 'PENDING',
            assignedAdminId: 1,
            processedByAdminId: null,
            processedByName: null,
            actionAt: null,
            createdAt: new Date('2026-10-10T08:00:00Z')
        };

        const now = new Date('2026-10-10T08:05:00Z');
        const affiliateAdmin: MockAdminProfile = {
            id: 1,
            userId: 101n,
            code: 'adm_abebe',
            customName: 'Abebe Admin',
            isActive: true,
            isWithdrawalAdmin: false,
            depositLimit: 3000,
            collectedDeposits: 0
        };

        // Affiliate admin approves
        const approvedByAffiliate = applyApprovalAttribution(pendingReq, false, affiliateAdmin, now);
        assert.equal(approvedByAffiliate.status, 'APPROVED');
        assert.equal(approvedByAffiliate.processedByName, 'Abebe Admin');
        assert.equal(approvedByAffiliate.processedByAdminId, 1);
        assert.deepEqual(approvedByAffiliate.actionAt, now);

        // Super Admin rejects
        const rejectedByMaster = applyRejectionAttribution(pendingReq, true, null, now);
        assert.equal(rejectedByMaster.status, 'REJECTED');
        assert.equal(rejectedByMaster.processedByName, 'Super Admin');
        assert.equal(rejectedByMaster.processedByAdminId, null);
        assert.deepEqual(rejectedByMaster.actionAt, now);
    });

    await t.test('5. Admin Audit Statistics: aggregates metrics and totals accurately', () => {
        const admins: MockAdminProfile[] = [
            { id: 1, userId: 101n, code: 'adm_1', customName: 'Agent Alpha', isActive: true, isWithdrawalAdmin: false, depositLimit: 3000, collectedDeposits: 1200 },
            { id: 2, userId: 202n, code: 'adm_2', customName: 'Agent Beta', isActive: true, isWithdrawalAdmin: true, depositLimit: 3000, collectedDeposits: 0 }
        ];

        const requests: MockTransactionRequest[] = [
            // Agent Alpha approved deposit: 1000 ETB
            { id: 1, userId: 11n, type: 'deposit', amount: 1000, status: 'APPROVED', assignedAdminId: 1, processedByAdminId: 1, processedByName: 'Agent Alpha', actionAt: new Date(), createdAt: new Date() },
            // Agent Alpha approved deposit: 200 ETB
            { id: 2, userId: 12n, type: 'deposit', amount: 200, status: 'APPROVED', assignedAdminId: 1, processedByAdminId: 1, processedByName: 'Agent Alpha', actionAt: new Date(), createdAt: new Date() },
            // Agent Alpha pending deposit: 300 ETB
            { id: 3, userId: 13n, type: 'deposit', amount: 300, status: 'PENDING', assignedAdminId: 1, processedByAdminId: null, processedByName: null, actionAt: null, createdAt: new Date() },
            // Agent Alpha rejected deposit: 150 ETB
            { id: 4, userId: 14n, type: 'deposit', amount: 150, status: 'REJECTED', assignedAdminId: 1, processedByAdminId: 1, processedByName: 'Agent Alpha', actionAt: new Date(), createdAt: new Date() },

            // Agent Beta (Duty Withdrawal) approved withdrawal: 600 ETB
            { id: 5, userId: 21n, type: 'withdraw', amount: 600, status: 'APPROVED', assignedAdminId: 2, processedByAdminId: 2, processedByName: 'Agent Beta', actionAt: new Date(), createdAt: new Date() },
            // Agent Beta pending withdrawal: 400 ETB
            { id: 6, userId: 22n, type: 'withdraw', amount: 400, status: 'PENDING', assignedAdminId: 2, processedByAdminId: null, processedByName: null, actionAt: null, createdAt: new Date() },

            // Super Admin approved organic deposit: 500 ETB
            { id: 7, userId: 31n, type: 'deposit', amount: 500, status: 'APPROVED', assignedAdminId: null, processedByAdminId: null, processedByName: 'Super Admin', actionAt: new Date(), createdAt: new Date() }
        ];

        const { superAdminRow, affiliateRows, totals } = calculateAdminAuditStats(requests, admins, '12345678');

        // Check Super Admin metrics
        assert.equal(superAdminRow.metrics.depositsApprovedCount, 1);
        assert.equal(superAdminRow.metrics.depositsApprovedAmount, 500);
        assert.equal(superAdminRow.metrics.totalSettledVolume, 500);

        // Check Agent Alpha metrics
        const alpha = affiliateRows.find(a => a.id === 1)!;
        assert.equal(alpha.metrics.depositsApprovedCount, 2);
        assert.equal(alpha.metrics.depositsApprovedAmount, 1200);
        assert.equal(alpha.metrics.depositsPendingCount, 1);
        assert.equal(alpha.metrics.depositsPendingAmount, 300);
        assert.equal(alpha.metrics.depositsRejectedCount, 1);
        assert.equal(alpha.metrics.depositsRejectedAmount, 150);
        assert.equal(alpha.metrics.totalSettledVolume, 1200);

        // Check Agent Beta metrics
        const beta = affiliateRows.find(a => a.id === 2)!;
        assert.equal(beta.metrics.withdrawalsApprovedCount, 1);
        assert.equal(beta.metrics.withdrawalsApprovedAmount, 600);
        assert.equal(beta.metrics.withdrawalsPendingCount, 1);
        assert.equal(beta.metrics.withdrawalsPendingAmount, 400);
        assert.equal(beta.metrics.totalSettledVolume, 600);

        // Check Global Platform Totals
        assert.equal(totals.depositsApprovedCount, 3, 'Total 3 approved deposits');
        assert.equal(totals.depositsApprovedAmount, 1700, 'Total 1700 ETB approved deposits (1200 + 500)');
        assert.equal(totals.depositsPendingCount, 1, 'Total 1 pending deposit');
        assert.equal(totals.depositsPendingAmount, 300, 'Total 300 ETB pending deposit');
        assert.equal(totals.depositsRejectedCount, 1, 'Total 1 rejected deposit');
        assert.equal(totals.depositsRejectedAmount, 150, 'Total 150 ETB rejected deposit');

        assert.equal(totals.withdrawalsApprovedCount, 1, 'Total 1 approved withdrawal');
        assert.equal(totals.withdrawalsApprovedAmount, 600, 'Total 600 ETB approved withdrawal');
        assert.equal(totals.withdrawalsPendingCount, 1, 'Total 1 pending withdrawal');
        assert.equal(totals.withdrawalsPendingAmount, 400, 'Total 400 ETB pending withdrawal');

        assert.equal(totals.totalSettledVolume, 2300, 'Total settled volume: 1700 dep + 600 wdr = 2300 ETB');
    });
});
