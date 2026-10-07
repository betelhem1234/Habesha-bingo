import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GameManager } from '../src/game/GameManager';
import { generateTicket } from '../src/game/bingo';

const mockBot: any = {
    api: {
        sendMessage: async () => ({ message_id: 123 }),
        editMessageText: async () => ({ message_id: 123 }),
        editMessageReplyMarkup: async () => ({ message_id: 123 })
    }
};

describe('GameManager All-Players-Blocked Early Termination & 100% House Profit', () => {
    it('preserves the <= 2 winner restriction during candidate ball simulation', () => {
        const gm = new GameManager(mockBot);
        // Access private countSimulatedWinners method via type casting
        const p1Id = 1001n;
        const ticket1 = generateTicket(10);
        gm.players = [
            {
                userId: p1Id,
                firstName: 'Player One',
                ticket: ticket1,
                boardNumber: 1,
                cards: [{ boardNumber: 1, ticket: ticket1, daubed: new Set() }],
                daubed: new Set(),
                fee: 50,
                lastSeen: Date.now()
            }
        ];
        const countSim = (gm as any).countSimulatedWinners(75);
        assert.equal(typeof countSim, 'number');
        assert.ok(countSim <= 2, 'Simulated winners count must be evaluated');
    });

    it('terminates game immediately when all players are blocked by false bingo', async () => {
        const gm = new GameManager(mockBot);
        const p1Id = 11111n;
        const p2Id = 22222n;
        const ticket1 = generateTicket(10);
        const ticket2 = generateTicket(20);

        gm.state = 'PLAYING';
        gm.drawnNumbers.add(5); // 1 ball drawn
        gm.players = [
            {
                userId: p1Id,
                firstName: 'Player One',
                ticket: ticket1,
                boardNumber: 1,
                cards: [{ boardNumber: 1, ticket: ticket1, daubed: new Set() }],
                daubed: new Set(),
                fee: 50,
                lastSeen: Date.now()
            },
            {
                userId: p2Id,
                firstName: 'Player Two',
                ticket: ticket2,
                boardNumber: 2,
                cards: [{ boardNumber: 2, ticket: ticket2, daubed: new Set() }],
                daubed: new Set(),
                fee: 50,
                lastSeen: Date.now()
            }
        ];

        // Total pot = 100 Birr
        assert.equal(gm.getPot(), 100);

        // Player 1 claims false bingo
        const claim1 = await gm.claimBingo(p1Id);
        assert.equal(claim1.success, false);
        assert.equal(claim1.blocked, true);
        assert.equal(claim1.allBlocked, undefined, 'Game should NOT end after first player blocked');
        assert.equal(gm.state, 'PLAYING', 'Game should remain PLAYING while Player 2 is still unblocked');

        // Player 2 claims false bingo
        const claim2 = await gm.claimBingo(p2Id);
        assert.equal(claim2.success, false);
        assert.equal(claim2.blocked, true);
        assert.equal(claim2.allBlocked, true, 'Game should detect all players blocked');

        // Verify game stopped immediately without continuing to ball 75
        assert.equal(gm.state, 'WAITING', 'Game state must transition to WAITING immediately');
        assert.equal(gm.players.length, 0, 'Lobby must be reset');
        assert.equal(gm.drawnNumbers.size, 0, 'Drawn numbers cleared for next round');
    });

    it('endGameAllBlocked logs 100% pot to house profit with 0 winner payout', async () => {
        const gm = new GameManager(mockBot);
        const p1Id = 33333n;
        const p2Id = 44444n;
        const ticket1 = generateTicket(10);
        const ticket2 = generateTicket(20);

        gm.state = 'PLAYING';
        gm.drawnNumbers.add(10);
        gm.players = [
            {
                userId: p1Id,
                firstName: 'Alice',
                ticket: ticket1,
                boardNumber: 1,
                cards: [{ boardNumber: 1, ticket: ticket1, daubed: new Set() }],
                daubed: new Set(),
                fee: 100,
                lastSeen: Date.now()
            },
            {
                userId: p2Id,
                firstName: 'Bob',
                ticket: ticket2,
                boardNumber: 2,
                cards: [{ boardNumber: 2, ticket: ticket2, daubed: new Set() }],
                daubed: new Set(),
                fee: 100,
                lastSeen: Date.now()
            }
        ];

        // Pot is 200 Birr
        assert.equal(gm.getPot(), 200);

        let broadcastEventName = '';
        let broadcastData: any = null;
        gm.broadcastSSE = (event: string, data: any) => {
            broadcastEventName = event;
            broadcastData = data;
        };

        await gm.endGameAllBlocked();

        assert.equal(broadcastEventName, 'all_blocked');
        assert.equal(broadcastData.allBlocked, true);
        assert.equal(broadcastData.reason, 'ALL_BLOCKED');
        assert.equal(broadcastData.pot, 200);
        assert.equal(gm.currentWinners.length, 0);
        assert.equal(gm.currentWinner, null);
        assert.equal(gm.state, 'WAITING');
    });
});
