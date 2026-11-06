import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const qrCache = new Map<string, Buffer>();

/**
 * Generates a PNG Buffer of a QR Code for the provided URL or text.
 * Caches in memory to ensure fast and lightweight responses.
 */
export async function generateQrPngBuffer(text: string): Promise<Buffer | null> {
    if (!text) return null;
    if (qrCache.has(text)) {
        return qrCache.get(text)!;
    }

    try {
        const { stdout } = await execFileAsync('python3', [
            '-c',
            'import qrcode, io, sys; img=qrcode.make(sys.argv[1]); b=io.BytesIO(); img.save(b, format="PNG"); sys.stdout.buffer.write(b.getvalue())',
            text
        ], { encoding: 'buffer', maxBuffer: 10 * 1024 * 1024 });

        if (Buffer.isBuffer(stdout) && stdout.length > 0) {
            // Keep cache size bounded
            if (qrCache.size > 500) {
                const firstKey = qrCache.keys().next().value;
                if (firstKey) qrCache.delete(firstKey);
            }
            qrCache.set(text, stdout);
            return stdout;
        }
        return null;
    } catch (err) {
        console.error('[QR] Failed to generate QR PNG buffer:', err);
        return null;
    }
}
