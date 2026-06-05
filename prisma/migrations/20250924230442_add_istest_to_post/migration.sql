-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Post" (
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
    CONSTRAINT "Post_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Post_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "ScrapeJob" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Post" ("ai_processed_at", "authorId", "authorName", "channelId", "content", "createdAt", "editedAt", "extraJson", "id", "job_id", "media", "metricsComments", "metricsLikes", "metricsShares", "platform", "postId", "project_id", "sentiment", "summary", "threadRefId", "url") SELECT "ai_processed_at", "authorId", "authorName", "channelId", "content", "createdAt", "editedAt", "extraJson", "id", "job_id", "media", "metricsComments", "metricsLikes", "metricsShares", "platform", "postId", "project_id", "sentiment", "summary", "threadRefId", "url" FROM "Post";
DROP TABLE "Post";
ALTER TABLE "new_Post" RENAME TO "Post";
CREATE INDEX "Post_platform_postId_idx" ON "Post"("platform", "postId");
CREATE INDEX "Post_createdAt_idx" ON "Post"("createdAt");
CREATE INDEX "Post_authorId_idx" ON "Post"("authorId");
CREATE INDEX "Post_project_id_idx" ON "Post"("project_id");
CREATE INDEX "Post_job_id_idx" ON "Post"("job_id");
CREATE INDEX "Post_sentiment_idx" ON "Post"("sentiment");
CREATE INDEX "Post_isTest_idx" ON "Post"("isTest");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
