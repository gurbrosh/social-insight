-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProjectBrand" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "project_id" TEXT NOT NULL,
    "brand_name" TEXT NOT NULL,
    "is_selected" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "ProjectBrand_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ProjectBrand" ("brand_name", "created_at", "deleted_at", "id", "is_selected", "project_id", "updated_at") SELECT "brand_name", "created_at", "deleted_at", "id", "is_selected", "project_id", "updated_at" FROM "ProjectBrand";
DROP TABLE "ProjectBrand";
ALTER TABLE "new_ProjectBrand" RENAME TO "ProjectBrand";
CREATE INDEX "ProjectBrand_project_id_idx" ON "ProjectBrand"("project_id");
CREATE INDEX "ProjectBrand_deleted_at_idx" ON "ProjectBrand"("deleted_at");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
