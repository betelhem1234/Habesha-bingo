import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

test('Render 5 GB Bandwidth Protection Verification Suite', async (t) => {
    const adminServerSrc = fs.readFileSync(path.join(process.cwd(), 'src/adminServer.ts'), 'utf8');
    const appJsSrc = fs.readFileSync(path.join(process.cwd(), 'src/public/app.js'), 'utf8');
    const adminHtmlSrc = fs.readFileSync(path.join(process.cwd(), 'src/public/admin.html'), 'utf8');
    const gameHtmlSrc = fs.readFileSync(path.join(process.cwd(), 'src/public/game.html'), 'utf8');
    const depositHtmlSrc = fs.readFileSync(path.join(process.cwd(), 'src/public/deposit.html'), 'utf8');
    const withdrawHtmlSrc = fs.readFileSync(path.join(process.cwd(), 'src/public/withdraw.html'), 'utf8');
    const walletHtmlSrc = fs.readFileSync(path.join(process.cwd(), 'src/public/wallet.html'), 'utf8');

    await t.test('1. Static Media 30-Day Immutable Caching in adminServer.ts', () => {
        assert.ok(
            adminServerSrc.includes('max-age=2592000, immutable'),
            'adminServer.ts must set 30-day (2592000s) immutable caching for media assets'
        );
        assert.ok(
            adminServerSrc.includes('max-age=86400, immutable'),
            'adminServer.ts must set immutable caching for uploaded deposit proofs'
        );
    });

    await t.test('2. /api/stats DB Aggregation Optimization (Zero Full-Table Scans)', () => {
        assert.ok(
            adminServerSrc.includes('prisma.user.aggregate({ _sum: { balance: true } })'),
            'adminServer.ts must use native SQL sum aggregation in /api/stats'
        );
        // Ensure prisma.user.findMany() is NOT called in /api/stats
        const statsRouteMatch = adminServerSrc.match(/app\.get\('\/api\/stats'[\s\S]*?res\.json\(/);
        assert.ok(statsRouteMatch, '/api/stats route must exist');
        assert.ok(
            !statsRouteMatch[0].includes('prisma.user.findMany()'),
            '/api/stats must not invoke prisma.user.findMany() to prevent bandwidth exhaustion'
        );
    });

    await t.test('3. Admin Dashboard Visibility Pause and Tab-Scoped Polling', () => {
        // App.js compilation check
        assert.doesNotThrow(() => {
            execSync('node -c src/public/app.js');
        }, 'src/public/app.js must have valid syntax');

        assert.ok(appJsSrc.includes('let currentActiveTab'), 'currentActiveTab must be tracked');
        assert.ok(appJsSrc.includes('refreshCurrentTabData'), 'refreshCurrentTabData function must exist');
        assert.ok(appJsSrc.includes('refreshPeriodicData'), 'refreshPeriodicData function must exist');
        assert.ok(appJsSrc.includes('if (document.hidden) return;'), 'Polling must pause when tab is hidden');
        assert.ok(appJsSrc.includes("document.addEventListener('visibilitychange'"), 'Visibilitychange event must be registered');
        assert.ok(appJsSrc.includes('adminPollingTimer = null;'), 'showLoginOverlay must halt polling when locked');
        assert.ok(adminHtmlSrc.includes('app.js?v=2.7'), 'admin.html must load latest cache-busted app.js?v=2.7');
    });

    await t.test('4. Smart Ticket Audio Preloading in game.html', () => {
        assert.ok(
            gameHtmlSrc.includes('if(!myCards || myCards.length === 0) return;'),
            'game.html must defer audio preloading until player selects boards'
        );
        assert.ok(
            gameHtmlSrc.includes('priority.slice(i, i+BATCH)'),
            'game.html must prioritize active card numbers first'
        );
        assert.ok(
            gameHtmlSrc.includes('setTimeout(async () => {'),
            'game.html must space out remaining numbers with background delays'
        );
    });

    await t.test('5. Player Wallet, Deposit, and Withdraw Polling Relaxation (15s + Visibility Guard)', () => {
        assert.ok(
            depositHtmlSrc.includes('setInterval') && depositHtmlSrc.includes('15000') && depositHtmlSrc.includes('!document.hidden'),
            'deposit.html must poll at 15s interval and check !document.hidden'
        );
        assert.ok(
            withdrawHtmlSrc.includes('setInterval') && withdrawHtmlSrc.includes('15000') && withdrawHtmlSrc.includes('!document.hidden'),
            'withdraw.html must poll at 15s interval and check !document.hidden'
        );
        assert.ok(
            walletHtmlSrc.includes('setInterval') && walletHtmlSrc.includes('15000') && walletHtmlSrc.includes('!document.hidden'),
            'wallet.html must poll at 15s interval and check !document.hidden'
        );
    });
});
