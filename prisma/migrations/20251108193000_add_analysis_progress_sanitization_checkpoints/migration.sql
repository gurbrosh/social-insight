-- AlterTable
ALTER TABLE "AnalysisProgress" ADD COLUMN "last_sanitized_chatter_at" DATETIME;
ALTER TABLE "AnalysisProgress" ADD COLUMN "last_sanitized_themes_at" DATETIME;
ALTER TABLE "AnalysisProgress" ADD COLUMN "last_sanitized_network_at" DATETIME;
ALTER TABLE "AnalysisProgress" ADD COLUMN "last_sanitized_news_at" DATETIME;

-- Seed existing rows so previously accepted records are not re-evaluated
UPDATE "AnalysisProgress"
SET
  "last_sanitized_chatter_at" = COALESCE("last_sanitized_chatter_at", CURRENT_TIMESTAMP),
  "last_sanitized_themes_at" = COALESCE("last_sanitized_themes_at", CURRENT_TIMESTAMP),
  "last_sanitized_network_at" = COALESCE("last_sanitized_network_at", CURRENT_TIMESTAMP),
  "last_sanitized_news_at" = COALESCE("last_sanitized_news_at", CURRENT_TIMESTAMP)
WHERE 1 = 1;

