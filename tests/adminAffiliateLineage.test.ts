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

        // 2. Check if player or admin referral (e.g. admin shared start=USER_ID from profile)
        const refParam = raw.replace(/^ref_?/, '');
        if (/^\d+$/.test(refParam)) {
            refId = BigInt(refParam);
            if (!assignedAdminId) {
                const adminByUserId = activeAdmins.find(a => a.userId === refId && a.isActive);
                if (adminByUserId) {
                    assignedAdminId = adminByUserId.id;
                } else if (inviterUser?.assignedAdminId) {
                    assignedAdminId = inviterUser.assignedAdminId;
                }
            }
        }

        // 3. Fallback: organic auto-balance / active affiliate admin assignment
        if (!assignedAdminId && activeAdmins.length > 0) {
            const sorted = [...activeAdmins.filter(a => a.isActive)].sort((a, b) => a.assignedCount - b.assignedCount);
            if (sorted.length > 0) {
                assignedAdminId = sorted[0].id;
            }
        }

        return { assignedAdminId, refId };
    }

    // Helper: simulate deposit accounts filter (strict isolation)
    function filterDepositAccounts(
        playerAssignedAdminId: number | null,
        allAccounts: MockPaymentAccount[]
    ): MockPaymentAccount[] {
        const active = allAccounts.filter(a => a.isActive);
        if (playerAssignedAdminId) {
            // Strictly return assigned admin accounts, NEVER fallback to Super Admin accounts!
            return active.filter(a => a.adminId === playerAssignedAdminId);
        }
        // Only return Super Admin accounts (adminId: null) if player is unassigned
        return active.filter(a => a.adminId === null);
    }

    // Helper: simulate requests scoping by role
    function getRequestsWhereClause(
        callerTelegramId: bigint,
        masterAdminId: string,
        admins: MockAdminProfile[]
    ) {
        if (callerTelegramId.toString() === masterAdminId) {
            return { status: 'PENDING' };
        }
        const affiliate = admins.find(a => a.userId === callerTelegramId && a.isActive);
        if (!affiliate) return null;
        if (affiliate.isWithdrawalAdmin) {
            return {
                status: 'PENDING',
                OR: [
                    { type: 'withdraw' },
                    { type: 'deposit', assignedAdminId: affiliate.id },
                    { type: 'deposit', account: { adminId: affiliate.id } }
                ]
            };
        }
        return {
            status: 'PENDING',
            type: 'deposit',
            OR: [
                { assignedAdminId: affiliate.id },
                { account: { adminId: affiliate.id } }
            ]
        };
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

    await t.test('admin sharing profile referral link (start=USER_ID) assigns player to that admin', () => {
        const admins: MockAdminProfile[] = [
            { id: 1, userId: 1783441823n, code: 'adm_tinshu', isActive: true, assignedCount: 15 }
        ];

        // Admin Tinshu Bro shares their profile link (start=1783441823)
        const result = resolveLineageOnStart('1783441823', null, admins);
        assert.equal(result.refId, 1783441823n);
        assert.equal(result.assignedAdminId, 1, 'Player must be assigned to Admin #1 (Tinshu Bro)');
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

    await t.test('deposit page displays strictly assigned admin account and NEVER leaks super admin account', () => {
        const accounts: MockPaymentAccount[] = [
            { id: 2, bankName: 'Telebirr', accountNumber: '0962857834', accountName: 'Betelhem Lemma', isActive: true, adminId: null }, // Super Admin
            { id: 3, bankName: 'Telebirr', accountNumber: '0923526309', accountName: 'Abrham', isActive: true, adminId: 1 } // Admin Tinshu Bro
        ];

        // Player assigned to Admin #1 (Tinshu Bro)
        const admin1Banks = filterDepositAccounts(1, accounts);
        assert.equal(admin1Banks.length, 1);
        assert.equal(admin1Banks[0].id, 3, 'Must be Account #3 (Abrham)');
        assert.equal(admin1Banks[0].accountNumber, '0923526309');
        assert.ok(!admin1Banks.some(a => a.id === 2), 'Super Admin account (Betelhem Lemma) must NEVER be in Admin 1 bank list');

        // Unassigned player fallback (no active affiliate admin)
        const unassignedBanks = filterDepositAccounts(null, accounts);
        assert.equal(unassignedBanks.length, 1);
        assert.equal(unassignedBanks[0].id, 2, 'Unassigned player sees Super Admin account');
    });

    await t.test('requests query scoping separates super admin, duty withdrawal admin, and ordinary affiliate admin', () => {
        const masterAdminId = '999999999';
        const admins: MockAdminProfile[] = [
            { id: 1, userId: 1783441823n, code: 'adm_tinshu', isActive: true, assignedCount: 10, isWithdrawalAdmin: false },
            { id: 2, userId: 2222222222n, code: 'adm_duty', isActive: true, assignedCount: 5, isWithdrawalAdmin: true }
        ];

        // 1. Super Admin
        const superQuery = getRequestsWhereClause(999999999n, masterAdminId, admins);
        assert.deepEqual(superQuery, { status: 'PENDING' });

        // 2. Ordinary Affiliate Admin (Tinshu Bro)
        const affQuery = getRequestsWhereClause(1783441823n, masterAdminId, admins);
        assert.deepEqual(affQuery, {
            status: 'PENDING',
            type: 'deposit',
            OR: [
                { assignedAdminId: 1 },
                { account: { adminId: 1 } }
            ]
        });

        // 3. Duty Withdrawal Admin
        const dutyQuery = getRequestsWhereClause(2222222222n, masterAdminId, admins);
        assert.deepEqual(dutyQuery, {
            status: 'PENDING',
            OR: [
                { type: 'withdraw' },
                { type: 'deposit', assignedAdminId: 2 },
                { type: 'deposit', account: { adminId: 2 } }
            ]
        });

        // 4. Regular player (forbidden)
        const playerQuery = getRequestsWhereClause(1234567890n, masterAdminId, admins);
        assert.equal(playerQuery, null);
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

    await t.test('cross-chat request sync updates other admins and cleans up tgNotifications for 0-byte storage', async () => {
        interface TgNotificationItem {
            c: number;
            m: number;
            p: number;
            t?: string;
        }

        interface MockRequestRecord {
            id: number;
            type: string;
            amount: number;
            status: string;
            processedByName: string | null;
            tgNotifications: string | null;
        }

        const initialNotifications: TgNotificationItem[] = [
            { c: 1783441823, m: 101, p: 1, t: '🔔 New DEPOSIT request #24\nAmount: 50 Birr' }, // Tinshu Bro
            { c: 999999999, m: 202, p: 1, t: '🔔 New DEPOSIT request #24\nAmount: 50 Birr' }   // Super Admin
        ];

        const req: MockRequestRecord = {
            id: 24,
            type: 'deposit',
            amount: 50,
            status: 'PENDING',
            processedByName: null,
            tgNotifications: JSON.stringify(initialNotifications)
        };

        const edits: Array<{ chatId: number; messageId: number; newContent: string; isPhoto: boolean }> = [];

        // Simulate sync function
        function syncTelegramRequestNotificationMock(
            requestRecord: MockRequestRecord,
            newStatus: 'APPROVED' | 'REJECTED',
            actorName: string,
            excludeChatId?: number
        ) {
            if (!requestRecord.tgNotifications) return;
            const notifs: TgNotificationItem[] = JSON.parse(requestRecord.tgNotifications);
            const isApproved = newStatus === 'APPROVED';
            const icon = isApproved ? '✅' : '❌';
            const statusLabel = isApproved ? 'Approved' : 'Rejected';

            for (const n of notifs) {
                if (excludeChatId && n.c === excludeChatId) continue;
                const baseText = n.t || `New ${requestRecord.type.toUpperCase()} request #${requestRecord.id}`;
                const newContent = `${icon} <s>${baseText}</s>\n\n<b>${statusLabel} by ${actorName}</b>`;
                edits.push({ chatId: n.c, messageId: n.m, newContent, isPhoto: n.p === 1 });
            }

            // Zero permanent storage guarantee: reset tgNotifications to null!
            requestRecord.tgNotifications = null;
        }

        // Tinshu Bro clicks [Approve] in his chat (1783441823)
        syncTelegramRequestNotificationMock(req, 'APPROVED', 'Tinshu Bro', 1783441823);

        // Verify Super Admin's chat was updated
        assert.equal(edits.length, 1);
        assert.equal(edits[0].chatId, 999999999);
        assert.equal(edits[0].messageId, 202);
        assert.ok(edits[0].newContent.includes('✅ <s>🔔 New DEPOSIT request #24'));
        assert.ok(edits[0].newContent.includes('<b>Approved by Tinshu Bro</b>'));

        // Verify storage is completely freed (null)
        assert.equal(req.tgNotifications, null, 'tgNotifications must be reset to null upon approval');
    });

    await t.test('self-healing on already handled request strips buttons and displays existing resolver', async () => {
        const completedRequest = {
            id: 24,
            status: 'APPROVED',
            processedByName: 'Tinshu Bro'
        };

        // When another admin clicks on the button of an already approved request
        function handleCallbackClick(req: typeof completedRequest, clickedText: string) {
            if (req.status !== 'PENDING') {
                const handler = req.processedByName || 'Admin';
                const isAppr = req.status === 'APPROVED';
                const icon = isAppr ? '✅' : '❌';
                const statusLabel = isAppr ? 'Approved' : 'Rejected';
                return {
                    alert: `This request was already ${req.status.toLowerCase()} by ${handler}.`,
                    updatedMessageContent: `${icon} <s>${clickedText}</s>\n\n<b>Already ${statusLabel} by ${handler}</b>`,
                    replyMarkup: undefined // removes buttons
                };
            }
            return null;
        }

        const clickResult = handleCallbackClick(completedRequest, 'New DEPOSIT request #24');
        assert.ok(clickResult);
        assert.equal(clickResult.alert, 'This request was already approved by Tinshu Bro.');
        assert.ok(clickResult.updatedMessageContent.includes('Already Approved by Tinshu Bro'));
        assert.equal(clickResult.replyMarkup, undefined, 'Inline buttons must be removed');
    });
});
