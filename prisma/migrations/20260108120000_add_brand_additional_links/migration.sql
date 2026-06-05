-- CreateTable
CREATE TABLE "BrandAdditionalLink" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "brand_id" TEXT NOT NULL,
    "link_type" TEXT NOT NULL,
    "platform" TEXT,
    "url" TEXT NOT NULL,
    CONSTRAINT "BrandAdditionalLink_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "Brand" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "BrandAdditionalLink_brand_id_link_type_platform_url_key" ON "BrandAdditionalLink"("brand_id", "link_type", "platform", "url");

-- CreateIndex
CREATE INDEX "BrandAdditionalLink_brand_id_idx" ON "BrandAdditionalLink"("brand_id");

-- CreateIndex
CREATE INDEX "BrandAdditionalLink_link_type_idx" ON "BrandAdditionalLink"("link_type");

-- CreateIndex
CREATE INDEX "BrandAdditionalLink_platform_idx" ON "BrandAdditionalLink"("platform");

-- CreateIndex
CREATE INDEX "BrandAdditionalLink_deleted_at_idx" ON "BrandAdditionalLink"("deleted_at");

