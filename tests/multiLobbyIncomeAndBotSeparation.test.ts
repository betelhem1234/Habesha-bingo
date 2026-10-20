import test from 'node:test';
import assert from 'node:assert/strict';
import { GameManager } from '../src/game/GameManager';
import { GameRooms } from '../src/game/GameRooms';

test('Multi-Lobby Metrics Separation and Bot Controls Tests', async (t) => {
    const mockBot: any = {
        api: {
            editMessageText: async () => {},
            sendMessage: async () => {}
        }
    };

    await t.test('getAdminStats returns separated boardsTaken per room', () => {
        const gameRooms = new GameRooms(mockBot);
        const room10 = gameRooms.getRoom(10, 1);
        const room20 = gameRooms.getRoom(20, 1);

        room10.players = [
            {
                userId: 201n,
                cards: [
                    { boardNumber: 1, ticket: [] as any, daubed: new Set() },
                    { boardNumber: 2, ticket: [] as any, daubed: new Set() }
                ],
                ticket: [] as any,
                daubed: new Set(),
                boardNumber: 1,
                fee: 20,
                lastSeen: Date.now()
            }
        ];

        room20.players = [
            {
                userId: 202n,
                cards: [
                    { boardNumber: 5, ticket: [] as any, daubed: new Set() }
                ],
                ticket: [] as any,
                daubed: new Set(),
                boardNumber: 5,
                fee: 20,
                lastSeen: Date.now()
            }
        ];

        const stats = gameRooms.getAdminStats();
        const r10Stats = stats.rooms.find(r => r.fee === 10 && r.room === 1);
        const r20Stats = stats.rooms.find(r => r.fee === 20 && r.room === 1);

        assert.ok(r10Stats);
        assert.ok(r20Stats);
        assert.equal(r10Stats.boardsTaken, 2);
        assert.equal(r20Stats.boardsTaken, 1);
    });

    await t.test('GameManager currentWinners records fee and room accurately', async () => {
        const gm10 = new GameManager(mockBot, null as any, 10, 1);
        const gm20 = new GameManager(mockBot, null as any, 20, 1);

        const dummyCandidate10 = {
            player: {
                userId: 301n,
                cards: [],
                ticket: [] as any,
                daubed: new Set<number>(),
                boardNumber: 10,
                fee: 10,
                firstName: 'Winner 10',
                lastSeen: Date.now()
            },
            boardNumber: 10,
            ticket: [] as any,
            daubed: new Set<number>(),
            winningCells: [{ row: 0, col: 0 }]
        };

        const dummyCandidate20 = {
            player: {
                userId: 302n,
                cards: [],
                ticket: [] as any,
                daubed: new Set<number>(),
                boardNumber: 20,
                fee: 20,
                firstName: 'Winner 20',
                lastSeen: Date.now()
            },
            boardNumber: 20,
            ticket: [] as any,
            daubed: new Set<number>(),
            winningCells: [{ row: 1, col: 1 }]
        };

        // Call private endGame directly via cast
        await (gm10 as any).endGame([dummyCandidate10]);
        await (gm20 as any).endGame([dummyCandidate20]);

        assert.equal(gm10.currentWinners.length, 1);
        assert.equal(gm10.currentWinners[0].userId, '301');
        assert.equal(gm10.currentWinners[0].fee, 10);
        assert.equal(gm10.currentWinners[0].room, 1);

        assert.equal(gm20.currentWinners.length, 1);
        assert.equal(gm20.currentWinners[0].userId, '302');
        assert.equal(gm20.currentWinners[0].fee, 20);
        assert.equal(gm20.currentWinners[0].room, 1);
    });

    await t.test('Bot injection and clear are isolated per lobby/stake', async () => {
        const gameRooms = new GameRooms(mockBot);
        const room10 = gameRooms.getRoom(10, 1);
        const room20 = gameRooms.getRoom(20, 1);

        // Inject 5 bots into Room 10
        const added10 = await gameRooms.botService.injectBots(room10, 5, 10);
        assert.equal(added10, 5);
        assert.equal(room10.players.filter(p => p.isBot).length, 5);
        assert.equal(room20.players.filter(p => p.isBot).length, 0);

        // Inject 3 bots into Room 20
        const added20 = await gameRooms.botService.injectBots(room20, 3, 20);
        assert.equal(added20, 3);
        assert.equal(room10.players.filter(p => p.isBot).length, 5);
        assert.equal(room20.players.filter(p => p.isBot).length, 3);

        // Clear bots from Room 10 only
        const cleared10 = gameRooms.botService.clearBots(room10);
        assert.equal(cleared10, 5);
        assert.equal(room10.players.filter(p => p.isBot).length, 0);
        assert.equal(room20.players.filter(p => p.isBot).length, 3, 'Room 20 bots should remain untouched');

        // Clear bots from Room 20
        const cleared20 = gameRooms.botService.clearBots(room20);
        assert.equal(cleared20, 3);
        assert.equal(room20.players.filter(p => p.isBot).length, 0);
    });

    await t.test('Multi-lobby financial aggregation logic isolates 10 Birr vs 20 Birr revenues', () => {
        const sampleIncomes = [
            { fee: 10, room: 1, playerCount: 10, totalCollected: { toNumber: () => 100 }, winnerPayout: { toNumber: () => 80 }, houseProfit: { toNumber: () => 20 } },
            { fee: 10, room: 1, playerCount: 8, totalCollected: { toNumber: () => 80 }, winnerPayout: { toNumber: () => 64 }, houseProfit: { toNumber: () => 16 } },
            { fee: 20, room: 1, playerCount: 5, totalCollected: { toNumber: () => 100 }, winnerPayout: { toNumber: () => 80 }, houseProfit: { toNumber: () => 20 } },
            { fee: 20, room: 1, playerCount: 6, totalCollected: { toNumber: () => 120 }, winnerPayout: { toNumber: () => 96 }, houseProfit: { toNumber: () => 24 } }
        ];

        const byLobby: Record<string, { totalGames: number; totalPlayers: number; totalPot: number; totalWinnerPayout: number; totalHouseProfit: number }> = {
            '10': { totalGames: 0, totalPlayers: 0, totalPot: 0, totalWinnerPayout: 0, totalHouseProfit: 0 },
            '20': { totalGames: 0, totalPlayers: 0, totalPot: 0, totalWinnerPayout: 0, totalHouseProfit: 0 }
        };

        for (const i of sampleIncomes) {
            const feeKey = String(i.fee);
            if (!byLobby[feeKey]) {
                byLobby[feeKey] = { totalGames: 0, totalPlayers: 0, totalPot: 0, totalWinnerPayout: 0, totalHouseProfit: 0 };
            }
            byLobby[feeKey].totalGames++;
            byLobby[feeKey].totalPlayers += i.playerCount;
            byLobby[feeKey].totalPot += i.totalCollected.toNumber();
            byLobby[feeKey].totalWinnerPayout += i.winnerPayout.toNumber();
            byLobby[feeKey].totalHouseProfit += i.houseProfit.toNumber();
        }

        assert.equal(byLobby['10'].totalGames, 2);
        assert.equal(byLobby['10'].totalPlayers, 18);
        assert.equal(byLobby['10'].totalPot, 180);
        assert.equal(byLobby['10'].totalWinnerPayout, 144);
        assert.equal(byLobby['10'].totalHouseProfit, 36);

        assert.equal(byLobby['20'].totalGames, 2);
        assert.equal(byLobby['20'].totalPlayers, 11);
        assert.equal(byLobby['20'].totalPot, 220);
        assert.equal(byLobby['20'].totalWinnerPayout, 176);
        assert.equal(byLobby['20'].totalHouseProfit, 44);
    });
});
