import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const connectionString = process.env.DATABASE_URL || '';
const pool = new Pool({
    connectionString,
    max: 25,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
});
const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter });

export async function initDbSchema() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS "SystemSetting" (
                "key" TEXT PRIMARY KEY,
                "value" TEXT NOT NULL,
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS "AdminProfile" (
                "id" SERIAL PRIMARY KEY,
                "userId" BIGINT NOT NULL UNIQUE,
                "code" TEXT NOT NULL UNIQUE,
                "customName" TEXT,
                "isActive" BOOLEAN NOT NULL DEFAULT true,
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "assignedAdminId" INTEGER;
            CREATE INDEX IF NOT EXISTS "User_assignedAdminId_idx" ON "User"("assignedAdminId");
            ALTER TABLE "PaymentAccount" ADD COLUMN IF NOT EXISTS "adminId" INTEGER;
            CREATE INDEX IF NOT EXISTS "PaymentAccount_adminId_idx" ON "PaymentAccount"("adminId");
            ALTER TABLE "AdminProfile" ADD COLUMN IF NOT EXISTS "isWithdrawalAdmin" BOOLEAN NOT NULL DEFAULT false;
            CREATE INDEX IF NOT EXISTS "AdminProfile_isWithdrawalAdmin_idx" ON "AdminProfile"("isWithdrawalAdmin");
            ALTER TABLE "AdminProfile" ADD COLUMN IF NOT EXISTS "depositLimit" DECIMAL(65, 30) NOT NULL DEFAULT 3000.0;
            ALTER TABLE "AdminProfile" ADD COLUMN IF NOT EXISTS "collectedDeposits" DECIMAL(65, 30) NOT NULL DEFAULT 0.0;
            ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "withdrawableBalance" DECIMAL(65, 30) NOT NULL DEFAULT 0.0;
            ALTER TABLE "TransactionRequest" ADD COLUMN IF NOT EXISTS "assignedAdminId" INTEGER;
            ALTER TABLE "TransactionRequest" ADD COLUMN IF NOT EXISTS "processedByAdminId" INTEGER;
            ALTER TABLE "TransactionRequest" ADD COLUMN IF NOT EXISTS "processedByName" TEXT;
            ALTER TABLE "TransactionRequest" ADD COLUMN IF NOT EXISTS "actionAt" TIMESTAMP(3);
            ALTER TABLE "TransactionRequest" ADD COLUMN IF NOT EXISTS "tgNotifications" TEXT;
            CREATE INDEX IF NOT EXISTS "TransactionRequest_assignedAdminId_idx" ON "TransactionRequest"("assignedAdminId");
            CREATE INDEX IF NOT EXISTS "TransactionRequest_processedByAdminId_idx" ON "TransactionRequest"("processedByAdminId");

            ALTER TABLE "HouseIncome" ADD COLUMN IF NOT EXISTS "fee" INTEGER NOT NULL DEFAULT 10;
            ALTER TABLE "HouseIncome" ADD COLUMN IF NOT EXISTS "room" INTEGER NOT NULL DEFAULT 1;
            CREATE INDEX IF NOT EXISTS "HouseIncome_fee_room_idx" ON "HouseIncome"("fee", "room");

            -- Backfill withdrawableBalance for existing players based on historical net winnings capped by balance
            UPDATE "User"
            SET "withdrawableBalance" = LEAST("balance", GREATEST(0, (
                COALESCE((SELECT SUM(payout) FROM "GameHistory" WHERE "GameHistory"."userId" = "User"."id" AND "result" = 'WON'), 0) -
                COALESCE((SELECT SUM(amount) FROM "TransactionRequest" WHERE "TransactionRequest"."userId" = "User"."id" AND "type" = 'withdraw' AND "status" = 'APPROVED'), 0)
            )))
            WHERE "withdrawableBalance" = 0 AND "balance" > 0;

            -- Ensure user 1783441823 exists in User table
            INSERT INTO "User" ("id", "firstName", "balance", "bonus", "updatedAt")
            VALUES (1783441823, 'Admin Abrham', 0.0, 0.0, CURRENT_TIMESTAMP)
            ON CONFLICT ("id") DO NOTHING;

            -- Ensure AdminProfile for adm_1783441823 exists
            INSERT INTO "AdminProfile" ("userId", "code", "customName", "isActive")
            VALUES (1783441823, 'adm_1783441823', 'Admin Abrham', true)
            ON CONFLICT ("userId") DO UPDATE SET "code" = 'adm_1783441823', "isActive" = true;

            -- Backfill all unassigned / unreferred players to adm_1783441823 (excluding himself & Super Admin)
            UPDATE "User"
            SET "referredById" = 1783441823,
                "assignedAdminId" = (SELECT id FROM "AdminProfile" WHERE "userId" = 1783441823 LIMIT 1)
            WHERE ("referredById" IS NULL OR "assignedAdminId" IS NULL)
              AND "id" != 1783441823
              AND "id" != 5630606223;
        `);
        console.log('[DB] AdminProfile, lineage (backfilled to adm_1783441823), and withdrawable balance schema verified successfully.');
    } catch (e: any) {
        console.warn('[DB] Schema init check (non-fatal):', e?.message || e);
    }
}

/**
 * Resolves the active affiliate admin with the fewest assigned users
 * to fairly balance organic / unreferred player traffic.
 */
export async function getBalancedActiveAdminId(): Promise<number | null> {
    try {
        const activeAdmins = await prisma.adminProfile.findMany({
            where: { isActive: true },
            select: {
                id: true,
                _count: {
                    select: { assignedUsers: true }
                }
            },
            orderBy: { id: 'asc' }
        });
        if (!activeAdmins || activeAdmins.length === 0) return null;

        // Admin with the lowest user count gets the next player
        activeAdmins.sort((a, b) => a._count.assignedUsers - b._count.assignedUsers);
        const target = activeAdmins[0];
        return target ? target.id : null;
    } catch (e) {
        console.error('getBalancedActiveAdminId error:', e);
        return null;
    }
}

export async function getSystemSettingDb(key: string): Promise<string | null> {
    try {
        const res = await pool.query('SELECT "value" FROM "SystemSetting" WHERE "key" = $1 LIMIT 1', [key]);
        return res.rows[0]?.value ?? null;
    } catch {
        return null;
    }
}

export async function setSystemSettingDb(key: string, value: string): Promise<void> {
    try {
        await pool.query(`
            INSERT INTO "SystemSetting" ("key", "value", "updatedAt")
            VALUES ($1, $2, CURRENT_TIMESTAMP)
            ON CONFLICT ("key") DO UPDATE SET "value" = $2, "updatedAt" = CURRENT_TIMESTAMP
        `, [key, value]);
    } catch (e: any) {
        if (e?.code === '42P01') {
            try {
                await pool.query(`
                    CREATE TABLE IF NOT EXISTS "SystemSetting" (
                        "key" TEXT PRIMARY KEY,
                        "value" TEXT NOT NULL,
                        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
                    );
                `);
                await pool.query(`
                    INSERT INTO "SystemSetting" ("key", "value", "updatedAt")
                    VALUES ($1, $2, CURRENT_TIMESTAMP)
                    ON CONFLICT ("key") DO UPDATE SET "value" = $2, "updatedAt" = CURRENT_TIMESTAMP
                `, [key, value]);
                return;
            } catch {}
        }
        console.error(`[DB] Failed to save setting "${key}":`, e?.message || e);
    }
}

export async function getAllSystemSettingsDb(): Promise<Record<string, string>> {
    try {
        const res = await pool.query('SELECT "key", "value" FROM "SystemSetting"');
        const map: Record<string, string> = {};
        for (const row of res.rows) {
            map[row.key] = row.value;
        }
        return map;
    } catch {
        return {};
    }
}
