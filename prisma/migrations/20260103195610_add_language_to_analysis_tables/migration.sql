-- AlterTable: Add language column to PostNews
ALTER TABLE "PostNews" ADD COLUMN "language" TEXT;

-- CreateIndex: Add index for language column
CREATE INDEX "PostNews_language_idx" ON "PostNews"("language");

-- AlterTable: Add language column to ChatterAnalysis
ALTER TABLE "ChatterAnalysis" ADD COLUMN "language" TEXT;

-- CreateIndex: Add index for language column
CREATE INDEX "ChatterAnalysis_language_idx" ON "ChatterAnalysis"("language");

-- AlterTable: Add discord_channel and discord_server columns to ChatterAnalysis
ALTER TABLE "ChatterAnalysis" ADD COLUMN "discord_channel" TEXT;
ALTER TABLE "ChatterAnalysis" ADD COLUMN "discord_server" TEXT;

-- AlterTable: Add language column to ThemesAnalysis
ALTER TABLE "ThemesAnalysis" ADD COLUMN "language" TEXT;

-- CreateIndex: Add index for language column
CREATE INDEX "ThemesAnalysis_language_idx" ON "ThemesAnalysis"("language");

