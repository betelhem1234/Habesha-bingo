import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { GameManager } from '../src/game/GameManager';
import { prisma } from '../src/db';

describe('Lobby Selection Race Conditions & Spectator Desync Tests', () => {
    let gameManager: GameManager;
    const testUserId = 7788990011n;

    const mockBot = {
        api: {
            sendMessage: async () => ({ message_id: 1 }),
            editMessageText: async () => ({ message_id: 1 }),
            sendPhoto: async () => ({ message_id: 1 })
        }
    } as any;

    beforeEach(async () => {
        gameManager = new GameManager(mockBot, null, 10, 1);
        // Ensure test user exists in DB with clean balance
        try {
            await prisma.user.upsert({
                where: { id: testUserId },
                update: { balance: 100, withdrawableBalance: 0, bonus: 0, banned: false },
                create: { id: testUserId, username: 'RaceTester', firstName: 'RaceTester', balance: 100, withdrawableBalance: 0, bonus: 0 }
            });
        } catch (e) {}
    });

    afterEach(async () => {
        if (gameManager) {
            await gameManager.forceReset();
        }
    });

    test('selectBoards preserves existing board when second board is requested after game starts', async () => {
        // Player successfully selects board 10 in lobby
        const firstJoin = await gameManager.selectBoards(testUserId, [10], 0);
        assert.equal(firstJoin.success, true);
        assert.deepEqual(firstJoin.boards, [10]);

        // Game transitions to PLAYING
        gameManager.state = 'PLAYING';

        // Player tries to add board 25 at the last moment
        const lateJoin = await gameManager.selectBoards(testUserId, [10, 25], 0);
        assert.equal(lateJoin.success, false);
        assert.ok(lateJoin.msg.includes('in progress'));
        // CRITICAL FIX: Server must return existing boards [10], NOT empty []!
        assert.deepEqual(lateJoin.boards, [10]);

        // Player is still active in the game with board 10
        const activePlayer = gameManager.getPlayer(testUserId);
        assert.ok(activePlayer);
        assert.equal(activePlayer?.boardNumber, 10);
    });

    test('selectBoards returns empty boards when outsider attempts to join after game starts', async () => {
        const outsiderId = 8899001122n;
        gameManager.state = 'PLAYING';

        const res = await gameManager.selectBoards(outsiderId, [42], 0);
        assert.equal(res.success, false);
        assert.ok(res.msg.includes('in progress'));
        assert.deepEqual(res.boards, []);
    });

    test('Defensive fee rollback if state transitions to PLAYING during fee deduction', async () => {
        // Player has board 10
        await gameManager.selectBoards(testUserId, [10], 0);
        const userBefore = await prisma.user.findUnique({ where: { id: testUserId } });
        const startBalance = userBefore?.balance || 100;

        // Force state to PLAYING right before second selection
        gameManager.state = 'PLAYING';

        // Player tries to add board 20 with 10 Birr fee
        const res = await gameManager.selectBoards(testUserId, [10, 20], 10);
        assert.equal(res.success, false);
        assert.deepEqual(res.boards, [10]);

        // Balance must not be deducted
        const userAfter = await prisma.user.findUnique({ where: { id: testUserId } });
        assert.equal(Number(userAfter?.balance), Number(startBalance));
    });

    test('Player with confirmed boards maintains inGame=true and is not demoted to spectator', async () => {
        await gameManager.selectBoards(testUserId, [10], 0);
        gameManager.state = 'PLAYING';

        const player = gameManager.getPlayer(testUserId);
        assert.ok(player);
        assert.equal(player.boardNumber, 10);
        assert.equal(gameManager.players.length, 1);
        assert.deepEqual(gameManager.getTakenBoards(), [10]);
    });
});
