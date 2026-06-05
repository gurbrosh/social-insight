-- One-time SQLite repair when BlogNewsAnalysis is missing columns from schema.prisma
-- (e.g. drift vs migrations). If a line errors with "duplicate column", that column already exists — comment it out.
--
-- Usage: sqlite3 prisma/db/prod.db < scripts/repair-blog-news-analysis-columns.sql
-- Stop the dev server first if you see "database is locked".

ALTER TABLE "BlogNewsAnalysis" ADD COLUMN "relevance_score" INTEGER;
ALTER TABLE "BlogNewsAnalysis" ADD COLUMN "is_ad" BOOLEAN;
ALTER TABLE "BlogNewsAnalysis" ADD COLUMN "mention_count" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "BlogNewsAnalysis" ADD COLUMN "news_cluster_id" TEXT;
ALTER TABLE "BlogNewsAnalysis" ADD COLUMN "theme_matches_json" TEXT;
