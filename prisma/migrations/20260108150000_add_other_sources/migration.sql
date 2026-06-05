-- Note: SQLite doesn't support ALTER TYPE for enums
-- The enum values are stored as TEXT in SQLite, so no migration is needed
-- Prisma will handle the enum validation at the application level

-- Add source_category column
ALTER TABLE "BrandAdditionalLink" ADD COLUMN "source_category" TEXT;

-- Create index for source_category
CREATE INDEX "BrandAdditionalLink_source_category_idx" ON "BrandAdditionalLink"("source_category");

-- Drop old unique constraint and create new one with source_category
DROP INDEX IF EXISTS "BrandAdditionalLink_brand_id_link_type_platform_url_key";
CREATE UNIQUE INDEX "BrandAdditionalLink_brand_id_link_type_platform_source_category_url_key" ON "BrandAdditionalLink"("brand_id", "link_type", "platform", "source_category", "url");


