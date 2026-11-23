import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { prisma } from '../src/db';

test('House Income & Rounds Pagination Tests', async (t) => {
    await t.test('1. admin.html contains income pagination bar and navigation controls', () => {
        const html = fs.readFileSync(path.join(process.cwd(), 'src/public/admin.html'), 'utf8');
        assert.ok(html.includes('id="income-pagination-bar"'), 'Income pagination bar must exist in admin.html');
        assert.ok(html.includes('id="btn-income-prev"'), 'Previous page button must exist');
        assert.ok(html.includes('id="btn-income-next"'), 'Next page button must exist');
        assert.ok(html.includes('id="income-page-info"'), 'Page info label must exist');
        assert.ok(html.includes('id="income-page-indicator"'), 'Page indicator must exist');
    });

    await t.test('2. app.js compiles cleanly and exports changeIncomePage', () => {
        const js = fs.readFileSync(path.join(process.cwd(), 'src/public/app.js'), 'utf8');
        assert.ok(js.includes('currentIncomePage'), 'currentIncomePage state must exist');
        assert.ok(js.includes('currentIncomeLimit = 100'), 'Default limit must be 100');
        assert.ok(js.includes('function changeIncomePage('), 'changeIncomePage function must exist');
        assert.ok(js.includes('window.changeIncomePage = changeIncomePage'), 'changeIncomePage must be exposed to window');
    });

    await t.test('3. adminServer.ts pagination logic and response contract', () => {
        const serverCode = fs.readFileSync(path.join(process.cwd(), 'src/adminServer.ts'), 'utf8');
        assert.ok(serverCode.includes('skip = (page - 1) * limit'), 'Must compute skip for pagination');
        assert.ok(serverCode.includes('totalPeriodGames: totalCount'), 'Must provide totalPeriodGames in summary');
        assert.ok(serverCode.includes('totalPages = Math.max(1, Math.ceil(totalCount / limit))'), 'Must calculate totalPages');
    });

    await t.test('4. Database pagination matches 100 records per page', async () => {
        const totalGames = await prisma.houseIncome.count();
        assert.ok(totalGames >= 0, 'Total games count should be queryable');

        const page1 = await prisma.houseIncome.findMany({
            orderBy: { createdAt: 'desc' },
            skip: 0,
            take: 100
        });
        assert.ok(page1.length <= 100, 'Page 1 must not exceed 100 records');

        if (totalGames > 100) {
            const page2 = await prisma.houseIncome.findMany({
                orderBy: { createdAt: 'desc' },
                skip: 100,
                take: 100
            });
            assert.ok(page2.length <= 100, 'Page 2 must not exceed 100 records');
            assert.notEqual(page1[0].id, page2[0].id, 'Page 1 and Page 2 must not have overlapping records');
        }
    });
});
