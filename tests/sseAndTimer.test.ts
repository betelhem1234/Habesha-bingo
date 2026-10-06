import test from 'node:test';
import assert from 'node:assert/strict';
import { GameManager } from '../src/game/GameManager';

test('Real-Time SSE and Clockwork Timer Engine', async (t) => {
    const mockBot: any = {
        api: {
            editMessageText: async () => {},
            sendMessage: async () => {}
        }
    };

    await t.test('addSSEClient receives initial snapshot and receives broadcast events', () => {
        const gm = new GameManager(mockBot);
        let writtenData = '';

        const mockRes: any = {
            write: (chunk: string) => {
                writtenData += chunk;
                return true;
            },
            on: (_event: string, _cb: any) => {}
        };

        const initialSnapshot = { gameState: 'WAITING', pot: 0 };
        gm.addSSEClient(11111n, mockRes, initialSnapshot);

        assert.match(writtenData, /event: init/);
        assert.match(writtenData, /"gameState":"WAITING"/);

        // Test broadcasting ball event
        writtenData = '';
        gm.broadcastSSE('ball', { number: 42, nextDrawAt: 1000000 });
        assert.match(writtenData, /event: ball/);
        assert.match(writtenData, /"number":42/);
    });

    await t.test('dead SSE clients are automatically pruned on write error', () => {
        const gm = new GameManager(mockBot);

        const deadRes: any = {
            write: () => {
                throw new Error('Connection closed by client');
            },
            on: (_event: string, _cb: any) => {}
        };

        gm.addSSEClient(22222n, deadRes);
        // Broadcasting should catch the error and remove the dead client without throwing
        assert.doesNotThrow(() => {
            gm.broadcastSSE('ball', { number: 15 });
        });
    });

    await t.test('forceReset broadcasts reset event to connected clients', async () => {
        const gm = new GameManager(mockBot);
        let resetReceived = false;

        const mockRes: any = {
            write: (chunk: string) => {
                if (chunk.includes('event: reset')) {
                    resetReceived = true;
                }
                return true;
            },
            on: (_event: string, _cb: any) => {}
        };

        gm.addSSEClient(33333n, mockRes);
        await gm.forceReset();
        assert.equal(resetReceived, true);
    });
});
