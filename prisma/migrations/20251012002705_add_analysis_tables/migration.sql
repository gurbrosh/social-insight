/*
  Warnings:

  - You are about to drop the `NetworkAnalysisCache` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE IF EXISTS "NetworkAnalysisCache";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "ProjectTheme" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "project_id" TEXT NOT NULL,
    "theme_name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "ProjectTheme_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NetworkAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "project_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "author_name" TEXT NOT NULL,
    "discord_server_name" TEXT,
    "profile_url" TEXT,
    "ideas_json" TEXT,
    "post_count" INTEGER NOT NULL DEFAULT 0,
    "total_likes" INTEGER NOT NULL DEFAULT 0,
    "total_comments" INTEGER NOT NULL DEFAULT 0,
    "total_shares" INTEGER NOT NULL DEFAULT 0,
    "total_reactions" INTEGER NOT NULL DEFAULT 0,
    "analyzed_at" DATETIME,
    "post_ids" TEXT,
    CONSTRAINT "NetworkAnalysis_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChatterAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "project_id" TEXT NOT NULL,
    "discussion_title" TEXT NOT NULL,
    "topic_category" TEXT,
    "summary" TEXT,
    "key_points_json" TEXT,
    "sentiment" TEXT,
    "platforms_json" TEXT,
    "post_ids" TEXT,
    "participant_count" INTEGER NOT NULL DEFAULT 0,
    "participant_names" TEXT,
    "total_messages" INTEGER NOT NULL DEFAULT 0,
    "total_likes" INTEGER NOT NULL DEFAULT 0,
    "total_comments" INTEGER NOT NULL DEFAULT 0,
    "total_shares" INTEGER NOT NULL DEFAULT 0,
    "total_engagement" INTEGER NOT NULL DEFAULT 0,
    "first_post_at" DATETIME,
    "last_post_at" DATETIME,
    "analyzed_at" DATETIME,
    "importance_score" INTEGER,
    CONSTRAINT "ChatterAnalysis_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ThemesAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "project_id" TEXT NOT NULL,
    "theme_id" TEXT NOT NULL,
    "theme_name" TEXT NOT NULL,
    "post_id" INTEGER NOT NULL,
    "platform" TEXT NOT NULL,
    "post_content" TEXT,
    "post_url" TEXT,
    "discord_channel" TEXT,
    "author_name" TEXT,
    "author_id" TEXT,
    "participant_names" TEXT,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "total_reactions" INTEGER NOT NULL DEFAULT 0,
    "posted_at" DATETIME,
    "analyzed_at" DATETIME,
    "relevance_score" INTEGER,
    "sentiment" TEXT,
    CONSTRAINT "ThemesAnalysis_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ProjectTheme_project_id_idx" ON "ProjectTheme"("project_id");

-- CreateIndex
CREATE INDEX "ProjectTheme_deleted_at_idx" ON "ProjectTheme"("deleted_at");

-- CreateIndex
CREATE INDEX "ProjectTheme_is_active_idx" ON "ProjectTheme"("is_active");

-- CreateIndex
CREATE INDEX "NetworkAnalysis_project_id_idx" ON "NetworkAnalysis"("project_id");

-- CreateIndex
CREATE INDEX "NetworkAnalysis_platform_idx" ON "NetworkAnalysis"("platform");

-- CreateIndex
CREATE INDEX "NetworkAnalysis_total_reactions_idx" ON "NetworkAnalysis"("total_reactions");

-- CreateIndex
CREATE INDEX "NetworkAnalysis_deleted_at_idx" ON "NetworkAnalysis"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "NetworkAnalysis_project_id_platform_author_id_key" ON "NetworkAnalysis"("project_id", "platform", "author_id");

-- CreateIndex
CREATE INDEX "ChatterAnalysis_project_id_idx" ON "ChatterAnalysis"("project_id");

-- CreateIndex
CREATE INDEX "ChatterAnalysis_importance_score_idx" ON "ChatterAnalysis"("importance_score");

-- CreateIndex
CREATE INDEX "ChatterAnalysis_deleted_at_idx" ON "ChatterAnalysis"("deleted_at");

-- CreateIndex
CREATE INDEX "ChatterAnalysis_first_post_at_idx" ON "ChatterAnalysis"("first_post_at");

-- CreateIndex
CREATE INDEX "ThemesAnalysis_project_id_idx" ON "ThemesAnalysis"("project_id");

-- CreateIndex
CREATE INDEX "ThemesAnalysis_theme_id_idx" ON "ThemesAnalysis"("theme_id");

-- CreateIndex
CREATE INDEX "ThemesAnalysis_platform_idx" ON "ThemesAnalysis"("platform");

-- CreateIndex
CREATE INDEX "ThemesAnalysis_deleted_at_idx" ON "ThemesAnalysis"("deleted_at");

-- CreateIndex
CREATE INDEX "ThemesAnalysis_posted_at_idx" ON "ThemesAnalysis"("posted_at");

-- CreateIndex
CREATE INDEX "ThemesAnalysis_relevance_score_idx" ON "ThemesAnalysis"("relevance_score");
