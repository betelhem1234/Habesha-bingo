-- CreateTable
CREATE TABLE IF NOT EXISTS "AdminProfile" (
    "id" SERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "code" TEXT NOT NULL,
    "customName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AdminProfile_userId_key" ON "AdminProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AdminProfile_code_key" ON "AdminProfile"("code");

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "assignedAdminId" INTEGER;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "User_assignedAdminId_idx" ON "User"("assignedAdminId");

-- AlterTable
ALTER TABLE "PaymentAccount" ADD COLUMN IF NOT EXISTS "adminId" INTEGER;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PaymentAccount_adminId_idx" ON "PaymentAccount"("adminId");
