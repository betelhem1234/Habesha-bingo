import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GameManager } from '../src/game/GameManager';
import { GameRooms } from '../src/game/GameRooms';
import { generateTicket, checkWinDetails } from '../src/game/bingo';

describe('GameManager Winner and Claim Mechanics', () => {
    // Mock bot
    const mockBot = {
        api: {
            sendMessage: async () => {},
            editMessageText: async () => {}
        }
    } as any;

    it('manual daub does not trigger a win automatically', async () => {
        const gm = new GameManager(mockBot);
        const userId = 12345n;
        const ticket = generateTicket(50);
        
        // Setup player manually in playing state
        gm.state = 'PLAYING';
        gm.players = [{
            userId,
            ticket,
            boardNumber: 1,
            cards: [{ boardNumber: 1, ticket, daubed: new Set() }],
            daubed: new Set(),
            fee: 10,
            lastSeen: Date.now()
        }];

        // Draw 17 numbers, including a winning row (row 0)
        const row0Nums = ticket[0];
        row0Nums.forEach(n => gm.drawnNumbers.add(n));
        for (let i = 1; i <= 75; i++) {
            if (gm.drawnNumbers.size >= 17) break;
            gm.drawnNumbers.add(i);
        }

        // Daub the 5 numbers in row 0
        for (const num of row0Nums) {
            const res = await gm.daubNumber(userId, num);
            assert.equal(res.success, true);
            // Must NOT trigger win directly from daub!
            assert.equal(res.msg, undefined);
        }

        // Game must still be PLAYING because user has NOT clicked Bingo button yet!
        assert.equal(gm.state, 'PLAYING');
        assert.equal(gm.currentWinner, null);
    });

    it('rejects claim if no valid winning pattern exists and blocks player', async () => {
        const gm = new GameManager(mockBot);
        const userId = 12345n;
        const ticket = generateTicket(50);

        gm.state = 'PLAYING';
        gm.players = [{
            userId,
            ticket,
            boardNumber: 1,
            cards: [{ boardNumber: 1, ticket, daubed: new Set() }],
            daubed: new Set(),
            fee: 10,
            lastSeen: Date.now()
        }];

        const ticketNums = new Set<number>();
        for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 5; c++) {
                ticketNums.add(ticket[r][c]);
            }
        }
        // Draw 17 numbers that are NOT on this ticket
        for (let i = 1; i <= 75; i++) {
            if (!ticketNums.has(i)) {
                gm.drawnNumbers.add(i);
                if (gm.drawnNumbers.size >= 17) break;
            }
        }

        const res = await gm.claimBingo(userId);
        assert.equal(res.success, false);
        assert.equal(res.blocked, true);
        assert.equal(gm.players[0].isBlocked, true);
        assert.match(res.msg, /False Bingo/i);
    });

    it('rejects early claim without winning pattern as false bingo and blocks player', async () => {
        const gm = new GameManager(mockBot);
        const userId = 12345n;
        const ticket = generateTicket(50);

        gm.state = 'PLAYING';
        gm.players = [{
            userId,
            ticket,
            boardNumber: 1,
            cards: [{ boardNumber: 1, ticket, daubed: new Set() }],
            daubed: new Set(),
            fee: 10,
            lastSeen: Date.now()
        }];

        // Only 10 numbers drawn
        for (let i = 1; i <= 10; i++) {
            gm.drawnNumbers.add(i);
        }

        const res = await gm.claimBingo(userId);
        assert.equal(res.success, false);
        assert.equal(res.blocked, true);
        assert.equal(gm.players[0].isBlocked, true);
        assert.match(res.msg, /False Bingo/i);

        // Verify blocked player cannot daub numbers
        const daubRes = await gm.daubNumber(userId, 1);
        assert.equal(daubRes.success, false);
        assert.match(daubRes.msg!, /blocked/i);

        // Verify blocked player cannot claim again
        const secondClaim = await gm.claimBingo(userId);
        assert.equal(secondClaim.success, false);
        assert.equal(secondClaim.blocked, true);
    });

    it('4 corners pattern is recognized as a valid win on claim', async () => {
        const gm = new GameManager(mockBot);
        const userId = 99999n;
        const ticket = generateTicket(88);

        gm.state = 'PLAYING';
        gm.players = [{
            userId,
            ticket,
            boardNumber: 1,
            cards: [{ boardNumber: 1, ticket, daubed: new Set() }],
            daubed: new Set(),
            fee: 10,
            lastSeen: Date.now()
        }];

        const ticketNums = new Set<number>();
        for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 5; c++) {
                ticketNums.add(ticket[r][c]);
            }
        }

        // Draw 3 of the 4 corners
        const first3Corners = [ticket[0][0], ticket[0][4], ticket[4][0]];
        first3Corners.forEach(n => gm.drawnNumbers.add(n));
        // Fill up to 16 calls using numbers not on the ticket
        for (let i = 1; i <= 75; i++) {
            if (!ticketNums.has(i)) {
                gm.drawnNumbers.add(i);
                if (gm.drawnNumbers.size >= 16) break;
            }
        }
        // Draw the 4th corner as the 17th ball (current ball)!
        gm.drawnNumbers.add(ticket[4][4]);

        const res = await gm.claimBingo(userId);
        assert.equal(res.success, true);
        assert.equal(res.msg, 'BINGO!');
        assert.ok(res.winningCells);
        assert.equal(res.winningCells.length, 4);
    });

    it('rejects late claim if player missed their turn on an earlier call', async () => {
        const gm = new GameManager(mockBot);
        const userId = 77777n;
        const ticket = generateTicket(44);

        gm.state = 'PLAYING';
        gm.players = [{
            userId,
            ticket,
            boardNumber: 1,
            cards: [{ boardNumber: 1, ticket, daubed: new Set() }],
            daubed: new Set(),
            fee: 10,
            lastSeen: Date.now()
        }];

        const ticketNums = new Set<number>();
        for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 5; c++) {
                ticketNums.add(ticket[r][c]);
            }
        }

        // Complete Row 0 on Call #17
        const row0 = ticket[0];
        row0.forEach(n => gm.drawnNumbers.add(n));
        for (let i = 1; i <= 75; i++) {
            if (!ticketNums.has(i)) {
                gm.drawnNumbers.add(i);
                if (gm.drawnNumbers.size >= 17) break;
            }
        }

        // Draw Call #18 which is NOT on Row 0 (e.g. an uncalled number not on the ticket)
        let call18 = 0;
        for (let i = 1; i <= 75; i++) {
            if (!ticketNums.has(i) && !gm.drawnNumbers.has(i)) {
                call18 = i;
                break;
            }
        }
        gm.drawnNumbers.add(call18);

        // Player now tries to claim on Call #18! Row 0 was completed on Call #17.
        const res = await gm.claimBingo(userId);
        assert.equal(res.success, false);
        assert.equal(res.late, true);
        assert.equal(res.blocked, true);
        assert.equal(gm.players[0].isBlocked, true);
        assert.match(res.msg, /Late Bingo/i);
    });

    it('accepts win on a new line even if an earlier line was missed', async () => {
        const gm = new GameManager(mockBot);
        const userId = 88888n;
        const ticket = generateTicket(55);

        gm.state = 'PLAYING';
        gm.players = [{
            userId,
            ticket,
            boardNumber: 1,
            cards: [{ boardNumber: 1, ticket, daubed: new Set() }],
            daubed: new Set(),
            fee: 10,
            lastSeen: Date.now()
        }];

        const ticketNums = new Set<number>();
        for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 5; c++) {
                ticketNums.add(ticket[r][c]);
            }
        }

        // Complete Row 0 early (first 5 numbers)
        ticket[0].forEach(n => gm.drawnNumbers.add(n));
        for (let i = 1; i <= 75; i++) {
            if (!ticketNums.has(i)) {
                gm.drawnNumbers.add(i);
                if (gm.drawnNumbers.size >= 17) break;
            }
        }

        // Now draw all numbers for Column 4 except one
        const col4Nums = [ticket[0][4], ticket[1][4], ticket[2][4], ticket[3][4]];
        col4Nums.forEach(n => gm.drawnNumbers.add(n));

        // Finally, draw ticket[4][4] as the current ball!
        gm.drawnNumbers.add(ticket[4][4]);

        // Player claims! Even though Row 0 was missed earlier, Column 4 is freshly completed by the current ball!
        const res = await gm.claimBingo(userId);
        assert.equal(res.success, true);
        assert.equal(res.msg, 'BINGO!');
    });

    it('blocked state is cleared when game starts', async () => {
        const gm = new GameManager(mockBot);
        const userId = 55555n;
        const ticket = generateTicket(20);

        gm.state = 'WAITING';
        gm.players = [{
            userId,
            ticket,
            boardNumber: 1,
            cards: [{ boardNumber: 1, ticket, daubed: new Set(), isBlocked: true }],
            daubed: new Set(),
            fee: 10,
            isBlocked: true,
            lastSeen: Date.now()
        }];

        await gm.startGame();
        assert.equal(gm.players[0].isBlocked, false);
        assert.equal(gm.players[0].cards[0].isBlocked, false);
        await gm.forceReset();
    });

    it('caller voice can be controlled and persisted by admin via GameRooms', () => {
        const gr = new GameRooms(mockBot);
        // Default is male
        const initial = gr.getCallerVoice();
        assert.ok(initial === 'male' || initial === 'female');

        // Admin switches to female
        gr.setCallerVoice('female');
        assert.equal(gr.getCallerVoice(), 'female');

        // Admin switches to male
        gr.setCallerVoice('male');
        assert.equal(gr.getCallerVoice(), 'male');
    });

    it('valid winning pattern is accepted on Call #15', async () => {
        const gm = new GameManager(mockBot);
        const userId = 33333n;
        const ticket = generateTicket(30);

        gm.state = 'PLAYING';
        gm.players = [{
            userId,
            ticket,
            boardNumber: 1,
            cards: [{ boardNumber: 1, ticket, daubed: new Set() }],
            daubed: new Set(),
            fee: 10,
            lastSeen: Date.now()
        }];

        const ticketNums = new Set<number>();
        for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 5; c++) {
                ticketNums.add(ticket[r][c]);
            }
        }

        // Draw 4 of 5 numbers for Row 0
        const row0Nums = ticket[0];
        for (let i = 0; i < 4; i++) {
            gm.drawnNumbers.add(row0Nums[i]);
        }

        // Fill non-ticket numbers so total drawn count reaches exactly 14
        for (let i = 1; i <= 75; i++) {
            if (!ticketNums.has(i)) {
                gm.drawnNumbers.add(i);
                if (gm.drawnNumbers.size >= 14) break;
            }
        }
        assert.equal(gm.drawnNumbers.size, 14);

        // Draw the 5th number of Row 0 as the 15th ball!
        gm.drawnNumbers.add(row0Nums[4]);
        assert.equal(gm.drawnNumbers.size, 15);

        // Claim on Call 15
        const res = await gm.claimBingo(userId);
        assert.equal(res.success, true);
        assert.equal(res.msg, 'BINGO!');
    });

    it('divides 80% jackpot equally between two simultaneous winners and credits each 50%', async () => {
        const gm = new GameManager(mockBot);
        const p1Id = 11111n;
        const p2Id = 22222n;
        const ticket1 = generateTicket(10);
        const ticket2 = generateTicket(20);

        gm.state = 'PLAYING';
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

        // Total pot = 100 Birr. Total 80% winner jackpot = 80 Birr.
        assert.equal(gm.getPot(), 100);

        const currentBall = 75;
        // Draw 4 of 5 numbers for Row 0 of both tickets
        for (let i = 0; i < 4; i++) {
            gm.drawnNumbers.add(ticket1[0][i]);
            gm.drawnNumbers.add(ticket2[0][i]);
        }
        // Overwrite 5th number so both tickets are freshly completed by currentBall
        ticket1[0][4] = currentBall;
        ticket2[0][4] = currentBall;
        gm.drawnNumbers.add(currentBall);

        // Player 1 claims
        const claim1 = await gm.claimBingo(p1Id);
        assert.equal(claim1.success, true);

        // Player 2 claims simultaneously
        const claim2 = await gm.claimBingo(p2Id);
        assert.equal(claim2.success, true);

        // Verify:
        // 1. Both winners are recorded in currentWinners
        assert.equal(gm.currentWinners.length, 2);
        // 2. 80 Birr is split 50/50 -> 40 Birr each
        assert.equal(gm.currentWinners[0].amount, 40);
        assert.equal(gm.currentWinners[1].amount, 40);
        // 3. User IDs match Player 1 and Player 2
        assert.equal(gm.currentWinners[0].userId, p1Id.toString());
        assert.equal(gm.currentWinners[1].userId, p2Id.toString());
        // 4. Game state transitions to WAITING
        assert.equal(gm.state, 'WAITING');
    });
});

