-- CreateTable
CREATE TABLE "HnStoryCommentTheme" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "hn_story_id" TEXT NOT NULL,
    "story_url" TEXT,
    "story_title" TEXT,
    "story_posted_at" DATETIME,
    "comment_themes_summary" TEXT,
    "meta" JSONB
);

-- CreateIndex
CREATE UNIQUE INDEX "HnStoryCommentTheme_hn_story_id_key" ON "HnStoryCommentTheme"("hn_story_id");

-- CreateIndex
CREATE INDEX "HnStoryCommentTheme_deleted_at_idx" ON "HnStoryCommentTheme"("deleted_at");
