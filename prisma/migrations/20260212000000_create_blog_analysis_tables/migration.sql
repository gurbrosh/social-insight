-- BlogAnalysisRun and BlogNewsAnalysis were missing from earlier migrations; required before
-- 20260213000000_add_blog_analysis_affiliation and 20260217000000_add_blog_news_analysis_ideas.
-- Base BlogNewsAnalysis excludes columns added in those migrations (affiliation; idea_1–idea_7).

-- CreateTable
CREATE TABLE "BlogAnalysisRun" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "project_id" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "no_items_before_date" DATETIME NOT NULL,
    "run_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "items_found_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    CONSTRAINT "BlogAnalysisRun_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BlogNewsAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "project_id" TEXT NOT NULL,
    "analysis_run_id" TEXT,
    "source_url" TEXT NOT NULL,
    "article_url" TEXT NOT NULL,
    "article_title" TEXT,
    "article_date" DATETIME,
    "summary" TEXT,
    "primary_persona" TEXT,
    "secondary_personas" JSONB,
    "seniority_level" TEXT,
    "audience_domain" TEXT,
    "audience_targeting" TEXT,
    "offering_content_type" TEXT,
    "lifecycle_stage" TEXT,
    "offering_notes" TEXT,
    "primary_intent" TEXT,
    "secondary_intents" JSONB,
    "evidence_types_used" JSONB,
    "evidence_strength" TEXT,
    "specificity_level" TEXT,
    "actionability_level" TEXT,
    "competitive_posture" TEXT,
    "competitive_direction" TEXT,
    "explicit_competitors" TEXT,
    "category_framing" TEXT,
    "sensitivity_level" TEXT,
    "sensitivity_tone" TEXT,
    "trust_building_elements" TEXT,
    "timing_nature" TEXT,
    "urgency_level" TEXT,
    "implied_strategic_direction" TEXT,
    "confidence_posture" TEXT,
    "explicit_cta" TEXT,
    "implicit_cta" TEXT,
    "content_archetype" TEXT,
    "signal_strength_score" INTEGER,
    "relevance_score" INTEGER,
    "is_ad" BOOLEAN,
    "mention_count" INTEGER NOT NULL DEFAULT 1,
    "news_cluster_id" TEXT,
    "raw_extraction_json" JSONB,
    "theme_matches_json" TEXT,
    CONSTRAINT "BlogNewsAnalysis_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BlogNewsAnalysis_analysis_run_id_fkey" FOREIGN KEY ("analysis_run_id") REFERENCES "BlogAnalysisRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BlogAnalysisRun_project_id_idx" ON "BlogAnalysisRun"("project_id");

-- CreateIndex
CREATE INDEX "BlogAnalysisRun_run_at_idx" ON "BlogAnalysisRun"("run_at");

-- CreateIndex
CREATE INDEX "BlogAnalysisRun_deleted_at_idx" ON "BlogAnalysisRun"("deleted_at");

-- CreateIndex
CREATE INDEX "BlogNewsAnalysis_project_id_idx" ON "BlogNewsAnalysis"("project_id");

-- CreateIndex
CREATE INDEX "BlogNewsAnalysis_analysis_run_id_idx" ON "BlogNewsAnalysis"("analysis_run_id");

-- CreateIndex
CREATE INDEX "BlogNewsAnalysis_article_date_idx" ON "BlogNewsAnalysis"("article_date");

-- CreateIndex
CREATE INDEX "BlogNewsAnalysis_deleted_at_idx" ON "BlogNewsAnalysis"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "BlogNewsAnalysis_project_id_article_url_key" ON "BlogNewsAnalysis"("project_id", "article_url");
