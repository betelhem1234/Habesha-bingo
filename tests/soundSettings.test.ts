import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Sound Settings Pre-Game Toggle & Persistence Tests', () => {
    // Helper simulating the client-side sound initialization logic
    function resolveSoundState(stored: string | null, urlParam: string | null): boolean {
        let soundEnabled = true; // default is true
        if (stored !== null) {
            soundEnabled = stored === 'true';
        } else if (urlParam !== null) {
            soundEnabled = urlParam === '1';
        }
        return soundEnabled;
    }

    it('defaults to sound enabled (true) when no preference or URL parameter is set', () => {
        const state = resolveSoundState(null, null);
        assert.equal(state, true, 'Default sound state must be ON (true)');
    });

    it('respects stored preference in localStorage', () => {
        // User turned sound OFF previously
        assert.equal(resolveSoundState('false', null), false);
        // User turned sound ON previously
        assert.equal(resolveSoundState('true', null), true);
    });

    it('stored localStorage preference overrides absent URL param', () => {
        assert.equal(resolveSoundState('false', null), false);
        assert.equal(resolveSoundState('true', null), true);
    });

    it('URL sound param correctly parses when stored preference is null', () => {
        assert.equal(resolveSoundState(null, '0'), false);
        assert.equal(resolveSoundState(null, '1'), true);
    });

    it('stored preference takes precedence over URL parameter if user explicitly toggled', () => {
        // If localStorage has 'false', even if an old link had sound=1, user preference is respected
        assert.equal(resolveSoundState('false', '1'), false);
        // If localStorage has 'true', user preference is respected
        assert.equal(resolveSoundState('true', '0'), true);
    });

    it('generates correct query strings when navigating between boards.html and game.html', () => {
        const soundOn = true;
        const soundOff = false;

        const urlOn = `/game.html?userId=123&bet=10&room=1&auto=1&sound=${soundOn ? '1' : '0'}`;
        const urlOff = `/game.html?userId=123&bet=10&room=1&auto=1&sound=${soundOff ? '1' : '0'}`;

        const parsedOn = new URL(urlOn, 'https://example.com');
        const parsedOff = new URL(urlOff, 'https://example.com');

        assert.equal(parsedOn.searchParams.get('sound'), '1');
        assert.equal(parsedOff.searchParams.get('sound'), '0');

        assert.equal(resolveSoundState(null, parsedOn.searchParams.get('sound')), true);
        assert.equal(resolveSoundState(null, parsedOff.searchParams.get('sound')), false);
    });
});
