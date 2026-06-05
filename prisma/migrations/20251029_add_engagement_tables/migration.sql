-- Create EngagementSession
CREATE TABLE IF NOT EXISTS "EngagementSession" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "project_id" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_record_id" TEXT NOT NULL,
  "post_id" INTEGER,
  "platform" TEXT NOT NULL,
  "destination_url" TEXT NOT NULL,
  "started_by_user_id" TEXT NOT NULL,
  "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" TEXT NOT NULL,
  "watch_until" DATETIME,
  "last_check_at" DATETIME,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" DATETIME
);

CREATE INDEX IF NOT EXISTS "EngagementSession_project_id_idx" ON "EngagementSession" ("project_id");
CREATE INDEX IF NOT EXISTS "EngagementSession_status_idx" ON "EngagementSession" ("status");
CREATE INDEX IF NOT EXISTS "EngagementSession_watch_until_idx" ON "EngagementSession" ("watch_until");
CREATE INDEX IF NOT EXISTS "EngagementSession_source_idx" ON "EngagementSession" ("source_type", "source_record_id");

-- Create EngagementEvent
CREATE TABLE IF NOT EXISTS "EngagementEvent" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "engagement_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "payload" TEXT,
  "occurred_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" DATETIME
);

CREATE INDEX IF NOT EXISTS "EngagementEvent_engagement_id_idx" ON "EngagementEvent" ("engagement_id");
CREATE INDEX IF NOT EXISTS "EngagementEvent_type_idx" ON "EngagementEvent" ("type");
CREATE INDEX IF NOT EXISTS "EngagementEvent_occurred_at_idx" ON "EngagementEvent" ("occurred_at");

-- Create UserPlatformIdentity
CREATE TABLE IF NOT EXISTS "UserPlatformIdentity" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "user_id" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "identity" TEXT NOT NULL,
  "verified" BOOLEAN NOT NULL DEFAULT 0,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" DATETIME
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserPlatformIdentity_unique" ON "UserPlatformIdentity" ("user_id", "platform", "identity");
CREATE INDEX IF NOT EXISTS "UserPlatformIdentity_user_id_idx" ON "UserPlatformIdentity" ("user_id");
CREATE INDEX IF NOT EXISTS "UserPlatformIdentity_platform_idx" ON "UserPlatformIdentity" ("platform");





