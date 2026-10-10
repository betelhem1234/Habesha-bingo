-- AlterTable AdminProfile
ALTER TABLE "AdminProfile" ADD COLUMN IF NOT EXISTS "isWithdrawalAdmin" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AdminProfile_isWithdrawalAdmin_idx" ON "AdminProfile"("isWithdrawalAdmin");

-- AlterTable User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "withdrawableBalance" DECIMAL(65, 30) NOT NULL DEFAULT 0.0;

-- Backfill withdrawableBalance for existing players based on historical net winnings capped by balance
UPDATE "User"
SET "withdrawableBalance" = LEAST("balance", GREATEST(0, (
    COALESCE((SELECT SUM(payout) FROM "GameHistory" WHERE "GameHistory"."userId" = "User"."id" AND "result" = 'WON'), 0) -
    COALESCE((SELECT SUM(amount) FROM "TransactionRequest" WHERE "TransactionRequest"."userId" = "User"."id" AND "type" = 'withdraw' AND "status" = 'APPROVED'), 0)
)))
WHERE "withdrawableBalance" = 0 AND "balance" > 0;
