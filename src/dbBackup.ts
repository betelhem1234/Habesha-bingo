import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { Pool } from 'pg';
import { config } from './config';

export interface BackupResult {
    filePath: string;
    clientFilename: string;
    size: number;
    timestamp: string;
}

export interface BackupInfo {
    exists: boolean;
    size?: number;
    mtime?: Date;
    filename?: string;
}

/**
 * Generate a timestamp string suitable for filenames: YYYY-MM-DD_HH-mm-ss
 */
export function formatBackupTimestamp(date: Date = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

/**
 * Dump PostgreSQL database using pure Node.js / pg pool queries as fallback.
 */
export async function generatePureJsSqlDump(connectionString: string): Promise<string> {
    const pool = new Pool({
        connectionString,
        connectionTimeoutMillis: 10000
    });

    try {
        const tablesRes = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            ORDER BY table_name;
        `);
        const tables: string[] = tablesRes.rows.map((r: any) => r.table_name);
        let sql = `-- Neon PostgreSQL Database Pure-JS Fallback Dump\n-- Generated: ${new Date().toISOString()}\n\nSET client_encoding = 'UTF8';\n\n`;

        for (const table of tables) {
            sql += `\n-- -----------------------------------------------------\n-- Table: "${table}"\n-- -----------------------------------------------------\n`;
            const rowsRes = await pool.query(`SELECT * FROM "${table}";`);
            if (rowsRes.rows.length === 0) continue;

            const cols = Object.keys(rowsRes.rows[0]);
            const colList = cols.map(c => `"${c}"`).join(', ');

            for (const row of rowsRes.rows) {
                const values = cols.map(c => {
                    const val = row[c];
                    if (val === null || val === undefined) return 'NULL';
                    if (typeof val === 'number') return String(val);
                    if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
                    if (val instanceof Date) return `'${val.toISOString()}'`;
                    if (typeof val === 'bigint') return val.toString();
                    if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
                    return `'${String(val).replace(/'/g, "''")}'`;
                }).join(', ');

                sql += `INSERT INTO "${table}" (${colList}) VALUES (${values}) ON CONFLICT DO NOTHING;\n`;
            }
        }
        return sql;
    } finally {
        await pool.end().catch(() => {});
    }
}

/**
 * Dumps the live Neon PostgreSQL database.
 * Strategy:
 * 1. Overwrites a single fixed file on the server (backups/latest_neon_backup.sql) to prevent server disk bloat.
 * 2. Returns metadata with a unique timestamped client filename (neon_backup_YYYY-MM-DD_HH-mm-ss.sql)
 *    so the admin's browser downloads a unique historical copy.
 */
export async function generateDatabaseBackup(): Promise<BackupResult> {
    const rawDbUrl = process.env.DATABASE_URL || config.DATABASE_URL || '';
    if (!rawDbUrl) {
        throw new Error('DATABASE_URL is not configured.');
    }

    const backupsDir = path.join(process.cwd(), 'backups');
    if (!fs.existsSync(backupsDir)) {
        await fs.promises.mkdir(backupsDir, { recursive: true });
    }

    const latestBackupPath = path.join(backupsDir, 'latest_neon_backup.sql');
    const now = new Date();
    const timestamp = formatBackupTimestamp(now);
    const clientFilename = `neon_backup_${timestamp}.sql`;

    // Ensure server storage remains zero-bloat: clean up any legacy timestamped files if they exist
    try {
        const existingFiles = await fs.promises.readdir(backupsDir);
        for (const f of existingFiles) {
            if (f !== 'latest_neon_backup.sql' && f.endsWith('.sql')) {
                await fs.promises.unlink(path.join(backupsDir, f)).catch(() => {});
            }
        }
    } catch {}

    // Strip -pooler to connect directly to the database endpoint if applicable
    const directDbUrl = rawDbUrl.replace('-pooler', '');
    const cleanDbUrl = directDbUrl.replace(/([?&])schema=[^&]+(&|$)/g, '$1').replace(/[?&]$/, '');

    // 1. Try native pg_dump CLI
    try {
        await new Promise<void>((resolve, reject) => {
            const args = [
                cleanDbUrl,
                '--no-owner',
                '--no-acl',
                '--clean',
                '--if-exists',
                `--file=${latestBackupPath}`
            ];

            execFile('pg_dump', args, { timeout: 60000, maxBuffer: 50 * 1024 * 1024 }, (err, _stdout, stderr) => {
                if (err) {
                    return reject(new Error(`pg_dump failed: ${err.message}${stderr ? ' - ' + stderr : ''}`));
                }
                resolve();
            });
        });

        const stats = await fs.promises.stat(latestBackupPath);
        return {
            filePath: latestBackupPath,
            clientFilename,
            size: stats.size,
            timestamp
        };
    } catch (pgDumpErr: any) {
        console.warn('[DB DUMP] pg_dump failed or not found, using pure-JS SQL exporter fallback:', pgDumpErr.message);

        // 2. Pure-JS SQL exporter fallback
        const sql = await generatePureJsSqlDump(rawDbUrl);
        await fs.promises.writeFile(latestBackupPath, sql, 'utf8');
        const stats = await fs.promises.stat(latestBackupPath);

        return {
            filePath: latestBackupPath,
            clientFilename,
            size: stats.size,
            timestamp
        };
    }
}

/**
 * Get information on the latest backup stored on the server.
 */
export async function getLatestBackupInfo(): Promise<BackupInfo> {
    const latestBackupPath = path.join(process.cwd(), 'backups', 'latest_neon_backup.sql');
    try {
        const stats = await fs.promises.stat(latestBackupPath);
        return {
            exists: true,
            size: stats.size,
            mtime: stats.mtime,
            filename: 'latest_neon_backup.sql'
        };
    } catch {
        return { exists: false };
    }
}
