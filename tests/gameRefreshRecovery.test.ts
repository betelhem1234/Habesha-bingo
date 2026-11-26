import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

test('Game Page Refresh & Recovery Engine Verification', async (t) => {
    const gameHtmlPath = path.join(process.cwd(), 'src', 'public', 'game.html');
    const htmlContent = fs.readFileSync(gameHtmlPath, 'utf8');

    await t.test('game.html markup binds refresh button to refreshGame() with proper styling', () => {
        assert.ok(
            htmlContent.includes('onclick="refreshGame()"'),
            'Refresh button must call refreshGame() directly on click'
        );
        assert.ok(
            htmlContent.includes('id="btn-refresh"'),
            'Refresh button must have id="btn-refresh" for dynamic visual feedback'
        );
        assert.ok(
            htmlContent.includes('.btn-refresh.spinning'),
            'CSS must define .btn-refresh.spinning for active loading state'
        );
        assert.ok(
            htmlContent.includes('.btn-refresh.success'),
            'CSS must define .btn-refresh.success for visual confirmation'
        );
        assert.ok(
            htmlContent.includes('.btn-refresh.error'),
            'CSS must define .btn-refresh.error for offline/network failure state'
        );
        assert.ok(
            htmlContent.includes('@keyframes spin-refresh'),
            'CSS must define smooth rotation animation'
        );
    });

    await t.test('refreshGame implementation contains all 4 recovery primitives', () => {
        // 1. Audio unlock
        assert.ok(
            htmlContent.includes('unlockAudio()'),
            'refreshGame must trigger unlockAudio() to resume suspended mobile AudioContext'
        );

        // 2. SSE reconnect
        assert.ok(
            htmlContent.includes('initSSE()'),
            'refreshGame must re-initialize SSE stream to clear dead TCP sockets'
        );

        // 3. Cache-busting state fetch
        assert.ok(
            htmlContent.includes('_t=${Date.now()}'),
            'State fetch and SSE must include _t= timestamp cache buster'
        );
        assert.ok(
            htmlContent.includes("cache: 'no-store'"),
            "HTTP fetches must include { cache: 'no-store' } to bypass mobile intermediate caches"
        );

        // 4. Online event listener
        assert.ok(
            htmlContent.includes("window.addEventListener('online'"),
            'Must auto-trigger recovery when mobile network returns online'
        );
    });

    await t.test('adaptive watchdog auto-recovers stalled games without player intervention', () => {
        assert.ok(
            htmlContent.includes('lastSSEEventTime'),
            'Must track lastSSEEventTime across all SSE events'
        );
        assert.ok(
            htmlContent.includes('timeSinceSSE > 9000') || htmlContent.includes('lastSSEEventTime > 8000'),
            'Watchdog must check for SSE stall during active game play'
        );
    });

    await t.test('all embedded scripts in game.html compile with valid JavaScript syntax', () => {
        const scriptRegex = /<script[\s\S]*?>([\s\S]*?)<\/script>/gi;
        let match;
        let count = 0;
        while ((match = scriptRegex.exec(htmlContent)) !== null) {
            const scriptCode = match[1];
            if (!scriptCode || scriptCode.trim().length === 0) continue;
            // Verify syntax compilation
            assert.doesNotThrow(() => {
                new vm.Script(scriptCode, { filename: `game.html#script-${count}` });
            }, `Embedded script #${count} in game.html must have valid JS syntax`);
            count++;
        }
        assert.ok(count > 0, 'Must have validated at least one embedded script');
    });
});
