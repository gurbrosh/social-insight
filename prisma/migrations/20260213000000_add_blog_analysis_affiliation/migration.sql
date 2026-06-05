-- PostAffiliation enum is stored as TEXT in SQLite; Prisma validates at application level.
-- AlterTable
ALTER TABLE "BlogNewsAnalysis" ADD COLUMN "affiliation" TEXT;
