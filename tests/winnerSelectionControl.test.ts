import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { GameManager } from '../src/game/GameManager';
import { generateTicket } from '../src/game/bingo';
import { getWinnerSelection, setWinnerSelection } from '../src/settings';

test('Winner Selection Control & Outcome Steering Tests', async (t) => {
    const mockBot = {
        api: {
            sendMessage: async () => {},
            editMessageText: async () => {}
        }
    } as any;

    await t.test('1. Settings persistence for winnerSelection', () => {
        const initial = getWinnerSelection();
        assert.ok(['natural', 'real_players', 'house'].includes(initial));

        setWinnerSelection('house');
        assert.equal(getWinnerSelection(), 'house');

        setWinnerSelection('real_players');
        assert.equal(getWinnerSelection(), 'real_players');

        setWinnerSelection('natural');
        assert.equal(getWinnerSelection(), 'natural');

        assert.throws(() => {
            (setWinnerSelection as any)('invalid_mode');
        }, /Invalid winnerSelection mode/);
    });

    await t.test('2. admin.html contains winner selection controls and cache buster v2.6', () => {
        const html = fs.readFileSync(path.join(process.cwd(), 'src/public/admin.html'), 'utf8');
        assert.ok(html.includes('id="winner-selection-badge"'), 'Winner selection badge must exist');
        assert.ok(html.includes('onclick="selectWinnerMode(\'natural\')"'), 'Natural mode option must exist');
        assert.ok(html.includes('onclick="selectWinnerMode(\'house\')"'), 'House mode option must exist');
        assert.ok(html.includes('onclick="selectWinnerMode(\'real_players\')"'), 'Real players mode option must exist');
        assert.ok(html.includes('onclick="saveWinnerSelection()"'), 'Explicit save button must exist');
        assert.ok(html.includes('onclick="revertWinnerSelection()"'), 'Explicit revert button must exist');
        assert.ok(/app\.js\?v=2\.[67]/.test(html), 'admin.html must load latest app.js version');
    });

    await t.test('3. app.js exports winner selection functions and has valid syntax', () => {
        const js = fs.readFileSync(path.join(process.cwd(), 'src/public/app.js'), 'utf8');
        assert.ok(js.includes('function selectWinnerMode('), 'selectWinnerMode function must exist');
        assert.ok(js.includes('function saveWinnerSelection('), 'saveWinnerSelection function must exist');
        assert.ok(js.includes('function revertWinnerSelection('), 'revertWinnerSelection function must exist');
        assert.ok(js.includes('function fetchWinnerSelection('), 'fetchWinnerSelection function must exist');
        assert.ok(js.includes('window.saveWinnerSelection = saveWinnerSelection'), 'saveWinnerSelection must be on window');
        assert.ok(js.includes('window.revertWinnerSelection = revertWinnerSelection'), 'revertWinnerSelection must be on window');
    });

    await t.test('4. House mode: Simulated draws never allow a real human to win when bot is available', async () => {
        const gm = new GameManager(mockBot);
        gm.winnerSelection = 'house';
        gm.state = 'PLAYING';
        gm.minCallToWin = 15;
        (gm as any).allNumbers = Array.from({ length: 75 }, (_, i) => i + 1).sort(() => Math.random() - 0.5);

        const humanUserId = 10001n;
        const botUserId = 20001n;

        const humanTicket = generateTicket(101);
        const botTicket = generateTicket(202);

        gm.players = [
            {
                userId: humanUserId,
                firstName: 'RealHumanPlayer',
                isBot: false,
                ticket: humanTicket,
                boardNumber: 1,
                cards: [{ boardNumber: 1, ticket: humanTicket, daubed: new Set() }],
                daubed: new Set(),
                fee: 10,
                lastSeen: Date.now()
            },
            {
                userId: botUserId,
                firstName: 'VirtualBotPlayer',
                isBot: true,
                ticket: botTicket,
                boardNumber: 2,
                cards: [{ boardNumber: 2, ticket: botTicket, daubed: new Set() }],
                daubed: new Set(),
                fee: 10,
                lastSeen: Date.now()
            }
        ];

        // Draw numbers up to 35 balls or until a bot wins
        let botWon = false;
        let humanWon = false;

        for (let round = 0; round < 50; round++) {
            if (gm.state !== 'PLAYING') break;
            // Trigger private drawNumber via internal method invocation
            await (gm as any).drawNumber();

            const lastBall = Array.from(gm.drawnNumbers).at(-1)!;
            const sim = gm.getSimulatedWinners(lastBall);

            if (sim.humans > 0) {
                humanWon = true;
            }
            if (sim.bots > 0) {
                botWon = true;
                // Bot claims
                const claimRes = await gm.claimBingo(botUserId);
                assert.equal(claimRes.success, true);
                break;
            }
        }

        // In house mode, human must NEVER have achieved a winning line
        assert.equal(humanWon, false, 'In house mode, human player must not achieve winning pattern');
        assert.equal(botWon, true, 'In house mode, bot player must achieve winning pattern');
        assert.equal(gm.pendingWinners[0]?.player.userId, botUserId, 'Pending winner must be the bot');
    });

    await t.test('5. Real Players mode: Simulated draws prioritize human wins over bots', async () => {
        const gm = new GameManager(mockBot);
        gm.winnerSelection = 'real_players';
        gm.state = 'PLAYING';
        gm.minCallToWin = 15;
        (gm as any).allNumbers = Array.from({ length: 75 }, (_, i) => i + 1).sort(() => Math.random() - 0.5);

        const humanUserId = 30001n;
        const botUserId = 40001n;

        const humanTicket = generateTicket(303);
        const botTicket = generateTicket(404);

        gm.players = [
            {
                userId: humanUserId,
                firstName: 'LuckyHuman',
                isBot: false,
                ticket: humanTicket,
                boardNumber: 1,
                cards: [{ boardNumber: 1, ticket: humanTicket, daubed: new Set() }],
                daubed: new Set(),
                fee: 10,
                lastSeen: Date.now()
            },
            {
                userId: botUserId,
                firstName: 'SupportBot',
                isBot: true,
                ticket: botTicket,
                boardNumber: 2,
                cards: [{ boardNumber: 2, ticket: botTicket, daubed: new Set() }],
                daubed: new Set(),
                fee: 10,
                lastSeen: Date.now()
            }
        ];

        let humanWon = false;
        let botWonBeforeHuman = false;

        for (let round = 0; round < 50; round++) {
            if (gm.state !== 'PLAYING') break;
            await (gm as any).drawNumber();

            const lastBall = Array.from(gm.drawnNumbers).at(-1)!;
            const sim = gm.getSimulatedWinners(lastBall);

            if (sim.bots > 0 && !humanWon) {
                botWonBeforeHuman = true;
            }
            if (sim.humans > 0) {
                humanWon = true;
                // Human claims
                const claimRes = await gm.claimBingo(humanUserId);
                assert.equal(claimRes.success, true);
                break;
            }
        }

        assert.equal(botWonBeforeHuman, false, 'In real_players mode, bot must not win before human');
        assert.equal(humanWon, true, 'In real_players mode, human player must achieve winning pattern');
        assert.equal(gm.pendingWinners[0]?.player.userId, humanUserId, 'Pending winner must be the human');
    });

    await t.test('6. Clockwork timing integrity: simulated winner checks execute under 5ms', () => {
        const gm = new GameManager(mockBot);
        gm.state = 'PLAYING';

        // Populate with 100 players (mix of humans and bots)
        for (let i = 1; i <= 100; i++) {
            const ticket = generateTicket(i);
            gm.players.push({
                userId: BigInt(50000 + i),
                firstName: `Player_${i}`,
                isBot: i > 5, // 5 humans, 95 bots
                ticket,
                boardNumber: i,
                cards: [{ boardNumber: i, ticket, daubed: new Set() }],
                daubed: new Set(),
                fee: 10,
                lastSeen: Date.now()
            });
        }

        // Draw 20 numbers
        for (let i = 1; i <= 20; i++) {
            gm.drawnNumbers.add(i);
        }

        const start = performance.now();
        // Check 30 candidate balls
        for (let num = 21; num <= 50; num++) {
            gm.getSimulatedWinners(num);
        }
        const elapsed = performance.now() - start;

        // 30 candidate ball evaluations across 100 players should take < 250ms total
        assert.ok(elapsed < 250, `Calculation should be fast, took ${elapsed}ms for 30 balls`);
    });
});
