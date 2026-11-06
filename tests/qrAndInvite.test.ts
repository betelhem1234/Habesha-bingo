import { test, describe } from 'node:test';
import assert from 'node:assert';
import { generateQrPngBuffer } from '../src/qrGenerator';

describe('QR Code Generation and Referral Tests', () => {
    test('generateQrPngBuffer generates a valid PNG for an invitation link', async () => {
        const link = 'https://t.me/PlayMyBingoBot?start=8942533525';
        const buffer = await generateQrPngBuffer(link);

        assert(buffer !== null, 'Buffer should not be null');
        assert(Buffer.isBuffer(buffer), 'Result must be a Node.js Buffer');
        assert(buffer.length > 100, `Buffer length (${buffer.length}) should be reasonable for a PNG`);

        // Check PNG signature: 89 50 4E 47 0D 0A 1A 0A
        const pngHeader = buffer.subarray(0, 8);
        const expectedHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        assert.deepStrictEqual(pngHeader, expectedHeader, 'Buffer must have valid PNG magic signature');
    });

    test('generateQrPngBuffer returns cached buffer on subsequent calls', async () => {
        const link = 'https://t.me/PlayMyBingoBot?start=test_cache_123';
        const buf1 = await generateQrPngBuffer(link);
        const buf2 = await generateQrPngBuffer(link);

        assert(buf1 !== null && buf2 !== null);
        assert.strictEqual(buf1, buf2, 'Subsequent calls should return the cached instance');
    });

    test('generateQrPngBuffer handles empty string safely', async () => {
        const buffer = await generateQrPngBuffer('');
        assert.strictEqual(buffer, null, 'Empty string should return null');
    });
});
