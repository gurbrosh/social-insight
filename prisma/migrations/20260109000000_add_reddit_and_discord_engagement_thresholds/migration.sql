-- AlterTable: Add reddit_engagement_threshold and discord_engagement_threshold columns to Project
ALTER TABLE "Project" ADD COLUMN "reddit_engagement_threshold" INTEGER;
ALTER TABLE "Project" ADD COLUMN "discord_engagement_threshold" INTEGER;


