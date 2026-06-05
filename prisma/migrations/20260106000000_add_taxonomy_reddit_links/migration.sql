-- CreateTable
CREATE TABLE "TaxonomyRedditLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "sub_subcategory" TEXT,
    "url" TEXT NOT NULL,
    "taxonomy_id" TEXT,
    CONSTRAINT "TaxonomyRedditLink_taxonomy_id_fkey" FOREIGN KEY ("taxonomy_id") REFERENCES "BusinessTaxonomy" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TaxonomyRedditLink_category_subcategory_sub_subcategory_idx" ON "TaxonomyRedditLink"("category", "subcategory", "sub_subcategory");

-- CreateIndex
CREATE INDEX "TaxonomyRedditLink_taxonomy_id_idx" ON "TaxonomyRedditLink"("taxonomy_id");

-- CreateIndex
CREATE INDEX "TaxonomyRedditLink_deleted_at_idx" ON "TaxonomyRedditLink"("deleted_at");

