import test from 'node:test';
import assert from 'node:assert/strict';
import { GameManager } from '../src/game/GameManager';
import { GameRooms } from '../src/game/GameRooms';

test('Active Players Inspector and Lobby Hardening Tests', async (t) => {
    const mockBot: any = {
        api: {
            editMessageText: async () => {},
            sendMessage: async () => {}
        }
    };

    await t.test('getActivePlayersDetails accurately extracts players across multiple rooms', () => {
        const gameRooms = new GameRooms(mockBot);
        const room10 = gameRooms.getRoom(10, 1);
        const room20 = gameRooms.getRoom(20, 1);

        // Add player to 10 Birr room
        room10.players.push({
            userId: 101n,
            cards: [{ boardNumber: 7, ticket: [] as any, daubed: new Set() }],
            ticket: [] as any,
            daubed: new Set(),
            boardNumber: 7,
            fee: 10,
            firstName: 'Abebe',
            username: 'abebe1',
            lastSeen: Date.now()
        });

        // Add player to 20 Birr room
        room20.players.push({
            userId: 102n,
            cards: [{ boardNumber: 15, ticket: [] as any, daubed: new Set() }],
            ticket: [] as any,
            daubed: new Set(),
            boardNumber: 15,
            fee: 20,
            firstName: 'Chala',
            username: 'chala2',
            lastSeen: Date.now()
        });

        const details = gameRooms.getActivePlayersDetails();
        assert.equal(details.length, 2);

        const p1 = details.find(d => d.player.userId === '101');
        assert.ok(p1);
        assert.equal(p1.fee, 10);
        assert.equal(p1.room, 1);
        assert.deepEqual(p1.player.boards, [7]);
        assert.equal(p1.player.firstName, 'Abebe');

        const p2 = details.find(d => d.player.userId === '102');
        assert.ok(p2);
        assert.equal(p2.fee, 20);
        assert.equal(p2.room, 1);
        assert.deepEqual(p2.player.boards, [15]);
        assert.equal(p2.player.username, 'chala2');
    });

    await t.test('removeStalePlayers(15000) evicts abandoned lobby players and frees their boards', async () => {
        const gm = new GameManager(mockBot);

        // Active player (touched 2 seconds ago)
        gm.players.push({
            userId: 201n,
            cards: [{ boardNumber: 33, ticket: [] as any, daubed: new Set() }],
            ticket: [] as any,
            daubed: new Set(),
            boardNumber: 33,
            fee: 10,
            firstName: 'ActivePlayer',
            lastSeen: Date.now() - 2000
        });

        // Abandoned player (closed app 25 seconds ago)
        gm.players.push({
            userId: 202n,
            cards: [{ boardNumber: 44, ticket: [] as any, daubed: new Set() }],
            ticket: [] as any,
            daubed: new Set(),
            boardNumber: 44,
            fee: 10,
            firstName: 'GhostPlayer',
            lastSeen: Date.now() - 25000
        });

        assert.equal(gm.players.length, 2);
        const boardsBefore = gm.getBoards();
        assert.equal(boardsBefore.find(b => b.number === 33)?.taken, true);
        assert.equal(boardsBefore.find(b => b.number === 44)?.taken, true);

        // Run stale eviction
        const removed = await gm.removeStalePlayers(15000);
        assert.equal(removed, 1);
        assert.equal(gm.players.length, 1);
        assert.equal(gm.players[0].userId, 201n);

        // Board #44 should now be freed and taken = false
        const boardsAfter = gm.getBoards();
        assert.equal(boardsAfter.find(b => b.number === 33)?.taken, true);
        assert.equal(boardsAfter.find(b => b.number === 44)?.taken, false);
    });

    await t.test('leaveGame frees player board immediately', async () => {
        const gm = new GameManager(mockBot);

        gm.players.push({
            userId: 301n,
            cards: [{ boardNumber: 88, ticket: [] as any, daubed: new Set() }],
            ticket: [] as any,
            daubed: new Set(),
            boardNumber: 88,
            fee: 10,
            firstName: 'LeavingPlayer',
            lastSeen: Date.now()
        });

        assert.equal(gm.getBoards().find(b => b.number === 88)?.taken, true);

        const res = await gm.leaveGame(301n);
        assert.equal(res.success, true);
        assert.equal(gm.players.length, 0);
        assert.equal(gm.getBoards().find(b => b.number === 88)?.taken, false);
    });
});
