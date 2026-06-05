-- AlterTable
ALTER TABLE "Brand" ADD COLUMN "approved" BOOLEAN NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Brand_approved_idx" ON "Brand"("approved");

