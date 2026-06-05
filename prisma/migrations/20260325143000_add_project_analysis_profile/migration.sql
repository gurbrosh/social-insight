-- AlterTable
ALTER TABLE "Project" ADD COLUMN "analysis_profile" TEXT NOT NULL DEFAULT 'full';
ALTER TABLE "Project" ADD COLUMN "analysis_sample_post_limit" INTEGER;
