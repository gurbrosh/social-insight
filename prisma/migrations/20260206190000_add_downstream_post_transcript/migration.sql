-- AlterTable: Add transcript column to DownstreamPost (YouTube video transcript + AI summary)
ALTER TABLE "DownstreamPost" ADD COLUMN "transcript" TEXT;
