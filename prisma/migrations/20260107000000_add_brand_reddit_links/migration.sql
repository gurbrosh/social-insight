-- CreateTable
CREATE TABLE "BrandRedditLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "brand_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    CONSTRAINT "BrandRedditLink_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "Brand" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "BrandRedditLink_brand_id_url_key" ON "BrandRedditLink"("brand_id", "url");

-- CreateIndex
CREATE INDEX "BrandRedditLink_brand_id_idx" ON "BrandRedditLink"("brand_id");

-- CreateIndex
CREATE INDEX "BrandRedditLink_deleted_at_idx" ON "BrandRedditLink"("deleted_at");

