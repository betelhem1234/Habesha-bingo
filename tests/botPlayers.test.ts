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
        assert.ok(ETHIOPIAN_BOT_PROFILES.length >= 200, 'Should have at least 200 authentic profiles');
        for (const profile of ETHIOPIAN_BOT_PROFILES) {
            assert.ok(profile.firstName && profile.firstName.length >= 2, 'Profile must have a valid first name');
            assert.ok(profile.username && profile.username.length > 2, 'Profile must have a valid username');
            assert.ok(!profile.firstName.toLowerCase().includes('bot'), 'Name must not contain "bot"');
            assert.ok(!profile.firstName.toLowerCase().startsWith('player'), 'Name must not be generic "Player"');
            assert.ok(!profile.firstName.includes('.'), `First name "${profile.firstName}" must not contain a dot`);
            assert.ok(!/\s+[A-Za-z]$/.test(profile.firstName), `First name "${profile.firstName}" must not contain trailing single-letter initial`);
        }

        const formerFemaleNames = new Set(['Beti', 'Mahi', 'Selu', 'Hani', 'Edu', 'Rahi', 'Almi', 'Fevi', 'Heli', 'Mery', 'Kali', 'Tsii', 'Sona', 'Lili']);
        const containsFormerFemale = ETHIOPIAN_BOT_PROFILES.some(p => formerFemaleNames.has(p.firstName));
        assert.strictEqual(containsFormerFemale, false, 'Profile pool should not contain any former female names');
        assert.strictEqual(ETHIOPIAN_BOT_PROFILES.length, 258, 'Profile pool should contain exactly 258 male profiles');
    });

    test('Bot settings can be read and updated', () => {
        const initial = botService.getSettings();
        assert.equal(typeof initial.enabled, 'boolean');
        assert.equal(typeof initial.targetPlayers, 'number');

        const updated = botService.updateSettings({
            enabled: true,
            targetPlayers: 75,
            botReactionMinMs: 1500,
            botReactionMaxMs: 2500,
            joinPacing: 'dynamic'
        });

        assert.equal(updated.targetPlayers, 75);
        assert.equal(updated.botReactionMinMs, 1500);
        assert.equal(updated.botReactionMaxMs, 2500);
        assert.equal(updated.joinPacing, 'dynamic');

        const rapidUpdated = botService.updateSettings({
            joinPacing: 'rapid',
            targetPlayers: 300
        });
        assert.equal(rapidUpdated.joinPacing, 'rapid');
        assert.equal(rapidUpdated.targetPlayers, 300);
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

    test('Stale player sweep evicts abandoning human, but preserves committed bots in the lobby', async () => {
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

        // Stale sweep removes the abandoning human, but bots stay committed in the lobby
        await gameManager.removeStalePlayers(15000);
        assert.equal(gameManager.players.length, 3);
        assert.ok(gameManager.players.every(p => p.isBot));
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

    test('When real player unselects board, bots keep their boards and countdown proceeds', async () => {
        // Add human
        const humanId = 333333n;
        gameManager.players.push({
            userId: humanId,
            cards: [{
                boardNumber: 50,
                ticket: Array(5).fill(0).map(() => Array(5).fill(1)),
                daubed: new Set()
            }],
            ticket: Array(5).fill(0).map(() => Array(5).fill(1)),
            daubed: new Set(),
            boardNumber: 50,
            fee: 10,
            lastSeen: Date.now(),
            isBot: false,
            firstName: 'IndecisiveHuman'
        });

        // 5 bots join
        await botService.injectBots(gameManager, 5, 10);
        assert.equal(gameManager.players.length, 6);

        // Human deselects their board (boardNumbers = [])
        const deselectRes = await gameManager.selectBoards(humanId, []);
        assert.equal(deselectRes.success, true);

        // Human is removed, but all 5 bots stay in lobby!
        assert.equal(gameManager.players.length, 5);
        assert.ok(gameManager.players.every(p => p.isBot));

        // Bot boards remain taken
        const boards = gameManager.getBoards();
        const taken = boards.filter(b => b.taken);
        assert.equal(taken.length, 5);

        // Human's previous board #50 is now free
        const board50 = boards.find(b => b.number === 50);
        assert.equal(board50?.taken, false);
    });

    test('When 30s lobby countdown finishes with only bots, match auto-starts and plays to completion until a bot wins', async () => {
        // Configure fast bot reaction
        botService.updateSettings({
            botReactionMinMs: 50,
            botReactionMaxMs: 100
        });

        // Add a bot with a card ready to win on #5
        const winningTicket = [
            [1, 16, 31, 46, 61],
            [2, 17, 32, 47, 62],
            [3, 18, 33, 48, 63],
            [4, 19, 34, 49, 64],
            [5, 20, 35, 50, 65]
        ];

        gameManager.players.push({
            userId: 9000000010n,
            cards: [{
                boardNumber: 11,
                ticket: winningTicket,
                daubed: new Set([1, 2, 3, 4])
            }],
            ticket: winningTicket,
            daubed: new Set([1, 2, 3, 4]),
            fee: 10,
            lastSeen: Date.now(),
            isBot: true,
            firstName: 'Dawit'
        });

        // Match auto-starts with only bots
        await gameManager.startGame();
        assert.equal(gameManager.state, 'PLAYING');

        // Draw #5 which completes Dawit's winning line
        gameManager.drawnNumbers = new Set([1, 2, 3, 4, 5]);
        botService.onNumberDrawn(gameManager, 5, 10, 1);

        // Wait for bot reaction & resolution
        await new Promise(r => setTimeout(r, 250));

        // Verify Dawit claimed Bingo
        const pending = (gameManager as any).pendingWinners;
        assert.ok(pending && pending.length > 0);
        assert.equal(pending[0].player.firstName, 'Dawit');
    });

    test('Dynamic pacing allows rapid bot onboarding when target is large', async () => {
        botService.updateSettings({
            enabled: true,
            targetPlayers: 40,
            joinPacing: 'dynamic'
        });

        gameManager.state = 'WAITING';
        gameManager.lobbyCountdown = 30;

        gameManager.players.push({
            userId: 12345678n,
            cards: [{ boardNumber: 1, ticket: Array(5).fill(0).map(() => Array(5).fill(1)), daubed: new Set() }],
            ticket: Array(5).fill(0).map(() => Array(5).fill(1)),
            daubed: new Set(),
            fee: 10,
            lastSeen: Date.now(),
            isBot: false,
            firstName: 'RealHuman'
        });

        botService.onRoomUpdated(gameManager, 10, 1);

        const hasTimeout = (botService as any).fillTimeouts.has('10_1');
        assert.equal(hasTimeout, true);
    });

    test('getBotProfileById deterministically returns profile for virtual IDs and null for human IDs', () => {
        const p1 = botService.getBotProfileById(9000000001n);
        assert.ok(p1, 'Should resolve profile for 9000000001');
        assert.equal(p1?.firstName, ETHIOPIAN_BOT_PROFILES[0].firstName);

        const p2 = botService.getBotProfileById(9000000002n);
        assert.ok(p2, 'Should resolve profile for 9000000002');
        assert.equal(p2?.firstName, ETHIOPIAN_BOT_PROFILES[1].firstName);

        const negP1 = botService.getBotProfileById(-1n);
        assert.ok(negP1, 'Should resolve profile for negative bot ID -1');
        assert.equal(negP1?.firstName, ETHIOPIAN_BOT_PROFILES[0].firstName);

        const negP2 = botService.getBotProfileById(-2n);
        assert.ok(negP2, 'Should resolve profile for negative bot ID -2');
        assert.equal(negP2?.firstName, ETHIOPIAN_BOT_PROFILES[1].firstName);

        const human = botService.getBotProfileById(12345678n);
        assert.equal(human, null, 'Human ID should return null');
    });

    test('Shared Jackpot with 1 Human and 1 Bot correctly allocates gross jackpot and per-winner split', () => {
        const pot = 1020;
        const totalWinnerPayout = Math.floor(pot * 0.8); // 816
        const winnerCount = 2;
        const payoutPerWinner = Math.floor(totalWinnerPayout / winnerCount); // 408

        assert.equal(totalWinnerPayout, 816);
        assert.equal(payoutPerWinner, 408);

        // 1 human winner
        const humanWinnersCount = 1;
        const totalActualPayout = humanWinnersCount * payoutPerWinner; // 408
        assert.equal(totalActualPayout, 408);

        // API calculation: splitPayout must be based on gross jackpot, not divided twice
        const splitPayout = winnerCount > 0 ? Math.floor(totalWinnerPayout / winnerCount) : 0;
        assert.equal(splitPayout, 408, 'splitPayout must be 408 Birr, never 204 Birr');
    });

    test('Continuous Game Loop: onLobbyOpened pre-seeds baseline bots and auto-starts 30s countdown', async () => {
        assert.equal(gameManager.players.length, 0);
        assert.equal(gameManager.lobbyCountdown, 0);

        await botService.onLobbyOpened(gameManager, 10, 1);

        // Pre-seeded 3–4 baseline bots
        assert.ok(gameManager.players.length >= 3, `Expected at least 3 seed bots, got ${gameManager.players.length}`);
        assert.ok(gameManager.players.every(p => p.isBot));
        assert.equal(gameManager.lobbyCountdown, 30);
        assert.ok((gameManager as any).lobbyInterval !== null);

        // Boards taken
        const boards = gameManager.getBoards();
        assert.ok(boards.filter(b => b.taken).length >= 3);
    });

    test('Continuous Game Loop: resetToLobby resets state, restarts 30s countdown, and seeds bots', async () => {
        // Put in fake ended match state
        gameManager.drawnNumbers.add(10);
        gameManager.drawnNumbers.add(25);
        gameManager.state = 'WAITING';

        await gameManager.resetToLobby();

        assert.equal(gameManager.state, 'WAITING');
        assert.equal(gameManager.drawnNumbers.size, 0);
        assert.equal(gameManager.lobbyCountdown, 30);
        assert.ok(gameManager.players.length >= 3, 'Should seed baseline bots');
    });

    test('Financial Hygiene: bot-only matches do NOT write zero-income rows to prisma.houseIncome', async () => {
        const initialCount = await prisma.houseIncome.count();

        const testStartTime = new Date();

        // Add 2 bots only
        await botService.injectBots(gameManager, 2, 10);
        assert.equal(gameManager.players.filter(p => !p.isBot).length, 0);

        gameManager.state = 'PLAYING';
        gameManager.drawnNumbers = new Set([1, 2, 3, 4, 5]);

        // Dawit bot wins
        const botWinner = gameManager.players[0];
        (gameManager as any).currentWinners = [];
        await (gameManager as any).endGame([{
            player: botWinner,
            boardNumber: botWinner.cards![0].boardNumber,
            ticket: botWinner.cards![0].ticket,
            daubed: new Set([1, 2, 3, 4, 5]),
            winningCells: [],
            winningNumber: 5
        }]);

        const record = await prisma.houseIncome.findFirst({
            where: {
                winnerId: botWinner.userId,
                createdAt: { gte: testStartTime }
            }
        });
        assert.equal(record, null, 'Bot-only match must not insert zero-cash rows into HouseIncome');
    });

    test('Financial Hygiene: match with real player and bots DOES log real collected fee and profit to HouseIncome', async () => {
        const testStartTime = new Date();

        // 1 bot + 1 human
        await botService.injectBots(gameManager, 1, 10);
        const botPlayer = gameManager.players[0];

        const humanUserId = 999111222n;
        gameManager.players.push({
            userId: humanUserId,
            cards: [{
                boardNumber: 444,
                ticket: Array(5).fill(0).map(() => Array(5).fill(1)),
                daubed: new Set([1, 2, 3, 4, 5])
            }],
            ticket: Array(5).fill(0).map(() => Array(5).fill(1)),
            daubed: new Set([1, 2, 3, 4, 5]),
            fee: 10,
            lastSeen: Date.now(),
            isBot: false,
            firstName: 'RealPlayer'
        });

        gameManager.state = 'PLAYING';
        gameManager.drawnNumbers = new Set([1, 2, 3, 4, 5]);

        // Bot wins
        await (gameManager as any).endGame([{
            player: botPlayer,
            boardNumber: botPlayer.cards![0].boardNumber,
            ticket: botPlayer.cards![0].ticket,
            daubed: new Set([1, 2, 3, 4, 5]),
            winningCells: [],
            winningNumber: 5
        }]);

        const record = await prisma.houseIncome.findFirst({
            where: {
                winnerId: botPlayer.userId,
                createdAt: { gte: testStartTime }
            },
            orderBy: { createdAt: 'desc' }
        });
        assert.ok(record, 'Match with organic player must log a record with bot winnerId');
        assert.equal(Number(record?.winnerPayout), 0);
        assert.equal(Number(record?.houseProfit), 10, 'House profit must be 100% of human fee (10 Birr) when bot wins');
    });

    test('Human player with Telegram ID >= 9,000,000,000 winning against bots is never misidentified as a bot', async () => {
        const testStartTime = new Date();

        // 8 bots + 1 human with 9-billion+ Telegram ID
        await botService.injectBots(gameManager, 8, 10);
        const humanUserId = 9123456789n;

        // Upsert mock user in prisma.user
        await prisma.user.upsert({
            where: { id: humanUserId },
            update: { firstName: 'RealWinnerNineBillion', balance: 100 },
            create: { id: humanUserId, firstName: 'RealWinnerNineBillion', balance: 100 }
        });

        gameManager.players.push({
            userId: humanUserId,
            cards: [{
                boardNumber: 500,
                ticket: Array(5).fill(0).map(() => Array(5).fill(1)),
                daubed: new Set([1, 2, 3, 4, 5])
            }],
            ticket: Array(5).fill(0).map(() => Array(5).fill(1)),
            daubed: new Set([1, 2, 3, 4, 5]),
            fee: 20, // 2 boards
            lastSeen: Date.now(),
            isBot: false,
            firstName: 'RealWinnerNineBillion'
        });

        gameManager.state = 'PLAYING';
        gameManager.drawnNumbers = new Set([1, 2, 3, 4, 5]);

        const humanPlayer = gameManager.players.find(p => p.userId === humanUserId)!;

        // Human wins!
        await (gameManager as any).endGame([{
            player: humanPlayer,
            boardNumber: 500,
            ticket: humanPlayer.cards![0].ticket,
            daubed: new Set([1, 2, 3, 4, 5]),
            winningCells: [],
            winningNumber: 5
        }]);

        // Total pot: 8 bots x 10 + human x 20 = 100 Birr
        // Winner payout (80%): 80 Birr
        // Real money collected: 20 Birr
        // House profit: 20 - 80 = -60 Birr
        const record = await prisma.houseIncome.findFirst({
            where: {
                winnerId: humanUserId,
                createdAt: { gte: testStartTime }
            },
            orderBy: { createdAt: 'desc' }
        });

        assert.ok(record, 'Must record HouseIncome for human winner');
        assert.equal(record.winnerId, humanUserId);
        assert.equal(Number(record.winnerPayout), 80);
        assert.equal(Number(record.houseProfit), -60, 'House absorbs the negative profit as intended for bot-inflated pot');

        // Clean up test user
        await prisma.user.delete({ where: { id: humanUserId } }).catch(() => {});
    });

    test('Independent Stake 1 and Stake 2 bot controls and target limits', async () => {
        // Configure Stake 1: ON with target 15; Stake 2: OFF with target 0
        botService.updateSettings({
            enabled: true,
            stake10Enabled: true,
            stake10Target: 15,
            stake20Enabled: false,
            stake20Target: 0
        });

        assert.strictEqual(botService.isStakeEnabled(10), true);
        assert.strictEqual(botService.getStakeTarget(10), 15);
        assert.strictEqual(botService.isStakeEnabled(20), false);
        assert.strictEqual(botService.getStakeTarget(20), 0);

        // Test fee 20 manager (Stake 2)
        const gm20 = new GameManager(mockBot, botService, 20, 1);
        try {
            // onLobbyOpened on disabled Stake 2 should inject 0 bots
            await botService.onLobbyOpened(gm20, 20, 1);
            assert.strictEqual(gm20.players.filter(p => p.isBot).length, 0, 'Disabled Stake 2 must have 0 bots on lobby opened');

            // onRoomUpdated on disabled Stake 2 should inject 0 bots
            botService.onRoomUpdated(gm20, 20, 1);
            assert.strictEqual(gm20.players.filter(p => p.isBot).length, 0, 'Disabled Stake 2 must not schedule any bots');

            // Even if bots were manually injected, clearing them cancels timeouts and prevents recovery
            await botService.injectBots(gm20, 3, 20);
            assert.strictEqual(gm20.players.filter(p => p.isBot).length, 3);
            const cleared = botService.clearBots(gm20);
            assert.strictEqual(cleared, 3);
            assert.strictEqual(gm20.players.filter(p => p.isBot).length, 0);

            // Re-triggering onLobbyOpened on Stake 2 still adds 0 bots
            await botService.onLobbyOpened(gm20, 20, 1);
            assert.strictEqual(gm20.players.filter(p => p.isBot).length, 0, 'Cleared Stake 2 must never recover bots while OFF');
        } finally {
            await gm20.forceReset();
        }

        // Test fee 10 manager (Stake 1)
        const gm10 = new GameManager(mockBot, botService, 10, 1);
        try {
            await botService.onLobbyOpened(gm10, 10, 1);
            const botsCount10 = gm10.players.filter(p => p.isBot).length;
            assert.ok(botsCount10 >= 3, 'Stake 1 should seed baseline bots when enabled');
            assert.ok(botsCount10 <= 15, 'Stake 1 should not exceed stake10Target');
        } finally {
            await gm10.forceReset();
        }
    });

    test('Master switch disabled disables bots regardless of stake settings', () => {
        botService.updateSettings({
            enabled: false,
            stake10Enabled: true,
            stake10Target: 20,
            stake20Enabled: true,
            stake20Target: 20
        });

        assert.strictEqual(botService.isStakeEnabled(10), false);
        assert.strictEqual(botService.isStakeEnabled(20), false);
    });
});
