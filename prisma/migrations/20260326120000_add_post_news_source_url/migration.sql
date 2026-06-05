-- PostNews.source_url exists in schema but was never migrated (column missing vs Prisma client).
ALTER TABLE "PostNews" ADD COLUMN "source_url" TEXT;
