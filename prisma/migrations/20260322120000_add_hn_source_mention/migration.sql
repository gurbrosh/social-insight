-- CreateTable
CREATE TABLE "SourceMention" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "source" TEXT NOT NULL DEFAULT 'hackernews',
    "keyword" TEXT NOT NULL,
    "source_item_id" TEXT NOT NULL,
    "item_type" TEXT NOT NULL,
    "author" TEXT,
    "title" TEXT,
    "body" TEXT,
    "url" TEXT,
    "published_at" DATETIME,
    "published_at_unix" INTEGER,
    "story_id" TEXT,
    "parent_id" TEXT,
    "story_title" TEXT,
    "story_url" TEXT,
    "story_score" INTEGER,
    "story_descendants" INTEGER,
    "raw_payload" JSONB NOT NULL
);

-- CreateTable
CREATE TABLE "HnKeywordIngestCursor" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "keyword" TEXT NOT NULL,
    "last_success_unix" INTEGER NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "SourceMention_source_source_item_id_keyword_key" ON "SourceMention"("source", "source_item_id", "keyword");

-- CreateIndex
CREATE INDEX "SourceMention_keyword_published_at_unix_idx" ON "SourceMention"("keyword", "published_at_unix");

-- CreateIndex
CREATE INDEX "SourceMention_story_id_idx" ON "SourceMention"("story_id");

-- CreateIndex
CREATE INDEX "SourceMention_deleted_at_idx" ON "SourceMention"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "HnKeywordIngestCursor_keyword_key" ON "HnKeywordIngestCursor"("keyword");

-- CreateIndex
CREATE INDEX "HnKeywordIngestCursor_deleted_at_idx" ON "HnKeywordIngestCursor"("deleted_at");
