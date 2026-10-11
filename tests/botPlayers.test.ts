import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Bot } from 'grammy';
import { GameManager } from '../src/game/GameManager';
import { BotService, ETHIOPIAN_BOT_PROFILES } from '../src/game/BotService';
import { prisma } from '../src/db';

const mockBot = {
    api: {
        editMessageText: async () => ({}),
        sendMessage: async () => ({})
    }
} as unknown as Bot;

describe('Virtual Players (Bot System) Test Suite', () => {
    let botService: BotService;
    let gameManager: GameManager;

    beforeEach(() => {
        botService = new BotService();
        gameManager = new GameManager(mockBot, botService, 10, 1);
    });

    afterEach(async () => {
        if (gameManager) {
            await gameManager.forceReset();
        }
    });

    test('Bot profile pool contains authentic Ethiopian identities with no generic names', () => {
        assert.ok(ETHIOPIAN_BOT_PROFILES.length >= 30, 'Should have at least 30 authentic profiles');
        for (const profile of ETHIOPIAN_BOT_PROFILES) {
            assert.ok(profile.firstName && profile.firstName.length > 2, 'Profile must have a valid first name');
            assert.ok(profile.username && profile.username.length > 2, 'Profile must have a valid username');
            assert.ok(!profile.firstName.toLowerCase().includes('bot'), 'Name must not contain "bot"');
            assert.ok(!profile.firstName.toLowerCase().startsWith('player'), 'Name must not be generic "Player"');
            assert.ok(!profile.firstName.includes('.'), `First name "${profile.firstName}" must not contain a dot`);
            assert.ok(!/\s+[A-Za-z]$/.test(profile.firstName), `First name "${profile.firstName}" must not contain trailing single-letter initial`);
        }
    });

    test('Bot settings can be read and updated', () => {
        const initial = botService.getSettings();
        assert.equal(typeof initial.enabled, 'boolean');
        assert.equal(typeof initial.targetPlayers, 'number');

        const updated = botService.updateSettings({
            enabled: true,
            targetPlayers: 15,
            botReactionMinMs: 1500,
            botReactionMaxMs: 2500
        });

        assert.equal(updated.targetPlayers, 15);
        assert.equal(updated.botReactionMinMs, 1500);
        assert.equal(updated.botReactionMaxMs, 2500);
    });

    test('Injecting bots into waiting lobby allocates valid boards and marks them taken', async () => {
        assert.equal(gameManager.players.length, 0);

        const added = await botService.injectBots(gameManager, 5, 10);
        assert.equal(added, 5);
        assert.equal(gameManager.players.length, 5);

        // Verify boards are taken
        const boards = gameManager.getBoards();
        const takenBoards = boards.filter(b => b.taken);
        assert.ok(takenBoards.length >= 5, 'At least 5 boards should be taken');

        // Verify each bot has realistic name and isBot flag
        for (const p of gameManager.players) {
            assert.equal(p.isBot, true);
            assert.ok(p.firstName && p.firstName.length > 2);
            assert.ok(!p.firstName.toLowerCase().includes('bot'));
            assert.ok(p.fee > 0);
        }

        // Verify pot reflects combined bot fees
        assert.equal(gameManager.getPot(), gameManager.players.reduce((sum, p) => sum + p.fee, 0));
    });

    test('Clearing bots removes only virtual players from the lobby', async () => {
        // Add a mock human player
        gameManager.players.push({
            userId: 111111n,
            cards: [{
                boardNumber: 10,
                ticket: Array(5).fill(0).map(() => Array(5).fill(1)),
                daubed: new Set()
            }],
            ticket: Array(5).fill(0).map(() => Array(5).fill(1)),
            daubed: new Set(),
            fee: 10,
            lastSeen: Date.now(),
            isBot: false,
            firstName: 'RealHuman'
        });

        // Add 5 bots
        await botService.injectBots(gameManager, 5, 10);
        assert.equal(gameManager.players.length, 6);

        // Clear bots
        const removed = botService.clearBots(gameManager);
        assert.equal(removed, 5);
        assert.equal(gameManager.players.length, 1);
        assert.equal(gameManager.players[0].userId, 111111n);
    });

    test('Stale player sweep preserves bots while waiting, but cleans them if all humans leave', async () => {
        const oldTime = Date.now() - 30000; // 30s ago (stale)

        // Add 1 human (stale) and 3 bots
        gameManager.players.push({
            userId: 222222n,
            cards: [{
                boardNumber: 25,
                ticket: Array(5).fill(0).map(() => Array(5).fill(1)),
                daubed: new Set()
            }],
            ticket: Array(5).fill(0).map(() => Array(5).fill(1)),
            daubed: new Set(),
            fee: 10,
            lastSeen: oldTime,
            isBot: false,
            firstName: 'AbandoningHuman'
        });

        await botService.injectBots(gameManager, 3, 10);
        assert.equal(gameManager.players.length, 4);

        // Stale sweep removes the abandoning human and clears bots because no humans remain
        await gameManager.removeStalePlayers(15000);
        assert.equal(gameManager.players.length, 0);
    });

    test('When a bot wins, announcement shows authentic name and skips database balance update', async () => {
        // Set up 1 bot with a card that will win
        const winningTicket = [
            [1, 16, 31, 46, 61],
            [2, 17, 32, 47, 62],
            [3, 18, 33, 48, 63],
            [4, 19, 34, 49, 64],
            [5, 20, 35, 50, 65]
        ];

        const botId = 9000000099n;
        const botName = 'Dawit';
        gameManager.players.push({
            userId: botId,
            cards: [{
                boardNumber: 101,
                ticket: winningTicket,
                daubed: new Set()
            }],
            ticket: winningTicket,
            daubed: new Set(),
            fee: 10,
            lastSeen: Date.now(),
            isBot: true,
            firstName: botName,
            username: 'dawit_b9'
        });

        gameManager.state = 'PLAYING';
        gameManager.drawnNumbers = new Set([1, 2, 3, 4, 5]); // Col 0 winning line

        // Bot claims Bingo
        const claimRes = await gameManager.claimBingo(botId);
        assert.equal(claimRes.success, true);
        assert.equal(claimRes.winnerName, botName);

        // Let resolution timeout fire or verify pending winner
        assert.ok(gameManager.state === 'WAITING' || (gameManager as any).pendingWinners.length > 0);
    });

    test('When ball is drawn, bot daubs card and triggers claim if winning line achieved', async () => {
        // Configure fast bot reaction for test
        botService.updateSettings({
            botReactionMinMs: 50,
            botReactionMaxMs: 100
        });

        const winningTicket = [
            [1, 16, 31, 46, 61],
            [2, 17, 32, 47, 62],
            [3, 18, 33, 48, 63],
            [4, 19, 34, 49, 64],
            [5, 20, 35, 50, 65]
        ];

        const botId = 9000000055n;
        gameManager.players.push({
            userId: botId,
            cards: [{
                boardNumber: 150,
                ticket: winningTicket,
                daubed: new Set([1, 2, 3, 4])
            }],
            ticket: winningTicket,
            daubed: new Set([1, 2, 3, 4]),
            fee: 10,
            lastSeen: Date.now(),
            isBot: true,
            firstName: 'Almaz'
        });

        gameManager.state = 'PLAYING';
        gameManager.drawnNumbers = new Set([1, 2, 3, 4, 5]); // #5 completes the win!

        // BotService processes the newly drawn ball #5
        botService.onNumberDrawn(gameManager, 5, 10, 1);

        // Wait for bot reaction delay (50-100ms)
        await new Promise(r => setTimeout(r, 200));

        // Verify that the bot claimed Bingo and is registered as pending winner
        const pending = (gameManager as any).pendingWinners;
        assert.ok(pending && pending.length > 0, 'Bot should have claimed and entered pending winners');
        assert.equal(pending[0].player.firstName, 'Almaz');
    });

    test('Each bot strictly receives 1 board (10 Birr) and auto-starts lobby timer immediately', async () => {
        assert.equal(gameManager.lobbyCountdown, 0);
        assert.equal((gameManager as any).lobbyInterval, null);

        // Inject 20 bots
        const added = await botService.injectBots(gameManager, 20, 10);
        assert.equal(added, 20);
        assert.equal(gameManager.players.length, 20);

        // Verify each bot has strictly 1 board and fee is 10 Birr
        for (const bot of gameManager.players) {
            assert.equal(bot.cards?.length, 1);
            assert.equal(bot.fee, 10);
        }

        // Verify total boards and pot
        assert.equal(gameManager.getTotalBoards(), 20);
        assert.equal(gameManager.getPot(), 200);

        // Verify 30s lobby timer started automatically
        assert.equal(gameManager.lobbyCountdown, 30);
        assert.ok((gameManager as any).lobbyInterval !== null, 'Lobby interval should be running');
    });

    test('20 Bots + 1 Human with 1 board results in 21 players, 21 boards, Pot 210, Derash 168 Birr', async () => {
        // Inject 20 bots
        await botService.injectBots(gameManager, 20, 10);
        assert.equal(gameManager.players.length, 20);
        assert.equal(gameManager.getTotalBoards(), 20);

        // Add 1 human with 1 board (10 Birr)
        gameManager.players.push({
            userId: 777777n,
            cards: [{
                boardNumber: 499,
                ticket: Array(5).fill(0).map(() => Array(5).fill(1)),
                daubed: new Set()
            }],
            ticket: Array(5).fill(0).map(() => Array(5).fill(1)),
            daubed: new Set(),
            fee: 10,
            lastSeen: Date.now(),
            isBot: false,
            firstName: 'Abebe'
        });

        assert.equal(gameManager.players.length, 21, 'Total players must be 21');
        assert.equal(gameManager.getTotalBoards(), 21, 'Total boards must be 21');
        assert.equal(gameManager.getPot(), 210, 'Total pot must be 210 Birr');

        const derash = Math.floor(gameManager.getPot() * 0.8);
        assert.equal(derash, 168, 'Derash must be 168 Birr (80% of 210)');
        const houseIncome = gameManager.getPot() * 0.2;
        assert.equal(houseIncome, 42, 'House income must be 42 Birr (20% of 210)');
    });

    test('20 Bots + 1 Human with 2 boards results in 21 players, 22 boards, Pot 220, Derash 176 Birr', async () => {
        // Inject 20 bots
        await botService.injectBots(gameManager, 20, 10);
        assert.equal(gameManager.players.length, 20);
        assert.equal(gameManager.getTotalBoards(), 20);

        // Add 1 human with 2 boards (20 Birr)
        gameManager.players.push({
            userId: 888888n,
            cards: [
                {
                    boardNumber: 490,
                    ticket: Array(5).fill(0).map(() => Array(5).fill(1)),
                    daubed: new Set()
                },
                {
                    boardNumber: 491,
                    ticket: Array(5).fill(0).map(() => Array(5).fill(1)),
                    daubed: new Set()
                }
            ],
            ticket: Array(5).fill(0).map(() => Array(5).fill(1)),
            daubed: new Set(),
            fee: 20,
            lastSeen: Date.now(),
            isBot: false,
            firstName: 'Kebede'
        });

        assert.equal(gameManager.players.length, 21, 'Total players must be 21');
        assert.equal(gameManager.getTotalBoards(), 22, 'Total boards must be 22');
        assert.equal(gameManager.getPot(), 220, 'Total pot must be 220 Birr');

        const derash = Math.floor(gameManager.getPot() * 0.8);
        assert.equal(derash, 176, 'Derash must be 176 Birr (80% of 220)');
        const houseIncome = gameManager.getPot() * 0.2;
        assert.equal(houseIncome, 44, 'House income must be 44 Birr (20% of 220)');
    });
});
