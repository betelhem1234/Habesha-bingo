-- AlterTable
ALTER TABLE "HouseIncome" ADD COLUMN "winner2Id" BIGINT;
ALTER TABLE "HouseIncome" ADD COLUMN "winnerCount" INTEGER NOT NULL DEFAULT 1;
