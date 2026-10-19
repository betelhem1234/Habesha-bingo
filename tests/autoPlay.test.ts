import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GameManager } from '../src/game/GameManager';
import { generateTicket } from '../src/game/bingo';

describe('Auto-Play Lobby Preselection & Server Safety Net Tests', () => {
    const mockBot = {
        api: {
            sendMessage: async () => {},
            editMessageText: async () => {},
            sendPhoto: async () => ({ message_id: 1 })
        }
    } as any;

    it('setAutoPlay updates player autoPlay state and refreshes lastSeen', () => {
        const gm = new GameManager(mockBot, null, 10, 1);
        const userId = 77777n;
        const ticket = generateTicket(10);
        const initialSeen = Date.now() - 5000;

        gm.players = [{
            userId,
            ticket,
            cards: [{ boardNumber: 10, ticket, daubed: new Set() }],
            daubed: new Set(),
            fee: 10,
            lastSeen: initialSeen,
            autoPlay: false
        }];

        // Enable auto-play
        const updatedOn = gm.setAutoPlay(userId, true);
        assert.equal(updatedOn, true);
        assert.equal(gm.players[0].autoPlay, true);
        assert.ok(gm.players[0].lastSeen > initialSeen, 'lastSeen must be updated on auto-play toggle');

        // Disable auto-play
        const updatedOff = gm.setAutoPlay(userId, false);
        assert.equal(updatedOff, true);
        assert.equal(gm.players[0].autoPlay, false);

        // Unknown player returns false
        assert.equal(gm.setAutoPlay(999999n, true), false);
    });

    it('drawNumber automatically daubs cards for human players with autoPlay enabled', async () => {
        const gm = new GameManager(mockBot, null, 10, 1);
        const userId = 88888n;
        const ticket = generateTicket(20);

        gm.state = 'PLAYING';
        gm.players = [{
            userId,
            ticket,
            cards: [{ boardNumber: 20, ticket, daubed: new Set() }],
            daubed: new Set(),
            fee: 10,
            lastSeen: Date.now(),
            autoPlay: true,
            isBot: false
        }];

        // Find a number on the player's card
        const cardNum = ticket[0][0];
        assert.ok(cardNum > 0);

        // Force this number to be drawn next
        gm.allNumbers = [cardNum];
        // Draw the number
        await gm.drawNumber();

        // Player's card must have been automatically daubed!
        assert.ok(gm.players[0].daubed.has(cardNum), 'p.daubed must contain the drawn number');
        assert.ok(gm.players[0].cards[0].daubed.has(cardNum), 'card.daubed must contain the drawn number');
    });

    it('drawNumber does NOT auto-daub for players with autoPlay disabled (manual play)', async () => {
        const gm = new GameManager(mockBot, null, 10, 1);
        const userId = 99999n;
        const ticket = generateTicket(30);

        gm.state = 'PLAYING';
        gm.players = [{
            userId,
            ticket,
            cards: [{ boardNumber: 30, ticket, daubed: new Set() }],
            daubed: new Set(),
            fee: 10,
            lastSeen: Date.now(),
            autoPlay: false, // MANUAL PLAY
            isBot: false
        }];

        const cardNum = ticket[0][0];
        gm.allNumbers = [cardNum];
        await gm.drawNumber();

        // Must NOT be daubed automatically
        assert.equal(gm.players[0].daubed.has(cardNum), false, 'Manual player must not be auto-daubed');
        assert.equal(gm.players[0].cards[0].daubed.has(cardNum), false);
    });

    it('server auto-claims Bingo on fresh winning ball for human players with autoPlay enabled', async () => {
        const gm = new GameManager(mockBot, null, 10, 1);
        const userId = 55555n;
        const ticket = generateTicket(40);

        gm.state = 'PLAYING';
        gm.players = [{
            userId,
            ticket,
            cards: [{ boardNumber: 40, ticket, daubed: new Set() }],
            daubed: new Set(),
            fee: 10,
            firstName: 'Abebe',
            lastSeen: Date.now(),
            autoPlay: true,
            isBot: false
        }];

        // Fill 14 non-winning numbers first so the game reaches draw 15
        const row0Nums = ticket[0]; // 5 numbers completing row 0
        const winningBall = row0Nums[4]; // last ball completing the line
        const priorRowNums = row0Nums.slice(0, 4);

        // Add 4 of the row numbers to drawnNumbers
        priorRowNums.forEach(n => {
            gm.drawnNumbers.add(n);
            gm.players[0].daubed.add(n);
            gm.players[0].cards[0].daubed.add(n);
        });

        // Add dummy drawn numbers to simulate 14 calls
        for (let i = 1; i <= 75; i++) {
            if (gm.drawnNumbers.size >= 14) break;
            if (!row0Nums.includes(i)) {
                gm.drawnNumbers.add(i);
            }
        }

        // Set next ball to winningBall
        gm.allNumbers = [winningBall];

        // Draw the 15th ball (winningBall)
        await gm.drawNumber();

        // The player must have been automatically registered in pending winners!
        assert.ok(
            gm.pendingWinners.some(w => w.player.userId === userId),
            'Player with autoPlay must be automatically claimed into pendingWinners'
        );
    });

    it('multi-board player with autoPlay enabled daubs and checks across both cards', async () => {
        const gm = new GameManager(mockBot, null, 10, 1);
        const userId = 44444n;
        const card1 = { boardNumber: 1, ticket: generateTicket(1), daubed: new Set<number>() };
        const card2 = { boardNumber: 2, ticket: generateTicket(2), daubed: new Set<number>() };

        gm.state = 'PLAYING';
        gm.players = [{
            userId,
            ticket: card1.ticket,
            cards: [card1, card2],
            daubed: new Set(),
            fee: 20,
            firstName: 'Kebede',
            lastSeen: Date.now(),
            autoPlay: true,
            isBot: false
        }];

        const num1 = card1.ticket[1][1];
        const num2 = card2.ticket[2][2];

        // Draw num1
        gm.allNumbers = [num1];
        await gm.drawNumber();
        assert.ok(card1.daubed.has(num1), 'Card 1 must have num1 daubed');

        // Draw num2
        gm.allNumbers = [num2];
        await gm.drawNumber();
        assert.ok(card2.daubed.has(num2), 'Card 2 must have num2 daubed');
    });
});
