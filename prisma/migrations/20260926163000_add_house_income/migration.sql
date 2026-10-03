-- CreateTable
CREATE TABLE "HouseIncome" (
    "id" SERIAL NOT NULL,
    "gameType" TEXT NOT NULL,
    "playerCount" INTEGER NOT NULL,
    "totalCollected" DECIMAL(65,30) NOT NULL,
    "winnerPayout" DECIMAL(65,30) NOT NULL,
    "houseProfit" DECIMAL(65,30) NOT NULL,
    "winnerId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HouseIncome_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HouseIncome_createdAt_idx" ON "HouseIncome"("createdAt");
