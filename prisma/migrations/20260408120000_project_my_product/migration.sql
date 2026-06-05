-- AlterTable
ALTER TABLE "Project" ADD COLUMN "my_product_focus_text" TEXT;
ALTER TABLE "Project" ADD COLUMN "my_product_reference_urls" TEXT;
ALTER TABLE "Project" ADD COLUMN "my_product_summary_json" TEXT;
ALTER TABLE "Project" ADD COLUMN "my_product_summary_updated_at" DATETIME;

-- CreateTable
CREATE TABLE "ProjectMyProductDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "project_id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "content_type" TEXT,
    "byte_size" INTEGER,
    CONSTRAINT "ProjectMyProductDocument_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ProjectMyProductDocument_project_id_idx" ON "ProjectMyProductDocument"("project_id");
CREATE INDEX "ProjectMyProductDocument_deleted_at_idx" ON "ProjectMyProductDocument"("deleted_at");
