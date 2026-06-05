-- AlterTable (SQLite stores JSON as TEXT; Prisma maps Json fields accordingly)
ALTER TABLE "ThemesAnalysis" ADD COLUMN "response_generation_errors" TEXT;
