-- CreateTable
CREATE TABLE "DownstreamPost" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "platform" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT,
    "content" TEXT,
    "createdAt" DATETIME NOT NULL,
    "editedAt" DATETIME,
    "url" TEXT,
    "channelId" TEXT,
    "threadRefId" TEXT,
    "media" JSONB,
    "metricsLikes" INTEGER,
    "metricsComments" INTEGER,
    "metricsShares" INTEGER,
    "extraJson" JSONB,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "project_id" TEXT,
    "job_id" TEXT,
    "sentiment" TEXT,
    "summary" TEXT,
    "ai_processed_at" DATETIME,
    "origScraper" TEXT NOT NULL,
    CONSTRAINT "DownstreamPost_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DownstreamPost_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "ScrapeJob" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "DownstreamPost_platform_postId_idx" ON "DownstreamPost"("platform", "postId");

-- CreateIndex
CREATE INDEX "DownstreamPost_createdAt_idx" ON "DownstreamPost"("createdAt");

-- CreateIndex
CREATE INDEX "DownstreamPost_authorId_idx" ON "DownstreamPost"("authorId");

-- CreateIndex
CREATE INDEX "DownstreamPost_project_id_idx" ON "DownstreamPost"("project_id");

-- CreateIndex
CREATE INDEX "DownstreamPost_job_id_idx" ON "DownstreamPost"("job_id");

-- CreateIndex
CREATE INDEX "DownstreamPost_sentiment_idx" ON "DownstreamPost"("sentiment");

-- CreateIndex
CREATE INDEX "DownstreamPost_isTest_idx" ON "DownstreamPost"("isTest");

-- CreateIndex
CREATE INDEX "DownstreamPost_origScraper_idx" ON "DownstreamPost"("origScraper");
