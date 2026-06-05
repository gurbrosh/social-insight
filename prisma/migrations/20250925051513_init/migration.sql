/*
  Warnings:

  - Added the required column `platform` to the `Scraper` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Scraper" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "name" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "readme_url" TEXT,
    "platform" TEXT NOT NULL,
    "config_json" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "save_to_db" BOOLEAN NOT NULL DEFAULT true,
    "input_type" TEXT NOT NULL DEFAULT 'array',
    "run_iteratively" BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO "new_Scraper" ("actor_id", "config_json", "created_at", "deleted_at", "id", "input_type", "is_active", "name", "readme_url", "run_iteratively", "save_to_db", "updated_at") SELECT "actor_id", "config_json", "created_at", "deleted_at", "id", "input_type", "is_active", "name", "readme_url", "run_iteratively", "save_to_db", "updated_at" FROM "Scraper";
DROP TABLE "Scraper";
ALTER TABLE "new_Scraper" RENAME TO "Scraper";
CREATE UNIQUE INDEX "Scraper_name_key" ON "Scraper"("name");
CREATE INDEX "Scraper_name_idx" ON "Scraper"("name");
CREATE INDEX "Scraper_platform_idx" ON "Scraper"("platform");
CREATE INDEX "Scraper_deleted_at_idx" ON "Scraper"("deleted_at");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
