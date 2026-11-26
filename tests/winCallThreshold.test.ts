import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GameManager } from '../src/game/GameManager';
import { GameRooms } from '../src/game/GameRooms';
import { generateTicket, checkWin } from '../src/game/bingo';

describe('Minimum Calls to Win Threshold Tests', () => {
    const mockBot = {
        api: {
            sendMessage: async () => {},
            editMessageText: async () => {},
            sendPhoto: async () => ({ message_id: 1 })
        }
    } as any;

    it('defaults to 15 calls to win', () => {
        const gm = new GameManager(mockBot, null, 10, 1);
        assert.equal(gm.minCallToWin, 15);
    });

    it('GameRooms propagates minCallToWin to new and existing rooms', () => {
        const gameRooms = new GameRooms(mockBot);
        // Default check
        const initial = gameRooms.getMinCallToWin();
        assert.ok(initial >= 4 && initial <= 50);

        // Update threshold to 12
        gameRooms.setMinCallToWin(12);
        assert.equal(gameRooms.getMinCallToWin(), 12);

        // Get room and verify it has minCallToWin = 12
        const room10 = gameRooms.getRoom(10, 1);
        assert.equal(room10.minCallToWin, 12);

        // Update threshold again to 18 and check existing room is updated immediately
        gameRooms.setMinCallToWin(18);
        assert.equal(gameRooms.getMinCallToWin(), 18);
        assert.equal(room10.minCallToWin, 18);

        // Reset back to 15
        gameRooms.setMinCallToWin(15);
        assert.equal(gameRooms.getMinCallToWin(), 15);
    });

    it('GameRooms clamps out-of-bounds values to [4, 50]', () => {
        const gameRooms = new GameRooms(mockBot);

        // Below 4 clamps to 4
        gameRooms.setMinCallToWin(2);
        assert.equal(gameRooms.getMinCallToWin(), 4);

        // Above 50 clamps to 50
        gameRooms.setMinCallToWin(75);
        assert.equal(gameRooms.getMinCallToWin(), 50);

        // Floating point floored
        gameRooms.setMinCallToWin(14.9);
        assert.equal(gameRooms.getMinCallToWin(), 14);

        // Restore to 15
        gameRooms.setMinCallToWin(15);
    });

    it('prevents winning line before minCallToWin when safe balls exist', async () => {
        const gm = new GameManager(mockBot, null, 10, 1);
        gm.minCallToWin = 10; // Win threshold set to 10
        gm.state = 'PLAYING';

        const userId = 99001n;
        const ticket = generateTicket(5);
        gm.players = [{
            userId,
            ticket,
            cards: [{ boardNumber: 5, ticket, daubed: new Set() }],
            daubed: new Set(),
            fee: 10,
            lastSeen: Date.now(),
            autoPlay: true,
            isBot: false
        }];

        (gm as any).allNumbers = Array.from({ length: 75 }, (_, i) => i + 1);
        (gm as any).drawnNumbers.clear();

        // Draw 9 numbers (draws 1 to 9). All 9 should be safe, so player must not win yet.
        for (let i = 0; i < 9; i++) {
            await (gm as any).drawNumber();

            // Check win status: must not have won yet
            const won = checkWin(ticket, gm.players[0].cards[0].daubed);
            assert.equal(won, false, `Player should NOT win on draw ${i + 1} when minCallToWin is 10`);
        }

        assert.equal(gm.drawnNumbers.size, 9);
    });

    it('allows natural win check starting at minCallToWin', async () => {
        const gm = new GameManager(mockBot, null, 10, 1);
        gm.minCallToWin = 4; // Absolute minimum threshold

        const ticket = generateTicket(1);
        // Put the first 4 numbers of row 0 into drawnNumbers
        for (let col = 0; col < 4; col++) {
            gm.drawnNumbers.add(ticket[0][col]);
        }

        const cardDaubed = new Set(gm.drawnNumbers);
        gm.players = [{
            userId: 12345n,
            ticket,
            cards: [{ boardNumber: 1, ticket, daubed: cardDaubed }],
            daubed: new Set(cardDaubed),
            fee: 10,
            lastSeen: Date.now()
        }];

        const winningBall = ticket[0][4];

        // wouldCauseWin must report true for winningBall
        assert.equal((gm as any).wouldCauseWin(winningBall), true);

        // countSimulatedWinners also reports 1 winner
        assert.equal((gm as any).countSimulatedWinners(winningBall), 1);
    });

    it('uses a per-game randomized effectiveMin >= minCallToWin that stays fixed within a game', () => {
        const gm = new GameManager(mockBot, null, 10, 1);
        gm.minCallToWin = 15;

        const seenEffectiveMins = new Set<number>();
        for (let g = 0; g < 30; g++) {
            gm.drawnNumbers.clear();
            (gm as any).minCallOffset = null;

            const first = (gm as any).getEffectiveMinCallToWin();
            assert.ok(first >= 15 && first <= 23, `effectiveMin ${first} must be in [15, 23]`);

            // Simulating subsequent draws in the same game must keep the same effectiveMin
            gm.drawnNumbers.add(1);
            const second = (gm as any).getEffectiveMinCallToWin();
            assert.equal(second, first, 'effectiveMin must remain constant during the same game');

            seenEffectiveMins.add(first);
        }

        assert.ok(seenEffectiveMins.size > 1, 'effectiveMin should vary across games');
    });

    it('steered modes (house / real_players) do not force immediate win when non-winning advancing balls exist', async () => {
        const ticket = generateTicket(7);
        const row0 = ticket[0];
        const winningBall = row0[4];
        const nonWinningCardBall = ticket[1][0] !== row0[0] ? ticket[1][0] : ticket[1][1];

        for (const mode of ['house', 'real_players'] as const) {
            let sawNonWinningPick = false;
            const isBot = mode === 'house';

            for (let attempt = 0; attempt < 25; attempt++) {
                const gm = new GameManager(mockBot, null, 10, 1);
                gm.winnerSelection = mode;
                gm.state = 'PLAYING';
                gm.minCallToWin = 4;
                (gm as any).minCallOffset = 0;

                gm.drawnNumbers = new Set(row0.slice(0, 4));
                const daubed = new Set(gm.drawnNumbers);

                gm.players = [
                    {
                        userId: 1001n,
                        ticket,
                        cards: [{ boardNumber: 7, ticket, daubed }],
                        daubed: new Set(daubed),
                        fee: 10,
                        lastSeen: Date.now(),
                        isBot
                    },
                    {
                        userId: 1002n,
                        ticket: generateTicket(8),
                        cards: [{ boardNumber: 8, ticket: generateTicket(8), daubed: new Set() }],
                        daubed: new Set(),
                        fee: 10,
                        lastSeen: Date.now(),
                        isBot: !isBot
                    }
                ];

                // Pool contains both a winning ball and a non-winning advancing ball for the prioritized player
                (gm as any).allNumbers = [winningBall, nonWinningCardBall];
                await (gm as any).drawNumber();

                const drawnBall = Array.from(gm.drawnNumbers).at(-1)!;
                if (drawnBall === nonWinningCardBall) {
                    sawNonWinningPick = true;
                    break;
                }
            }

            assert.equal(
                sawNonWinningPick,
                true,
                `${mode} mode should draw from advancing non-winning balls too rather than always forcing winningBall`
            );
        }
    });
});
