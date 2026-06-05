/*
  Warnings:

  - The primary key for the `Post` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `author` on the `Post` table. All the data in the column will be lost.
  - You are about to drop the column `created_at` on the `Post` table. All the data in the column will be lost.
  - You are about to drop the column `deleted_at` on the `Post` table. All the data in the column will be lost.
  - You are about to drop the column `domain` on the `Post` table. All the data in the column will be lost.
  - You are about to drop the column `published_at` on the `Post` table. All the data in the column will be lost.
  - You are about to drop the column `title` on the `Post` table. All the data in the column will be lost.
  - You are about to drop the column `updated_at` on the `Post` table. All the data in the column will be lost.
  - You are about to alter the column `id` on the `Post` table. The data in that column could be lost. The data in that column will be cast from `String` to `Int`.
  - Added the required column `createdAt` to the `Post` table without a default value. This is not possible if the table is not empty.
  - Added the required column `postId` to the `Post` table without a default value. This is not possible if the table is not empty.
  - Made the column `platform` on table `Post` required. This step will fail if there are existing NULL values in that column.

*/
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
    "project_id" TEXT,
    "job_id" TEXT,
    "sentiment" TEXT,
    "summary" TEXT,
    "ai_processed_at" DATETIME,
    CONSTRAINT "Post_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Post_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "ScrapeJob" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Post" ("ai_processed_at", "content", "id", "job_id", "platform", "project_id", "sentiment", "summary", "url") SELECT "ai_processed_at", "content", "id", "job_id", "platform", "project_id", "sentiment", "summary", "url" FROM "Post";
DROP TABLE "Post";
ALTER TABLE "new_Post" RENAME TO "Post";
CREATE INDEX "Post_platform_postId_idx" ON "Post"("platform", "postId");
CREATE INDEX "Post_createdAt_idx" ON "Post"("createdAt");
CREATE INDEX "Post_authorId_idx" ON "Post"("authorId");
CREATE INDEX "Post_project_id_idx" ON "Post"("project_id");
CREATE INDEX "Post_job_id_idx" ON "Post"("job_id");
CREATE INDEX "Post_sentiment_idx" ON "Post"("sentiment");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
