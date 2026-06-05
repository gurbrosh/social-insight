-- Add unique constraint so the same (category, subcategory, sub_subcategory, source_category, url)
-- cannot be stored more than once. Run scripts/cleanup-duplicate-taxonomy-other-source-links.ts
-- BEFORE applying this migration to soft-delete existing duplicates.
CREATE UNIQUE INDEX "TaxonomyOtherSourceLink_category_subcategory_sub_subcategory_source_category_url_key" ON "TaxonomyOtherSourceLink"("category", "subcategory", "sub_subcategory", "source_category", "url");
