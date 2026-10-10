-- AlterTable
ALTER TABLE "TransactionRequest" ADD COLUMN "assignedAdminId" INTEGER;
ALTER TABLE "TransactionRequest" ADD COLUMN "processedByAdminId" INTEGER;
ALTER TABLE "TransactionRequest" ADD COLUMN "processedByName" TEXT;
ALTER TABLE "TransactionRequest" ADD COLUMN "actionAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "TransactionRequest_assignedAdminId_idx" ON "TransactionRequest"("assignedAdminId");
CREATE INDEX "TransactionRequest_processedByAdminId_idx" ON "TransactionRequest"("processedByAdminId");

-- AddForeignKey
ALTER TABLE "TransactionRequest" ADD CONSTRAINT "TransactionRequest_assignedAdminId_fkey" FOREIGN KEY ("assignedAdminId") REFERENCES "AdminProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionRequest" ADD CONSTRAINT "TransactionRequest_processedByAdminId_fkey" FOREIGN KEY ("processedByAdminId") REFERENCES "AdminProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
