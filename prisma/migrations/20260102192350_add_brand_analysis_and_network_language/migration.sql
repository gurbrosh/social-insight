-- CreateTable: BrandAnalysis
CREATE TABLE "BrandAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "project_id" TEXT NOT NULL,
    "post_id" INTEGER NOT NULL,
    "brand_name" TEXT NOT NULL,
    "sentiment" TEXT NOT NULL,
    "mention_timestamp" DATETIME NOT NULL,
    CONSTRAINT "BrandAnalysis_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BrandAnalysis_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "Post" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "BrandAnalysis_project_id_post_id_brand_name_key" ON "BrandAnalysis"("project_id", "post_id", "brand_name");

-- CreateIndex
CREATE INDEX "BrandAnalysis_project_id_idx" ON "BrandAnalysis"("project_id");

-- CreateIndex
CREATE INDEX "BrandAnalysis_post_id_idx" ON "BrandAnalysis"("post_id");

-- CreateIndex
CREATE INDEX "BrandAnalysis_brand_name_idx" ON "BrandAnalysis"("brand_name");

-- CreateIndex
CREATE INDEX "BrandAnalysis_sentiment_idx" ON "BrandAnalysis"("sentiment");

-- CreateIndex
CREATE INDEX "BrandAnalysis_mention_timestamp_idx" ON "BrandAnalysis"("mention_timestamp");

-- CreateIndex
CREATE INDEX "BrandAnalysis_deleted_at_idx" ON "BrandAnalysis"("deleted_at");

-- AlterTable: Add missing columns to NetworkAnalysis
ALTER TABLE "NetworkAnalysis" ADD COLUMN "language" TEXT;

ALTER TABLE "NetworkAnalysis" ADD COLUMN "earliest_post_at" DATETIME;

ALTER TABLE "NetworkAnalysis" ADD COLUMN "latest_post_at" DATETIME;

-- CreateIndex: Add index for language column
CREATE INDEX "NetworkAnalysis_language_idx" ON "NetworkAnalysis"("language");

-- CreateIndex: Add index for latest_post_at column
CREATE INDEX "NetworkAnalysis_latest_post_at_idx" ON "NetworkAnalysis"("latest_post_at");

