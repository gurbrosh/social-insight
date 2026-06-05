-- AlterTable
ALTER TABLE "Post" ADD COLUMN "language" TEXT;

-- CreateIndex
CREATE INDEX "Post_language_idx" ON "Post"("language");

