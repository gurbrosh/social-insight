-- CreateTable
CREATE TABLE "ProjectSource" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "project_id" TEXT NOT NULL,
    "source_name" TEXT NOT NULL,
    "is_selected" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "ProjectSource_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ProjectSource_project_id_idx" ON "ProjectSource"("project_id");

-- CreateIndex
CREATE INDEX "ProjectSource_deleted_at_idx" ON "ProjectSource"("deleted_at");
