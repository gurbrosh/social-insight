-- Add descriptive_name column to Scraper table
ALTER TABLE "Scraper"
ADD COLUMN "descriptive_name" TEXT NOT NULL DEFAULT '';

