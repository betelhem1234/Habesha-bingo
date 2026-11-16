import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTicket, combineSeed, BingoTicket } from '../src/game/bingo';
import {
    getBoardShuffleSeed,
    reshuffleBoards,
    getAutoReshuffleSetting,
    setAutoReshuffleSetting,
    getBoardShuffleStatus,
    onGameCompletedCheckAutoReshuffle
} from '../src/settings';

test('Board Numbers Reshuffle & Anti-Memorization System Tests', async (t) => {
    await t.test('combineSeed returns boardNumber directly when shuffleSalt is 0 (backward compatibility)', () => {
        assert.equal(combineSeed(1, 0), 1);
        assert.equal(combineSeed(7, 0), 7);
        assert.equal(combineSeed(42, 0), 42);
        assert.equal(combineSeed(500, 0), 500);
    });

    await t.test('combineSeed generates distinct pseudo-random seeds when shuffleSalt is non-zero', () => {
        const seed1 = combineSeed(7, 1);
        const seed2 = combineSeed(7, 2);
        const seed3 = combineSeed(8, 1);

        assert.notEqual(seed1, 7);
        assert.notEqual(seed1, seed2);
        assert.notEqual(seed1, seed3);
        assert.ok(seed1 > 0);
        assert.ok(seed2 > 0);
    });

    await t.test('generateTicket produces different cards when board is reshuffled', () => {
        const board7_salt0 = generateTicket(7, 0);
        const board7_salt1 = generateTicket(7, 1);
        const board7_salt2 = generateTicket(7, 2);

        // All must be valid 5x5 tickets
        assert.equal(board7_salt0.length, 5);
        assert.equal(board7_salt1.length, 5);
        assert.equal(board7_salt2.length, 5);

        // Center space must be 0 (Free)
        assert.equal(board7_salt0[2][2], 0);
        assert.equal(board7_salt1[2][2], 0);
        assert.equal(board7_salt2[2][2], 0);

        // Compare card contents: numbers must differ across salts
        const flat0 = board7_salt0.flat().join(',');
        const flat1 = board7_salt1.flat().join(',');
        const flat2 = board7_salt2.flat().join(',');

        assert.notEqual(flat0, flat1, 'Salt 1 must produce a completely different card than Salt 0');
        assert.notEqual(flat1, flat2, 'Salt 2 must produce a completely different card than Salt 1');
    });

    await t.test('reshuffled tickets strictly satisfy all official B-I-N-G-O rules and column ranges', () => {
        const ranges = [
            { min: 1, max: 15 },
            { min: 16, max: 30 },
            { min: 31, max: 45 },
            { min: 46, max: 60 },
            { min: 61, max: 75 }
        ];

        // Test across 50 boards with salt 999
        for (let b = 1; b <= 50; b++) {
            const ticket = generateTicket(b, 999);
            for (let col = 0; col < 5; col++) {
                const colNums: number[] = [];
                for (let row = 0; row < 5; row++) {
                    const num = ticket[row][col];
                    if (row === 2 && col === 2) {
                        assert.equal(num, 0, 'Center must be 0');
                    } else {
                        assert.ok(num >= ranges[col].min && num <= ranges[col].max, `Column ${col} number ${num} out of range`);
                        colNums.push(num);
                    }
                }
                const set = new Set(colNums);
                assert.equal(set.size, colNums.length, `Column ${col} has duplicate numbers`);
            }
        }
    });

    await t.test('reshuffleBoards() generates new seed and resets games counter', () => {
        const initialSeed = getBoardShuffleSeed();
        const res = reshuffleBoards();

        assert.ok(res.seed > 0);
        assert.equal(res.seed, getBoardShuffleSeed());
        const status = getBoardShuffleStatus();
        assert.equal(status.currentSeed, res.seed);
        assert.equal(status.gamesSinceLastShuffle, 0);
        assert.ok(status.lastReshuffledAt !== null);
    });

    await t.test('Auto-reshuffle trigger works correctly according to configured frequency', () => {
        // Set mode to off
        setAutoReshuffleSetting('off');
        assert.equal(getAutoReshuffleSetting(), 'off');
        assert.equal(onGameCompletedCheckAutoReshuffle(), false);

        // Set mode to every_game
        setAutoReshuffleSetting('every_game');
        assert.equal(getAutoReshuffleSetting(), 'every_game');
        const seedBefore = getBoardShuffleSeed();
        const triggered = onGameCompletedCheckAutoReshuffle();
        assert.equal(triggered, true);
        assert.notEqual(getBoardShuffleSeed(), seedBefore);

        // Set mode to every_5
        setAutoReshuffleSetting('every_5');
        // Reset counter
        reshuffleBoards();
        assert.equal(onGameCompletedCheckAutoReshuffle(), false); // 1
        assert.equal(onGameCompletedCheckAutoReshuffle(), false); // 2
        assert.equal(onGameCompletedCheckAutoReshuffle(), false); // 3
        assert.equal(onGameCompletedCheckAutoReshuffle(), false); // 4
        assert.equal(onGameCompletedCheckAutoReshuffle(), true);  // 5 -> triggers reshuffle
    });

    await t.test('Client preview algorithm produces 100% identical numbers to server generation', () => {
        // Emulate client formula
        function mulberry32Client(seed: number) {
            return function () {
                seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
                let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
                t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
                return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
            };
        }

        function combineSeedClient(boardNumber: number, shuffleSalt: number) {
            if (!shuffleSalt) return boardNumber;
            let h = (boardNumber ^ Math.imul(shuffleSalt, 0x5DEECE66)) >>> 0;
            h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
            h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
            return (h ^ (h >>> 16)) >>> 0;
        }

        function generateTicketClient(boardNum: number, shuffleSalt: number) {
            const effectiveSeed = combineSeedClient(boardNum, shuffleSalt);
            const rand = mulberry32Client(effectiveSeed);
            const ticket: number[][] = [];
            for (let i = 0; i < 5; i++) ticket[i] = [];
            const ranges = [
                { min: 1, max: 15 }, { min: 16, max: 30 }, { min: 31, max: 45 }, { min: 46, max: 60 }, { min: 61, max: 75 }
            ];
            for (let col = 0; col < 5; col++) {
                const numbers = new Set<number>();
                while (numbers.size < 5) {
                    const num = Math.floor(rand() * (ranges[col].max - ranges[col].min + 1)) + ranges[col].min;
                    numbers.add(num);
                }
                const colNums = Array.from(numbers);
                for (let row = 0; row < 5; row++) {
                    if (col === 2 && row === 2) ticket[row][col] = 0;
                    else ticket[row][col] = colNums[row];
                }
            }
            return ticket;
        }

        // Compare client and server across multiple boards and random salts
        const testSalts = [0, 42, 987654, 214748364];
        for (const salt of testSalts) {
            for (let b = 1; b <= 10; b++) {
                const serverTicket = generateTicket(b, salt);
                const clientTicket = generateTicketClient(b, salt);
                assert.deepEqual(serverTicket, clientTicket, `Board ${b} with salt ${salt} must match between server and client`);
            }
        }
    });
});
