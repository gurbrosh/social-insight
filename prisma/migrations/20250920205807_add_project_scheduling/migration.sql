-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "user_id" TEXT NOT NULL,
    "schedule_enabled" BOOLEAN NOT NULL DEFAULT false,
    "schedule_cron" TEXT,
    "schedule_timezone" TEXT DEFAULT 'UTC',
    "last_scheduled_at" DATETIME,
    "next_scheduled_at" DATETIME,
    CONSTRAINT "Project_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Project" ("created_at", "deleted_at", "description", "id", "name", "updated_at", "user_id") SELECT "created_at", "deleted_at", "description", "id", "name", "updated_at", "user_id" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
CREATE INDEX "Project_user_id_idx" ON "Project"("user_id");
CREATE INDEX "Project_deleted_at_idx" ON "Project"("deleted_at");
CREATE INDEX "Project_next_scheduled_at_idx" ON "Project"("next_scheduled_at");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
