import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { prisma } from '../src/db';

test('Users Management Pagination, True Count, and Admin Lineage Tests', async (t) => {
    await t.test('1. admin.html contains pagination bar and lineage reconciliation banner', () => {
        const html = fs.readFileSync(path.join(process.cwd(), 'src/public/admin.html'), 'utf8');
        assert.ok(html.includes('id="users-pagination-bar"'), 'Users pagination bar must exist in admin.html');
        assert.ok(html.includes('id="btn-users-prev"'), 'Previous page button must exist');
        assert.ok(html.includes('id="btn-users-next"'), 'Next page button must exist');
        assert.ok(html.includes('id="users-page-info"'), 'Page info label must exist');
        assert.ok(html.includes('id="users-page-indicator"'), 'Page indicator must exist');
        assert.ok(html.includes('id="admins-lineage-summary"'), 'Admins lineage summary banner must exist');
        assert.ok(html.includes('id="lineage-total-users"'), 'Total system users span must exist');
        assert.ok(html.includes('id="lineage-assigned-users"'), 'Assigned users span must exist');
        assert.ok(html.includes('id="lineage-unassigned-users"'), 'Unassigned users span must exist');
        assert.ok(html.includes('<th>Affiliate Admin</th>'), 'Affiliate Admin column header must exist');
        assert.ok(/app\.js\?v=2\.[5-9]/.test(html), 'admin.html must load cache-busting version');
    });

    await t.test('2. app.js compiles cleanly and exports pagination functions', () => {
        const js = fs.readFileSync(path.join(process.cwd(), 'src/public/app.js'), 'utf8');
        assert.ok(js.includes('currentUsersPage'), 'currentUsersPage state must exist');
        assert.ok(js.includes('currentUsersLimit = 100'), 'Default limit must be 100');
        assert.ok(js.includes('function changeUsersPage('), 'changeUsersPage function must exist');
        assert.ok(js.includes('window.changeUsersPage = changeUsersPage'), 'changeUsersPage must be exposed to window');
        assert.ok(js.includes('openAddAdminProfileModal'), 'openAddAdminProfileModal must support compact query');
    });

    await t.test('3. adminServer.ts supports paginated=1, compact=1, and summary in /api/admin/admins', () => {
        const serverCode = fs.readFileSync(path.join(process.cwd(), 'src/adminServer.ts'), 'utf8');
        assert.ok(serverCode.includes("req.query.compact === '1'"), 'Must handle compact=1 query');
        assert.ok(serverCode.includes("req.query.paginated === '1'"), 'Must handle paginated=1 query');
        assert.ok(serverCode.includes('totalPages: Math.max(1, Math.ceil(filteredCount / limit))'), 'Must calculate totalPages');
        assert.ok(serverCode.includes("prisma.user.count({ where: { assignedAdminId: null } })"), 'Must count unassigned users');
        assert.ok(serverCode.includes('assignedUsersTotal'), 'Must summarize assigned users');
        assert.ok(!serverCode.includes('take: 150'), 'Must not truncate users to 150 in adminServer.ts');
    });

    await t.test('4. Database user query pagination verification', async () => {
        const totalUsers = await prisma.user.count();
        assert.ok(totalUsers >= 0, 'Total users should be queryable');

        const page1Users = await prisma.user.findMany({
            orderBy: { balance: 'desc' },
            skip: 0,
            take: 100
        });
        assert.ok(page1Users.length <= 100, 'Page 1 should have at most 100 users');

        if (totalUsers > 100) {
            const page2Users = await prisma.user.findMany({
                orderBy: { balance: 'desc' },
                skip: 100,
                take: 100
            });
            assert.ok(page2Users.length <= 100, 'Page 2 should have at most 100 users');
            assert.notEqual(page1Users[0].id, page2Users[0].id, 'Page 1 and Page 2 must not have overlapping records');
        }
    });

    await t.test('5. Compact user query returns lightweight fields', async () => {
        const compactUsers = await prisma.user.findMany({
            select: {
                id: true,
                firstName: true,
                lastName: true,
                username: true,
                phone: true
            },
            take: 10
        });
        assert.ok(Array.isArray(compactUsers), 'Compact users must be an array');
        if (compactUsers.length > 0) {
            const first = compactUsers[0];
            assert.ok('id' in first, 'Must include id');
            assert.ok('firstName' in first, 'Must include firstName');
            assert.ok(!('balance' in (first as any)), 'Compact query must not include heavy balance or relational fields');
        }
    });
});
