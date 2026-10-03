import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateTicket, getNumberName, checkWin, checkWinDetails } from '../src/game/bingo';

describe('Bingo Game Logic', () => {
    it('generates a valid 5x5 ticket with free center space', () => {
        const ticket = generateTicket(101);
        assert.equal(ticket.length, 5);
        for (let r = 0; r < 5; r++) {
            assert.equal(ticket[r].length, 5);
        }
        // Center cell must be FREE (0)
        assert.equal(ticket[2][2], 0);

        // B column (1-15)
        for (let r = 0; r < 5; r++) {
            assert.ok(ticket[r][0] >= 1 && ticket[r][0] <= 15);
        }
        // I column (16-30)
        for (let r = 0; r < 5; r++) {
            assert.ok(ticket[r][1] >= 16 && ticket[r][1] <= 30);
        }
        // O column (61-75)
        for (let r = 0; r < 5; r++) {
            assert.ok(ticket[r][4] >= 61 && ticket[r][4] <= 75);
        }
    });

    it('generates deterministic cards with the same seed', () => {
        const ticket1 = generateTicket(42);
        const ticket2 = generateTicket(42);
        assert.deepEqual(ticket1, ticket2);
    });

    it('formats ball names with column prefixes', () => {
        assert.equal(getNumberName(1), 'B-1');
        assert.equal(getNumberName(15), 'B-15');
        assert.equal(getNumberName(16), 'I-16');
        assert.equal(getNumberName(30), 'I-30');
        assert.equal(getNumberName(31), 'N-31');
        assert.equal(getNumberName(46), 'G-46');
        assert.equal(getNumberName(75), 'O-75');
    });

    it('correctly detects a row win', () => {
        const ticket = generateTicket(10);
        const row0 = new Set<number>(ticket[0]);
        assert.equal(checkWin(ticket, row0), true);
    });

    it('correctly detects no win when incomplete', () => {
        const ticket = generateTicket(10);
        const incomplete = new Set<number>([ticket[0][0], ticket[0][1]]);
        assert.equal(checkWin(ticket, incomplete), false);
    });

    it('handles multiple cards independently', () => {
        const board1 = generateTicket(5);
        const board2 = generateTicket(25);
        
        // Ensure tickets are distinct
        assert.notDeepEqual(board1, board2);

        // Win numbers for board1
        const board1WinNumbers = new Set<number>(board1[0]);
        assert.equal(checkWin(board1, board1WinNumbers), true);
    });

    it('returns correct win details with winningCells', () => {
        const ticket = generateTicket(77);
        // Column 0 win
        const col0 = new Set<number>([ticket[0][0], ticket[1][0], ticket[2][0], ticket[3][0], ticket[4][0]]);
        const colRes = checkWinDetails(ticket, col0);
        assert.equal(colRes.hasWon, true);
        assert.equal(colRes.winningCells.length, 5);
        assert.deepEqual(colRes.winningCells, [
            { row: 0, col: 0 },
            { row: 1, col: 0 },
            { row: 2, col: 0 },
            { row: 3, col: 0 },
            { row: 4, col: 0 }
        ]);

        // Main diagonal win (note center [2][2] is 0 / free)
        const diag = new Set<number>([ticket[0][0], ticket[1][1], ticket[3][3], ticket[4][4]]);
        const diagRes = checkWinDetails(ticket, diag);
        assert.equal(diagRes.hasWon, true);
        assert.equal(diagRes.winningCells.length, 5);

        // Anti diagonal win
        const antiDiag = new Set<number>([ticket[0][4], ticket[1][3], ticket[3][1], ticket[4][0]]);
        const antiRes = checkWinDetails(ticket, antiDiag);
        assert.equal(antiRes.hasWon, true);
        assert.equal(antiRes.winningCells.length, 5);

        // 4 corners win
        const corners = new Set<number>([ticket[0][0], ticket[0][4], ticket[4][0], ticket[4][4]]);
        const cornersRes = checkWinDetails(ticket, corners);
        assert.equal(cornersRes.hasWon, true);
        assert.equal(cornersRes.winningCells.length, 4);
        assert.deepEqual(cornersRes.winningCells, [
            { row: 0, col: 0 },
            { row: 0, col: 4 },
            { row: 4, col: 0 },
            { row: 4, col: 4 }
        ]);

        // No win
        const empty = new Set<number>();
        const noRes = checkWinDetails(ticket, empty);
        assert.equal(noRes.hasWon, false);
        assert.equal(noRes.winningCells.length, 0);
    });
});
