-- CreateTable
CREATE TABLE "GithubSignal" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "source" TEXT NOT NULL DEFAULT 'github',
    "keyword" TEXT NOT NULL,
    "signal_type" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "repo_full_name" TEXT NOT NULL,
    "repo_id" INTEGER NOT NULL,
    "repo_url" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "file_path" TEXT,
    "file_url" TEXT,
    "author" TEXT,
    "stars" INTEGER,
    "forks" INTEGER,
    "language" TEXT,
    "event_type" TEXT,
    "published_at" DATETIME,
    "published_at_unix" INTEGER,
    "license" TEXT,
    "default_branch" TEXT,
    "open_issues_count" INTEGER,
    "topics_json" TEXT,
    "raw_payload" JSONB NOT NULL
);

-- CreateTable
CREATE TABLE "GithubIngestCursor" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "keyword" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "cursor_value" TEXT NOT NULL DEFAULT ''
);

-- CreateIndex
CREATE UNIQUE INDEX "GithubSignal_source_keyword_signal_type_external_id_key" ON "GithubSignal"("source", "keyword", "signal_type", "external_id");

-- CreateIndex
CREATE INDEX "GithubSignal_keyword_published_at_unix_idx" ON "GithubSignal"("keyword", "published_at_unix");

-- CreateIndex
CREATE INDEX "GithubSignal_repo_full_name_idx" ON "GithubSignal"("repo_full_name");

-- CreateIndex
CREATE INDEX "GithubSignal_signal_type_idx" ON "GithubSignal"("signal_type");

-- CreateIndex
CREATE INDEX "GithubSignal_deleted_at_idx" ON "GithubSignal"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "GithubIngestCursor_keyword_mode_key" ON "GithubIngestCursor"("keyword", "mode");

-- CreateIndex
CREATE INDEX "GithubIngestCursor_deleted_at_idx" ON "GithubIngestCursor"("deleted_at");
