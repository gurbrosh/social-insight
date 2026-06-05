-- CreateTable: AnalysisProgress
CREATE TABLE "AnalysisProgress" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "project_id" TEXT NOT NULL,
    "last_sentiment_post_id" INTEGER NOT NULL DEFAULT 0,
    "last_chatter_post_id" INTEGER NOT NULL DEFAULT 0,
    "last_themes_post_id" INTEGER NOT NULL DEFAULT 0,
    "last_network_post_id" INTEGER NOT NULL DEFAULT 0,
    "last_news_post_id" INTEGER NOT NULL DEFAULT 0,
    "last_brand_post_id" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "AnalysisProgress_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex: AnalysisProgress_project_id_key
CREATE UNIQUE INDEX "AnalysisProgress_project_id_key" ON "AnalysisProgress"("project_id");
