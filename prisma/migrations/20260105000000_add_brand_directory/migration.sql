-- CreateTable: BusinessTaxonomy
CREATE TABLE "BusinessTaxonomy" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "category" TEXT NOT NULL,
    "subcategory" TEXT NOT NULL,
    "sub_subcategory" TEXT NOT NULL
);

-- CreateIndex: BusinessTaxonomy composite index
CREATE INDEX "BusinessTaxonomy_category_subcategory_sub_subcategory_idx" ON "BusinessTaxonomy"("category", "subcategory", "sub_subcategory");

-- CreateIndex: BusinessTaxonomy deleted_at
CREATE INDEX "BusinessTaxonomy_deleted_at_idx" ON "BusinessTaxonomy"("deleted_at");

-- CreateUniqueIndex: BusinessTaxonomy unique constraint
CREATE UNIQUE INDEX "BusinessTaxonomy_category_subcategory_sub_subcategory_key" ON "BusinessTaxonomy"("category", "subcategory", "sub_subcategory");

-- CreateTable: Brand
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "business_taxonomy_id" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "brand_name" TEXT NOT NULL,
    "brand_stage" TEXT NOT NULL,
    "website_url" TEXT,
    "careers_url" TEXT,
    "linkedin_url" TEXT,
    "facebook_url" TEXT,
    "x_url" TEXT,
    "instagram_url" TEXT,
    "tiktok_url" TEXT,
    "youtube_url" TEXT,
    "discord_url" TEXT,
    CONSTRAINT "Brand_business_taxonomy_id_fkey" FOREIGN KEY ("business_taxonomy_id") REFERENCES "BusinessTaxonomy" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex: Brand business_taxonomy_id
CREATE INDEX "Brand_business_taxonomy_id_idx" ON "Brand"("business_taxonomy_id");

-- CreateIndex: Brand brand_stage
CREATE INDEX "Brand_brand_stage_idx" ON "Brand"("brand_stage");

-- CreateIndex: Brand company_name
CREATE INDEX "Brand_company_name_idx" ON "Brand"("company_name");

-- CreateIndex: Brand brand_name
CREATE INDEX "Brand_brand_name_idx" ON "Brand"("brand_name");

-- CreateIndex: Brand deleted_at
CREATE INDEX "Brand_deleted_at_idx" ON "Brand"("deleted_at");

-- CreateTable: BrandKeyword
CREATE TABLE "BrandKeyword" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "brand_id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    CONSTRAINT "BrandKeyword_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "Brand" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex: BrandKeyword brand_id
CREATE INDEX "BrandKeyword_brand_id_idx" ON "BrandKeyword"("brand_id");

-- CreateIndex: BrandKeyword keyword
CREATE INDEX "BrandKeyword_keyword_idx" ON "BrandKeyword"("keyword");

-- CreateUniqueIndex: BrandKeyword unique constraint
CREATE UNIQUE INDEX "BrandKeyword_brand_id_keyword_key" ON "BrandKeyword"("brand_id", "keyword");

-- CreateIndex: BrandKeyword deleted_at
CREATE INDEX "BrandKeyword_deleted_at_idx" ON "BrandKeyword"("deleted_at");

-- AlterTable: Add brand_id to ProjectBrand
ALTER TABLE "ProjectBrand" ADD COLUMN "brand_id" TEXT;

-- CreateIndex: ProjectBrand brand_id
CREATE INDEX "ProjectBrand_brand_id_idx" ON "ProjectBrand"("brand_id");

-- AddForeignKey: ProjectBrand brand_id
-- Note: SQLite doesn't support adding foreign key constraints to existing tables
-- The foreign key will be enforced by Prisma at the application level

