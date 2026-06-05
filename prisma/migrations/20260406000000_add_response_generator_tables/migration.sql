-- ResponseObjective + ThemeItemResponse for theme-based reply generation

CREATE TABLE "ResponseObjective" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "allowed_sources" JSONB,
    "excluded_sources" JSONB,
    "persona" TEXT NOT NULL,
    "is_org_identified" BOOLEAN NOT NULL DEFAULT false,
    "relevance_guidelines" TEXT NOT NULL DEFAULT '',
    "style_guidelines" TEXT NOT NULL DEFAULT '',
    "example_responses" JSONB,
    CONSTRAINT "ResponseObjective_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ThemeItemResponse" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "themes_analysis_id" TEXT NOT NULL,
    "response_objective_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "relevance_score" REAL NOT NULL,
    "reasoning" TEXT NOT NULL,
    "target_user" TEXT NOT NULL,
    "persona" TEXT NOT NULL,
    "response_text" TEXT NOT NULL,
    CONSTRAINT "ThemeItemResponse_themes_analysis_id_fkey" FOREIGN KEY ("themes_analysis_id") REFERENCES "ThemesAnalysis" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ThemeItemResponse_response_objective_id_fkey" FOREIGN KEY ("response_objective_id") REFERENCES "ResponseObjective" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ResponseObjective_project_id_idx" ON "ResponseObjective"("project_id");
CREATE INDEX "ResponseObjective_deleted_at_idx" ON "ResponseObjective"("deleted_at");
CREATE INDEX "ThemeItemResponse_themes_analysis_id_idx" ON "ThemeItemResponse"("themes_analysis_id");
CREATE INDEX "ThemeItemResponse_response_objective_id_idx" ON "ThemeItemResponse"("response_objective_id");
CREATE INDEX "ThemeItemResponse_deleted_at_idx" ON "ThemeItemResponse"("deleted_at");
CREATE UNIQUE INDEX "ThemeItemResponse_themes_analysis_id_response_objective_id_key" ON "ThemeItemResponse"("themes_analysis_id", "response_objective_id");
