import fs from 'fs';
import path from 'path';
import { config } from './config';

export const UPLOADS_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

export function proofPath(filename: string): string {
    return path.join(UPLOADS_DIR, filename);
}

export function proofUrl(filename: string): string {
    return `${config.BINGO_APP_URL}/uploads/${encodeURIComponent(filename)}`;
}