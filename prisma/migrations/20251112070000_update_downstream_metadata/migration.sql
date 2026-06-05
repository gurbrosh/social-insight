-- Language detection for DownstreamPost.
-- authorProfileUrl, authorHeadline, authorImageUrl, origin, status, search_query,
-- processing_started_at, processed_at, expires_at were already added in
-- 20251109220000_update_downstream_post_table — do not duplicate those ALTERs.

ALTER TABLE "DownstreamPost" ADD COLUMN "language" TEXT;
