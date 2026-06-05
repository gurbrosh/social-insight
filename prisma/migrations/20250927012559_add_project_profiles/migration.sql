-- CreateTable
CREATE TABLE "ProjectProfile" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "project_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "is_selected" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "ProjectProfile_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ProjectProfile_project_id_idx" ON "ProjectProfile"("project_id");

-- CreateIndex
CREATE INDEX "ProjectProfile_platform_idx" ON "ProjectProfile"("platform");

-- CreateIndex
CREATE INDEX "ProjectProfile_deleted_at_idx" ON "ProjectProfile"("deleted_at");
