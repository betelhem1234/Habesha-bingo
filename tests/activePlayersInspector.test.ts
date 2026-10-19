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

    await t.test('sanitizePlayers and getPot accurately deduplicate duplicate player entries', () => {
        const gm = new GameManager(mockBot);

        // Simulate duplicate player entries (e.g. from rapid concurrent taps)
        gm.players.push({
            userId: 8684362724n,
            cards: [{ boardNumber: 455, ticket: [] as any, daubed: new Set() }],
            ticket: [] as any,
            daubed: new Set(),
            boardNumber: 455,
            fee: 10,
            firstName: 'Tilku Bro',
            lastSeen: Date.now()
        });

        gm.players.push({
            userId: 8684362724n,
            cards: [
                { boardNumber: 455, ticket: [] as any, daubed: new Set() },
                { boardNumber: 456, ticket: [] as any, daubed: new Set() }
            ],
            ticket: [] as any,
            daubed: new Set(),
            boardNumber: 455,
            fee: 20,
            firstName: 'Tilku Bro',
            lastSeen: Date.now() - 10000
        });

        gm.players.push({
            userId: 1783441823n,
            cards: [{ boardNumber: 52, ticket: [] as any, daubed: new Set() }],
            ticket: [] as any,
            daubed: new Set(),
            boardNumber: 52,
            fee: 10,
            firstName: 'Tinshu Bro',
            lastSeen: Date.now()
        });

        assert.equal(gm.players.length, 3);

        // Sanitize and check pot
        gm.sanitizePlayers();
        assert.equal(gm.players.length, 2);
        assert.equal(gm.getPot(), 20); // 10 (Tilku) + 10 (Tinshu)
    });

    await t.test('getActivePlayersDetails returns unique players per room', () => {
        const gameRooms = new GameRooms(mockBot);
        const room = gameRooms.getRoom(10, 1);

        // Insert duplicate for same user
        room.players.push({
            userId: 999n,
            cards: [{ boardNumber: 1, ticket: [] as any, daubed: new Set() }],
            ticket: [] as any,
            daubed: new Set(),
            boardNumber: 1,
            fee: 10,
            firstName: 'DuplicateUser',
            lastSeen: Date.now()
        });
        room.players.push({
            userId: 999n,
            cards: [{ boardNumber: 1, ticket: [] as any, daubed: new Set() }, { boardNumber: 2, ticket: [] as any, daubed: new Set() }],
            ticket: [] as any,
            daubed: new Set(),
            boardNumber: 1,
            fee: 20,
            firstName: 'DuplicateUser',
            lastSeen: Date.now() - 5000
        });

        const details = gameRooms.getActivePlayersDetails();
        assert.equal(details.length, 1);
        assert.equal(details[0].player.userId, '999');
    });

    await t.test('getAdminStats returns separated room metrics for 10 Birr and 20 Birr rooms', () => {
        const gameRooms = new GameRooms(mockBot);
        const r10 = gameRooms.getRoom(10, 1);
        const r20 = gameRooms.getRoom(20, 1);

        // Populate 8 players in 10 Birr room
        for (let i = 1; i <= 8; i++) {
            r10.players.push({
                userId: BigInt(1000 + i),
                cards: [{ boardNumber: i, ticket: [] as any, daubed: new Set() }],
                ticket: [] as any,
                daubed: new Set(),
                boardNumber: i,
                fee: 10,
                firstName: `Player10_${i}`,
                lastSeen: Date.now()
            });
        }

        // Populate 8 players in 20 Birr room
        for (let i = 1; i <= 8; i++) {
            r20.players.push({
                userId: BigInt(2000 + i),
                cards: [{ boardNumber: i, ticket: [] as any, daubed: new Set() }],
                ticket: [] as any,
                daubed: new Set(),
                boardNumber: i,
                fee: 20,
                firstName: `Player20_${i}`,
                lastSeen: Date.now()
            });
        }

        const stats = gameRooms.getAdminStats();
        // Platform wide total is 16
        assert.equal(stats.activePlayers, 16);

        // Rooms breakdown must separate 10 Birr and 20 Birr rooms
        assert.ok(Array.isArray(stats.rooms));
        assert.equal(stats.rooms.length >= 2, true);

        const room10Stat = stats.rooms.find(r => r.fee === 10 && r.room === 1);
        const room20Stat = stats.rooms.find(r => r.fee === 20 && r.room === 1);

        assert.ok(room10Stat);
        assert.equal(room10Stat.playersCount, 8);
        assert.equal(room10Stat.pot, 80);

        assert.ok(room20Stat);
        assert.equal(room20Stat.playersCount, 8);
        assert.equal(room20Stat.pot, 160);
    });
});
