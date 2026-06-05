ALTER TABLE "DownstreamPost" ADD COLUMN "authorProfileUrl" TEXT;
ALTER TABLE "DownstreamPost" ADD COLUMN "authorHeadline" TEXT;
ALTER TABLE "DownstreamPost" ADD COLUMN "authorImageUrl" TEXT;
ALTER TABLE "DownstreamPost" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'SEARCH_RESULT';
ALTER TABLE "DownstreamPost" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "DownstreamPost" ADD COLUMN "search_query" TEXT;
ALTER TABLE "DownstreamPost" ADD COLUMN "processing_started_at" DATETIME;
ALTER TABLE "DownstreamPost" ADD COLUMN "processed_at" DATETIME;
ALTER TABLE "DownstreamPost" ADD COLUMN "expires_at" DATETIME;

CREATE INDEX "DownstreamPost_status_idx" ON "DownstreamPost"("status");
CREATE INDEX "DownstreamPost_origin_idx" ON "DownstreamPost"("origin");
CREATE INDEX "DownstreamPost_project_id_origScraper_status_idx" ON "DownstreamPost"("project_id", "origScraper", "status");

