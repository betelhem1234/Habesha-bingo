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
            CREATE INDEX IF NOT EXISTS "TransactionRequest_assignedAdminId_idx" ON "TransactionRequest"("assignedAdminId");
            CREATE INDEX IF NOT EXISTS "TransactionRequest_processedByAdminId_idx" ON "TransactionRequest"("processedByAdminId");

            -- Backfill withdrawableBalance for existing players based on historical net winnings capped by balance
            UPDATE "User"
            SET "withdrawableBalance" = LEAST("balance", GREATEST(0, (
                COALESCE((SELECT SUM(payout) FROM "GameHistory" WHERE "GameHistory"."userId" = "User"."id" AND "result" = 'WON'), 0) -
                COALESCE((SELECT SUM(amount) FROM "TransactionRequest" WHERE "TransactionRequest"."userId" = "User"."id" AND "type" = 'withdraw' AND "status" = 'APPROVED'), 0)
            )))
            WHERE "withdrawableBalance" = 0 AND "balance" > 0;

            -- Backfill assignedAdminId for unassigned players when an active affiliate admin exists
            UPDATE "User"
            SET "assignedAdminId" = (SELECT id FROM "AdminProfile" WHERE "isActive" = true ORDER BY id ASC LIMIT 1)
            WHERE "assignedAdminId" IS NULL
              AND id NOT IN (SELECT "userId" FROM "AdminProfile")
              AND EXISTS (SELECT 1 FROM "AdminProfile" WHERE "isActive" = true);
        `);
        console.log('[DB] AdminProfile, lineage, and withdrawable balance schema verified successfully.');
    } catch (e: any) {
        console.warn('[DB] Schema init check (non-fatal):', e?.message || e);
    }
}
