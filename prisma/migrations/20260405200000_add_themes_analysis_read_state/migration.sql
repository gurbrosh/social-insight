-- AlterTable
ALTER TABLE "ThemesAnalysis" ADD COLUMN "is_read" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ThemesAnalysis" ADD COLUMN "read_url_key" TEXT;

-- CreateIndex
CREATE INDEX "ThemesAnalysis_project_id_read_url_key_idx" ON "ThemesAnalysis"("project_id", "read_url_key");
