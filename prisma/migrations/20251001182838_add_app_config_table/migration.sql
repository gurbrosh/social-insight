-- CreateTable
CREATE TABLE "AppConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "category" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "data_type" TEXT NOT NULL,
    "description" TEXT,
    "min_value" REAL,
    "max_value" REAL,
    "options" TEXT,
    "display_name" TEXT,
    "section" TEXT,
    "order" INTEGER
);

-- CreateIndex
CREATE INDEX "AppConfig_category_idx" ON "AppConfig"("category");

-- CreateIndex
CREATE INDEX "AppConfig_deleted_at_idx" ON "AppConfig"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "AppConfig_category_key_key" ON "AppConfig"("category", "key");
