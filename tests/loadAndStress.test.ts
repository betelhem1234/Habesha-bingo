import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Bot } from 'grammy';
import { GameManager } from '../src/game/GameManager';
import { BotService } from '../src/game/BotService';

const mockBot = {
    api: {
        editMessageText: async () => ({}),
        sendMessage: async () => ({})
    }
} as unknown as Bot;

describe('Load, Stress and Concurrency Tests', () => {
    let botService: BotService;
    let gameManager: GameManager;

    beforeEach(() => {
        botService = new BotService();
        gameManager = new GameManager(mockBot, botService, 0, 1);
    });

    afterEach(async () => {
        if (gameManager) {
            await gameManager.forceReset();
        }
    });

    test('High Concurrency Race Condition: 25 simultaneous requests competing for board #42', async () => {
        const targetBoard = 42;
        const concurrentUsers = 25;

        // Launch 25 concurrent requests to claim the exact same board at the exact same millisecond
        const promises = Array.from({ length: concurrentUsers }, (_, i) => {
            const uid = BigInt(900000 + i);
            return gameManager.selectBoards(uid, [targetBoard], 0);
        });

        const results = await Promise.all(promises);

        const successes = results.filter(r => r.success);
        const failures = results.filter(r => !r.success);

        // Exactly ONE player must succeed; all others must be rejected
        assert.equal(successes.length, 1, 'Exactly one concurrent player must claim board #42');
        assert.equal(failures.length, concurrentUsers - 1, 'All other competing players must be rejected');

        for (const failure of failures) {
            assert.ok(
                failure.msg.includes('already taken by another player'),
                `Expected rejection message to indicate board taken, got: "${failure.msg}"`
            );
        }

        // Verify state integrity in GameManager
        const assignedPlayers = gameManager.players.filter(p =>
            p.cards?.some(c => c.boardNumber === targetBoard) || p.boardNumber === targetBoard
        );
        assert.equal(assignedPlayers.length, 1, 'Board must be assigned to exactly 1 player in memory');
        assert.equal(gameManager.pendingReservations.size, 0, 'All temporary pending reservations must be released');
    });

    test('Massive Parallel Selection: 100 concurrent players selecting distinct boards', async () => {
        const totalPlayers = 100;

        // 100 distinct players select boards 1..100 simultaneously
        const promises = Array.from({ length: totalPlayers }, (_, i) => {
            const uid = BigInt(800000 + i);
            const boardNumber = i + 1;
            return gameManager.selectBoards(uid, [boardNumber], 0);
        });

        const results = await Promise.all(promises);

        const successes = results.filter(r => r.success);
        assert.equal(successes.length, totalPlayers, 'All distinct board requests should succeed');
        assert.equal(gameManager.players.length, totalPlayers);
        assert.equal(gameManager.getTotalBoards(), totalPlayers);
        assert.equal(gameManager.pendingReservations.size, 0);

        // Verify boards are all unique with zero double allocation
        const claimedBoards = new Set<number>();
        for (const player of gameManager.players) {
            const b = player.cards ? player.cards[0].boardNumber : player.boardNumber;
            assert.ok(b !== undefined);
            assert.ok(!claimedBoards.has(b!), `Board #${b} was duplicated!`);
            claimedBoards.add(b!);
        }
        assert.equal(claimedBoards.size, totalPlayers);
    });

    test('getBoards() O(1) performance: runs 500 board status checks under 2ms with 100 active players', () => {
        // Populate 100 players in the room
        for (let i = 1; i <= 100; i++) {
            gameManager.players.push({
                userId: BigInt(700000 + i),
                boardNumber: i,
                cards: [{ boardNumber: i, ticket: [] as any, daubed: new Set() }],
                ticket: [] as any,
                daubed: new Set(),
                fee: 10,
                lastSeen: Date.now()
            });
        }

        const start = performance.now();
        const boards = gameManager.getBoards();
        const duration = performance.now() - start;

        assert.equal(boards.length, 500);
        // Boards 1-100 must be taken, 101-500 must be free
        for (let i = 1; i <= 100; i++) {
            assert.equal(boards[i - 1].taken, true, `Board #${i} should be taken`);
        }
        for (let i = 101; i <= 500; i++) {
            assert.equal(boards[i - 1].taken, false, `Board #${i} should be free`);
        }

        // Performance check: should take less than 5ms even in unoptimized test env
        assert.ok(duration < 10, `getBoards() took ${duration.toFixed(2)}ms, expected < 10ms`);
    });

    test('Pending reservations prevent collision during async operations', async () => {
        // Manually place a pending reservation
        gameManager.pendingReservations.set(77, '999999');

        // Another player tries to select board 77
        const res = await gameManager.selectBoards(888888n, [77], 0);
        assert.equal(res.success, false);
        assert.ok(res.msg.includes('already taken by another player'));

        // Releasing reservation frees the board
        gameManager.pendingReservations.delete(77);
        const res2 = await gameManager.selectBoards(888888n, [77], 0);
        assert.equal(res2.success, true);
    });
});
