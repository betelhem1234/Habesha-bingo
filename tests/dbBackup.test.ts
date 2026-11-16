import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {
    formatBackupTimestamp,
    generateDatabaseBackup,
    getLatestBackupInfo,
    generatePureJsSqlDump
} from '../src/dbBackup';

test('Database Backup & Disaster Recovery Tests', async (t) => {
    await t.test('formatBackupTimestamp formats YYYY-MM-DD_HH-mm-ss correctly', () => {
        const d = new Date(2026, 10, 16, 14, 45, 30);
        const formatted = formatBackupTimestamp(d);
        assert.equal(formatted, '2026-11-16_14-45-30');
    });

    await t.test('generateDatabaseBackup creates latest_neon_backup.sql and overwrites cleanly without file accumulation', async () => {
        const backupsDir = path.join(process.cwd(), 'backups');
        const latestFile = path.join(backupsDir, 'latest_neon_backup.sql');

        // First dump
        const res1 = await generateDatabaseBackup();
        assert.ok(res1.size > 0, 'Backup size must be positive');
        assert.match(res1.clientFilename, /^neon_backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.sql$/);
        assert.equal(res1.filePath, latestFile);
        assert.ok(fs.existsSync(latestFile), 'latest_neon_backup.sql must exist on server');

        const initialMtime = fs.statSync(latestFile).mtimeMs;

        // Wait small interval
        await new Promise(r => setTimeout(r, 100));

        // Second dump
        const res2 = await generateDatabaseBackup();
        assert.ok(res2.size > 0);
        assert.equal(res2.filePath, latestFile);

        // Verify only 1 file exists in backups/ (no duplicate/accumulating files)
        const files = fs.readdirSync(backupsDir).filter(f => f.endsWith('.sql'));
        assert.equal(files.length, 1, 'Server backups directory must contain only a single latest_neon_backup.sql file');
        assert.equal(files[0], 'latest_neon_backup.sql');
    });

    await t.test('getLatestBackupInfo returns valid metadata for latest backup', async () => {
        const info = await getLatestBackupInfo();
        assert.equal(info.exists, true);
        assert.ok((info.size ?? 0) > 0);
        assert.equal(info.filename, 'latest_neon_backup.sql');
        assert.ok(info.mtime instanceof Date);
    });

    await t.test('generatePureJsSqlDump generates valid SQL table export fallback', async () => {
        const dbUrl = process.env.DATABASE_URL;
        if (!dbUrl) return;

        const sql = await generatePureJsSqlDump(dbUrl);
        assert.ok(sql.includes('-- Neon PostgreSQL Database Pure-JS Fallback Dump'));
        assert.ok(sql.includes('User') || sql.includes('SystemSetting'));
    });
});
