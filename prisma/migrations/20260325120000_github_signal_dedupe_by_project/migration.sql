-- Deduplicate by project/hit identity (same repo or same code hit), not by search keyword.
-- Keep the row with the latest updated_at per (source, signal_type, external_id).

DELETE FROM "GithubSignal" WHERE "id" IN (
  SELECT "id" FROM (
    SELECT
      "id",
      ROW_NUMBER() OVER (
        PARTITION BY "source", "signal_type", "external_id"
        ORDER BY "updated_at" DESC, "created_at" DESC
      ) AS "_rn"
    FROM "GithubSignal"
  ) AS "_deduped" WHERE "_rn" > 1
);

UPDATE "GithubSignal" SET "keyword" = '__global__';

DROP INDEX "GithubSignal_source_keyword_signal_type_external_id_key";

CREATE UNIQUE INDEX "GithubSignal_source_signal_type_external_id_key" ON "GithubSignal"("source", "signal_type", "external_id");

DROP INDEX "GithubSignal_keyword_published_at_unix_idx";

CREATE INDEX "GithubSignal_published_at_unix_idx" ON "GithubSignal"("published_at_unix");
