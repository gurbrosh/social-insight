-- CreateTable
CREATE TABLE "BlogPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" DATETIME,
    "project_id" TEXT NOT NULL,
    "article_url" TEXT NOT NULL,
    "article_title" TEXT,
    "article_date" DATETIME,
    "content" TEXT NOT NULL,
    "affiliation" TEXT,
    "scraped_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_url" TEXT,
    CONSTRAINT "BlogPost_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "BlogPost_project_id_article_url_key" ON "BlogPost"("project_id", "article_url");

-- CreateIndex
CREATE INDEX "BlogPost_project_id_idx" ON "BlogPost"("project_id");

-- CreateIndex
CREATE INDEX "BlogPost_article_date_idx" ON "BlogPost"("article_date");

-- CreateIndex
CREATE INDEX "BlogPost_deleted_at_idx" ON "BlogPost"("deleted_at");
