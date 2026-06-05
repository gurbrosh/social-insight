-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ScrapeJob" (
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
    "discarded_count" INTEGER NOT NULL DEFAULT 0,
    "new_count" INTEGER NOT NULL DEFAULT 0,
    "updated_count" INTEGER NOT NULL DEFAULT 0,
    "used_urls" TEXT,
    CONSTRAINT "ScrapeJob_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ScrapeJob_scraper_id_fkey" FOREIGN KEY ("scraper_id") REFERENCES "Scraper" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ScrapeJob" ("apify_run_id", "completed_at", "created_at", "deleted_at", "discarded_count", "error_message", "id", "posts_count", "project_id", "scraper_id", "started_at", "status", "updated_at", "used_urls") SELECT "apify_run_id", "completed_at", "created_at", "deleted_at", "discarded_count", "error_message", "id", "posts_count", "project_id", "scraper_id", "started_at", "status", "updated_at", "used_urls" FROM "ScrapeJob";
DROP TABLE "ScrapeJob";
ALTER TABLE "new_ScrapeJob" RENAME TO "ScrapeJob";
CREATE INDEX "ScrapeJob_project_id_idx" ON "ScrapeJob"("project_id");
CREATE INDEX "ScrapeJob_scraper_id_idx" ON "ScrapeJob"("scraper_id");
CREATE INDEX "ScrapeJob_status_idx" ON "ScrapeJob"("status");
CREATE INDEX "ScrapeJob_deleted_at_idx" ON "ScrapeJob"("deleted_at");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
