-- AlterTable
ALTER TABLE "Post" ADD COLUMN "github_product_relevance_score" INTEGER;

-- CreateIndex
CREATE INDEX "Post_project_id_platform_github_product_relevance_score_idx" ON "Post"("project_id", "platform", "github_product_relevance_score");
