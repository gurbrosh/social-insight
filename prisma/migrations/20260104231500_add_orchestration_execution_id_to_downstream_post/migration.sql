-- AlterTable: Add orchestration_execution_id column to DownstreamPost
ALTER TABLE "DownstreamPost" ADD COLUMN "orchestration_execution_id" TEXT;

-- CreateIndex: Add index for orchestration_execution_id column
CREATE INDEX "DownstreamPost_orchestration_execution_id_idx" ON "DownstreamPost"("orchestration_execution_id");

-- AddForeignKey: Add foreign key constraint
-- Note: SQLite doesn't support adding foreign key constraints to existing tables
-- The foreign key will be enforced by Prisma at the application level
