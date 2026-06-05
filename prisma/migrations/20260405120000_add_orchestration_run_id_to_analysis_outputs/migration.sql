-- AlterTable
ALTER TABLE "PostNews" ADD COLUMN "orchestration_run_id" TEXT;

-- AlterTable
ALTER TABLE "NetworkAnalysis" ADD COLUMN "orchestration_run_id" TEXT;

-- AlterTable
ALTER TABLE "ChatterAnalysis" ADD COLUMN "orchestration_run_id" TEXT;

-- AlterTable
ALTER TABLE "ThemesAnalysis" ADD COLUMN "orchestration_run_id" TEXT;

-- CreateIndex
CREATE INDEX "PostNews_orchestration_run_id_idx" ON "PostNews"("orchestration_run_id");

-- CreateIndex
CREATE INDEX "NetworkAnalysis_orchestration_run_id_idx" ON "NetworkAnalysis"("orchestration_run_id");

-- CreateIndex
CREATE INDEX "ChatterAnalysis_orchestration_run_id_idx" ON "ChatterAnalysis"("orchestration_run_id");

-- CreateIndex
CREATE INDEX "ThemesAnalysis_orchestration_run_id_idx" ON "ThemesAnalysis"("orchestration_run_id");
