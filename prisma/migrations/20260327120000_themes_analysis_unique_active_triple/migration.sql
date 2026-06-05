-- At most one active ThemesAnalysis row per (project_id, theme_id, post_id).
-- Removes existing duplicate active rows (keeps the best analyzed_at / newest id), then adds a partial unique index.

DELETE FROM "ThemesAnalysis"
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT
      "id",
      ROW_NUMBER() OVER (
        PARTITION BY "project_id", "theme_id", "post_id"
        ORDER BY
          CASE WHEN "analyzed_at" IS NULL THEN 1 ELSE 0 END,
          "analyzed_at" DESC,
          "id" DESC
      ) AS rn
    FROM "ThemesAnalysis"
    WHERE "deleted_at" IS NULL
  ) AS t
  WHERE t.rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS "ThemesAnalysis_project_theme_post_active_unique"
ON "ThemesAnalysis"("project_id", "theme_id", "post_id")
WHERE "deleted_at" IS NULL;
