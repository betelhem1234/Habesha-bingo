import { test, describe } from 'node:test';
import assert from 'node:assert';
import { formatEthioTime, formatEthioDateTime } from '../src/config';

describe('Ethiopian Timezone (UTC+3) Tests', () => {
    test('formatEthioTime produces correct 12-hour formatted time in Africa/Addis_Ababa', () => {
        // Create a fixed UTC date: 2026-11-06T19:34:43Z (which is 10:34:43 PM in Ethiopia)
        const utcDate = new Date('2026-11-06T19:34:43Z');
        const formatted = formatEthioTime(utcDate);

        assert.strictEqual(formatted, '10:34:43 PM');
    });

    test('formatEthioDateTime produces correct date and time in Africa/Addis_Ababa', () => {
        const utcDate = new Date('2026-11-06T19:34:43Z');
        const formatted = formatEthioDateTime(utcDate);

        assert(formatted.includes('Nov 6, 2026'), 'Date should be Nov 6, 2026');
        assert(formatted.includes('10:34:43 PM'), 'Time should be 10:34:43 PM');
    });
});
