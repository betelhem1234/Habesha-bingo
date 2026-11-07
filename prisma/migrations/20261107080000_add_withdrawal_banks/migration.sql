-- CreateTable
CREATE TABLE IF NOT EXISTS "WithdrawalBank" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isFast" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WithdrawalBank_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WithdrawalBank_name_key" ON "WithdrawalBank"("name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WithdrawalBank_isActive_idx" ON "WithdrawalBank"("isActive");
