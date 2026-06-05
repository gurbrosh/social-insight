-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "user_id" TEXT NOT NULL,
    CONSTRAINT "Project_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectKeyword" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "project_id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    CONSTRAINT "ProjectKeyword_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Scraper" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "name" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "config_json" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "save_to_db" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "ScrapeJob" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "project_id" TEXT NOT NULL,
    "scraper_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "apify_run_id" TEXT,
    "started_at" DATETIME,
    "completed_at" DATETIME,
    "error_message" TEXT,
    "posts_count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ScrapeJob_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ScrapeJob_scraper_id_fkey" FOREIGN KEY ("scraper_id") REFERENCES "Scraper" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "project_id" TEXT NOT NULL,
    "job_id" TEXT,
    "content" TEXT NOT NULL,
    "title" TEXT,
    "author" TEXT,
    "domain" TEXT,
    "url" TEXT,
    "published_at" DATETIME,
    "platform" TEXT,
    "sentiment" TEXT,
    "summary" TEXT,
    "ai_processed_at" DATETIME,
    CONSTRAINT "Post_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Post_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "ScrapeJob" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Project_user_id_idx" ON "Project"("user_id");

-- CreateIndex
CREATE INDEX "Project_deleted_at_idx" ON "Project"("deleted_at");

-- CreateIndex
CREATE INDEX "ProjectKeyword_project_id_idx" ON "ProjectKeyword"("project_id");

-- CreateIndex
CREATE INDEX "ProjectKeyword_deleted_at_idx" ON "ProjectKeyword"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "Scraper_name_key" ON "Scraper"("name");

-- CreateIndex
CREATE INDEX "Scraper_name_idx" ON "Scraper"("name");

-- CreateIndex
CREATE INDEX "Scraper_deleted_at_idx" ON "Scraper"("deleted_at");

-- CreateIndex
CREATE INDEX "ScrapeJob_project_id_idx" ON "ScrapeJob"("project_id");

-- CreateIndex
CREATE INDEX "ScrapeJob_scraper_id_idx" ON "ScrapeJob"("scraper_id");

-- CreateIndex
CREATE INDEX "ScrapeJob_status_idx" ON "ScrapeJob"("status");

-- CreateIndex
CREATE INDEX "ScrapeJob_deleted_at_idx" ON "ScrapeJob"("deleted_at");

-- CreateIndex
CREATE INDEX "Post_project_id_idx" ON "Post"("project_id");

-- CreateIndex
CREATE INDEX "Post_job_id_idx" ON "Post"("job_id");

-- CreateIndex
CREATE INDEX "Post_published_at_idx" ON "Post"("published_at");

-- CreateIndex
CREATE INDEX "Post_sentiment_idx" ON "Post"("sentiment");

-- CreateIndex
CREATE INDEX "Post_deleted_at_idx" ON "Post"("deleted_at");
