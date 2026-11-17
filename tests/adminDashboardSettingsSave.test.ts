import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { 
    getBotSettings, 
    setBotSettings, 
    getNewUserBonus, 
    getReferralBonus, 
    setBonusSettings, 
    getMinCallToWin, 
    setMinCallToWin 
} from '../src/settings.js';

test('Admin Dashboard Explicit Save-Button-Only Verification', async (t) => {
    const adminHtmlPath = path.join(process.cwd(), 'src/public/admin.html');
    const appJsPath = path.join(process.cwd(), 'src/public/app.js');

    const adminHtml = fs.readFileSync(adminHtmlPath, 'utf8');
    const appJs = fs.readFileSync(appJsPath, 'utf8');

    await t.test('admin.html has zero auto-saving onchange or onblur handlers for bot settings', () => {
        // Assert no element automatically calls saveBotSettings on change or blur
        assert.ok(!adminHtml.includes('onchange="saveBotSettings()"'), 'admin.html should not have onchange="saveBotSettings()"');
        assert.ok(!adminHtml.includes('onblur="saveBotSettings()"'), 'admin.html should not have onblur="saveBotSettings()"');
        assert.ok(!adminHtml.includes('updateStakeBadges(); saveBotSettings();'), 'admin.html should not call saveBotSettings inside updateStakeBadges()');
    });

    await t.test('admin.html contains explicit save buttons and revert buttons', () => {
        assert.ok(adminHtml.includes('onclick="saveBotSettings(10)"'), 'Should have explicit Save Stake 1 button');
        assert.ok(adminHtml.includes('onclick="saveBotSettings(20)"'), 'Should have explicit Save Stake 2 button');
        assert.ok(adminHtml.includes('onclick="saveBotSettings()"'), 'Should have explicit Save Bot Settings button');
        assert.ok(adminHtml.includes('onclick="revertBotSettings(10)"'), 'Should have Revert Stake 1 button');
        assert.ok(adminHtml.includes('onclick="revertBotSettings(20)"'), 'Should have Revert Stake 2 button');
        assert.ok(adminHtml.includes('onclick="revertBotSettings(\'all\')"'), 'Should have Revert All bot settings button');
        assert.ok(adminHtml.includes('onclick="revertBonusSettings()"'), 'Should have Revert Bonus settings button');
        assert.ok(adminHtml.includes('onclick="revertWinCallThreshold()"'), 'Should have Revert Win Call threshold button');
    });

    await t.test('app.js includes global wheel scroll protection on numeric inputs', () => {
        assert.ok(appJs.includes("e.target.type === 'number'"), 'app.js should check for number input on wheel events');
        assert.ok(appJs.includes("e.preventDefault()"), 'app.js should preventDefault on wheel events for number inputs');
    });

    await t.test('app.js exports revert and dirty marking functions on window', () => {
        assert.ok(appJs.includes('window.revertBonusSettings = revertBonusSettings;'), 'revertBonusSettings should be exported');
        assert.ok(appJs.includes('window.markBonusInputDirty = markBonusInputDirty;'), 'markBonusInputDirty should be exported');
        assert.ok(appJs.includes('window.revertWinCallThreshold = revertWinCallThreshold;'), 'revertWinCallThreshold should be exported');
        assert.ok(appJs.includes('window.markWinCallDirty = markWinCallDirty;'), 'markWinCallDirty should be exported');
        assert.ok(appJs.includes('window.revertBotSettings = revertBotSettings;'), 'revertBotSettings should be exported');
        assert.ok(appJs.includes('window.markBotInputDirty = markBotInputDirty;'), 'markBotInputDirty should be exported');
    });

    await t.test('server-side settings remain unchanged until explicitly set', async () => {
        const initialBots = getBotSettings();
        const initialNewUserBonus = getNewUserBonus();
        const initialReferralBonus = getReferralBonus();
        const initialMinCalls = getMinCallToWin();

        // Values stay identical without explicit save
        assert.deepEqual(getBotSettings(), initialBots);
        assert.equal(getNewUserBonus(), initialNewUserBonus);
        assert.equal(getReferralBonus(), initialReferralBonus);
        assert.equal(getMinCallToWin(), initialMinCalls);

        // When explicit save occurs, values persist
        setBonusSettings(25, 12);
        assert.equal(getNewUserBonus(), 25);
        assert.equal(getReferralBonus(), 12);

        setMinCallToWin(18);
        assert.equal(getMinCallToWin(), 18);

        setBotSettings({ ...initialBots, stake10Target: 42, stake20Target: 15 });
        assert.equal(getBotSettings().stake10Target, 42);
        assert.equal(getBotSettings().stake20Target, 15);

        // Restore initial settings
        setBonusSettings(initialNewUserBonus, initialReferralBonus);
        setMinCallToWin(initialMinCalls);
        setBotSettings(initialBots);
    });
});
