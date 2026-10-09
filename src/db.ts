import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const connectionString = process.env.DATABASE_URL || '';
const pool = new Pool({ connectionString });
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
        `);
        console.log('[DB] AdminProfile and lineage schema verified successfully.');
    } catch (e: any) {
        console.warn('[DB] Schema init check (non-fatal):', e?.message || e);
    }
}
