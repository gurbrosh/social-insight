-- CreateTable
CREATE TABLE "HnStoryAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "project_id" TEXT NOT NULL,
    "hn_story_id" TEXT NOT NULL,
    "story_url" TEXT NOT NULL,
    "title" TEXT,
    "story_text" TEXT,
    "summary" TEXT,
    "idea_1" TEXT,
    "idea_2" TEXT,
    "idea_3" TEXT,
    "idea_4" TEXT,
    "idea_5" TEXT,
    "idea_6" TEXT,
    "idea_7" TEXT,
    "relevance_score" INTEGER,
    "is_ad" BOOLEAN,
    "comments_summary" TEXT,
    "comments_engagement_meta" JSONB,
    "ingested_run_id" TEXT,
    CONSTRAINT "HnStoryAnalysis_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "HnStoryAnalysis_project_id_hn_story_id_key" ON "HnStoryAnalysis"("project_id", "hn_story_id");

-- CreateIndex
CREATE INDEX "HnStoryAnalysis_project_id_idx" ON "HnStoryAnalysis"("project_id");

-- CreateIndex
CREATE INDEX "HnStoryAnalysis_deleted_at_idx" ON "HnStoryAnalysis"("deleted_at");

-- AlterTable
ALTER TABLE "Post" ADD COLUMN "hn_story_analysis_id" TEXT;

-- CreateIndex
CREATE INDEX "Post_hn_story_analysis_id_idx" ON "Post"("hn_story_analysis_id");
