-- AlterTable: Add engagement threshold columns to Project
ALTER TABLE "Project" ADD COLUMN "linkedin_engagement_threshold" INTEGER;
ALTER TABLE "Project" ADD COLUMN "facebook_engagement_threshold" INTEGER;
ALTER TABLE "Project" ADD COLUMN "twitter_engagement_threshold" INTEGER;
