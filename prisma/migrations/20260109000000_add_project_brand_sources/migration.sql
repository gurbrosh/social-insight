-- CreateTable
CREATE TABLE "ProjectBrandSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "project_id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "link_type" TEXT NOT NULL,
    "platform" TEXT,
    "source_category" TEXT,
    "url" TEXT NOT NULL,
    "channel_name" TEXT,
    CONSTRAINT "ProjectBrandSource_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProjectBrandSource_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "Brand" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ProjectBrandSource_project_id_idx" ON "ProjectBrandSource"("project_id");

-- CreateIndex
CREATE INDEX "ProjectBrandSource_brand_id_idx" ON "ProjectBrandSource"("brand_id");

-- CreateIndex
CREATE INDEX "ProjectBrandSource_deleted_at_idx" ON "ProjectBrandSource"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectBrandSource_project_id_brand_id_url_key" ON "ProjectBrandSource"("project_id", "brand_id", "url");


