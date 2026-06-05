-- CreateTable
CREATE TABLE "TaxonomyInfluencerLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "sub_subcategory" TEXT,
    "platform" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "channel_name" TEXT,
    "taxonomy_id" TEXT,
    CONSTRAINT "TaxonomyInfluencerLink_taxonomy_id_fkey" FOREIGN KEY ("taxonomy_id") REFERENCES "BusinessTaxonomy" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaxonomyOtherSourceLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "sub_subcategory" TEXT,
    "source_category" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "channel_name" TEXT,
    "taxonomy_id" TEXT,
    CONSTRAINT "TaxonomyOtherSourceLink_taxonomy_id_fkey" FOREIGN KEY ("taxonomy_id") REFERENCES "BusinessTaxonomy" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TaxonomyInfluencerLink_category_subcategory_sub_subcategory_idx" ON "TaxonomyInfluencerLink"("category", "subcategory", "sub_subcategory");

-- CreateIndex
CREATE INDEX "TaxonomyInfluencerLink_taxonomy_id_idx" ON "TaxonomyInfluencerLink"("taxonomy_id");

-- CreateIndex
CREATE INDEX "TaxonomyInfluencerLink_platform_idx" ON "TaxonomyInfluencerLink"("platform");

-- CreateIndex
CREATE INDEX "TaxonomyInfluencerLink_deleted_at_idx" ON "TaxonomyInfluencerLink"("deleted_at");

-- CreateIndex
CREATE INDEX "TaxonomyOtherSourceLink_category_subcategory_sub_subcategory_idx" ON "TaxonomyOtherSourceLink"("category", "subcategory", "sub_subcategory");

-- CreateIndex
CREATE INDEX "TaxonomyOtherSourceLink_taxonomy_id_idx" ON "TaxonomyOtherSourceLink"("taxonomy_id");

-- CreateIndex
CREATE INDEX "TaxonomyOtherSourceLink_source_category_idx" ON "TaxonomyOtherSourceLink"("source_category");

-- CreateIndex
CREATE INDEX "TaxonomyOtherSourceLink_deleted_at_idx" ON "TaxonomyOtherSourceLink"("deleted_at");


