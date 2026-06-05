-- Person Intelligence tables (SQLite). Applied when migrate history drift blocks `prisma migrate dev`.

CREATE TABLE IF NOT EXISTS "CompetitorList" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "CompetitorList_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProspectIntelligenceSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "project_id" TEXT NOT NULL,
    "employment_confidence_for_title_company_in_copy" REAL NOT NULL DEFAULT 0.75,
    "minimum_evidence_for_auto_route" REAL NOT NULL DEFAULT 0.35,
    "default_competitor_list_id" TEXT,
    CONSTRAINT "ProspectIntelligenceSettings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProspectIntelligenceSettings_default_competitor_list_id_fkey" FOREIGN KEY ("default_competitor_list_id") REFERENCES "CompetitorList" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "CompetitorListEntry" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "competitor_list_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'company_name',
    "pattern" TEXT NOT NULL,
    CONSTRAINT "CompetitorListEntry_competitor_list_id_fkey" FOREIGN KEY ("competitor_list_id") REFERENCES "CompetitorList" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProspectIdentity" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "project_id" TEXT NOT NULL,
    "linkedin_url_normalized" TEXT NOT NULL,
    "email_normalized" TEXT,
    "display_name" TEXT,
    "primary_platform" TEXT,
    "manual_classification_locked" BOOLEAN NOT NULL DEFAULT false,
    "manual_routing_locked" BOOLEAN NOT NULL DEFAULT false,
    "locked_fields_json" TEXT,
    CONSTRAINT "ProspectIdentity_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProspectEvidenceRecord" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "prospect_identity_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_url" TEXT,
    "raw_text" TEXT NOT NULL,
    "extracted_signals_json" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "observed_at" DATETIME NOT NULL,
    "content_hash" TEXT NOT NULL,
    "metadata_json" TEXT,
    CONSTRAINT "ProspectEvidenceRecord_prospect_identity_id_fkey" FOREIGN KEY ("prospect_identity_id") REFERENCES "ProspectIdentity" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProspectClassificationSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "prospect_identity_id" TEXT NOT NULL,
    "snapshot_version" INTEGER NOT NULL DEFAULT 1,
    "classifier_version" TEXT NOT NULL,
    "classification_json" TEXT NOT NULL,
    "employment_confidence" REAL NOT NULL,
    "overall_confidence" REAL NOT NULL,
    "needs_review" BOOLEAN NOT NULL,
    "routing_recommendation" TEXT NOT NULL,
    "computed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_at" DATETIME,
    "locked_fields_json" TEXT,
    "manual_override_classification_json" TEXT,
    CONSTRAINT "ProspectClassificationSnapshot_prospect_identity_id_fkey" FOREIGN KEY ("prospect_identity_id") REFERENCES "ProspectIdentity" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProspectRoutingRule" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "notes" TEXT,
    "condition_logic" TEXT NOT NULL DEFAULT 'all',
    "conditions_json" TEXT NOT NULL,
    "actions_json" TEXT NOT NULL,
    "rule_version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "ProspectRoutingRule_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "OutreachTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "template_type" TEXT NOT NULL,
    "applies_to_role_categories_json" TEXT NOT NULL,
    "applies_to_function_tags_json" TEXT NOT NULL,
    "applies_to_seniority_json" TEXT,
    "employment_confidence_threshold" REAL NOT NULL DEFAULT 0.75,
    "requires_high_confidence_employment" BOOLEAN NOT NULL DEFAULT false,
    "requires_source_post_context" BOOLEAN NOT NULL DEFAULT false,
    "subject_template" TEXT,
    "body_template" TEXT NOT NULL,
    "variables_json" TEXT NOT NULL,
    "fallback_behavior_json" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "OutreachTemplate_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProspectCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "project_id" TEXT NOT NULL,
    "prospect_identity_id" TEXT NOT NULL,
    "themes_analysis_id" TEXT,
    "post_id" INTEGER,
    "theme_item_response_id" TEXT,
    "relevance_score_cached" REAL,
    "platform" TEXT NOT NULL,
    "headline_snapshot" TEXT,
    CONSTRAINT "ProspectCandidate_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProspectCandidate_prospect_identity_id_fkey" FOREIGN KEY ("prospect_identity_id") REFERENCES "ProspectIdentity" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProspectCandidate_themes_analysis_id_fkey" FOREIGN KEY ("themes_analysis_id") REFERENCES "ThemesAnalysis" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ProspectCandidate_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "Post" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ProspectCandidate_theme_item_response_id_fkey" FOREIGN KEY ("theme_item_response_id") REFERENCES "ThemeItemResponse" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "OutreachBucketAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "prospect_candidate_id" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "rule_id_matched" TEXT,
    "rule_version" INTEGER,
    "reason" TEXT,
    "template_id" TEXT,
    "suppress_title_company" BOOLEAN NOT NULL DEFAULT false,
    "require_manual_approval" BOOLEAN NOT NULL DEFAULT false,
    "draft_subject" TEXT,
    "draft_body" TEXT,
    "draft_created_at" DATETIME,
    CONSTRAINT "OutreachBucketAssignment_prospect_candidate_id_fkey" FOREIGN KEY ("prospect_candidate_id") REFERENCES "ProspectCandidate" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OutreachBucketAssignment_rule_id_matched_fkey" FOREIGN KEY ("rule_id_matched") REFERENCES "ProspectRoutingRule" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "OutreachBucketAssignment_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "OutreachTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProspectIntelligenceSettings_project_id_key" ON "ProspectIntelligenceSettings"("project_id");
CREATE INDEX IF NOT EXISTS "ProspectIntelligenceSettings_project_id_idx" ON "ProspectIntelligenceSettings"("project_id");
CREATE INDEX IF NOT EXISTS "ProspectIntelligenceSettings_deleted_at_idx" ON "ProspectIntelligenceSettings"("deleted_at");

CREATE INDEX IF NOT EXISTS "CompetitorList_project_id_idx" ON "CompetitorList"("project_id");
CREATE INDEX IF NOT EXISTS "CompetitorList_deleted_at_idx" ON "CompetitorList"("deleted_at");

CREATE INDEX IF NOT EXISTS "CompetitorListEntry_competitor_list_id_idx" ON "CompetitorListEntry"("competitor_list_id");
CREATE INDEX IF NOT EXISTS "CompetitorListEntry_deleted_at_idx" ON "CompetitorListEntry"("deleted_at");

CREATE UNIQUE INDEX IF NOT EXISTS "ProspectIdentity_project_id_linkedin_url_normalized_key" ON "ProspectIdentity"("project_id", "linkedin_url_normalized");
CREATE INDEX IF NOT EXISTS "ProspectIdentity_project_id_idx" ON "ProspectIdentity"("project_id");
CREATE INDEX IF NOT EXISTS "ProspectIdentity_deleted_at_idx" ON "ProspectIdentity"("deleted_at");

CREATE INDEX IF NOT EXISTS "ProspectEvidenceRecord_prospect_identity_id_idx" ON "ProspectEvidenceRecord"("prospect_identity_id");
CREATE INDEX IF NOT EXISTS "ProspectEvidenceRecord_content_hash_idx" ON "ProspectEvidenceRecord"("content_hash");
CREATE INDEX IF NOT EXISTS "ProspectEvidenceRecord_deleted_at_idx" ON "ProspectEvidenceRecord"("deleted_at");

CREATE INDEX IF NOT EXISTS "ProspectClassificationSnapshot_prospect_identity_id_idx" ON "ProspectClassificationSnapshot"("prospect_identity_id");
CREATE INDEX IF NOT EXISTS "ProspectClassificationSnapshot_computed_at_idx" ON "ProspectClassificationSnapshot"("computed_at");
CREATE INDEX IF NOT EXISTS "ProspectClassificationSnapshot_deleted_at_idx" ON "ProspectClassificationSnapshot"("deleted_at");

CREATE INDEX IF NOT EXISTS "ProspectCandidate_project_id_idx" ON "ProspectCandidate"("project_id");
CREATE INDEX IF NOT EXISTS "ProspectCandidate_prospect_identity_id_idx" ON "ProspectCandidate"("prospect_identity_id");
CREATE INDEX IF NOT EXISTS "ProspectCandidate_themes_analysis_id_idx" ON "ProspectCandidate"("themes_analysis_id");
CREATE INDEX IF NOT EXISTS "ProspectCandidate_post_id_idx" ON "ProspectCandidate"("post_id");
CREATE INDEX IF NOT EXISTS "ProspectCandidate_deleted_at_idx" ON "ProspectCandidate"("deleted_at");

CREATE INDEX IF NOT EXISTS "ProspectRoutingRule_project_id_priority_idx" ON "ProspectRoutingRule"("project_id", "priority");
CREATE INDEX IF NOT EXISTS "ProspectRoutingRule_deleted_at_idx" ON "ProspectRoutingRule"("deleted_at");

CREATE INDEX IF NOT EXISTS "OutreachTemplate_project_id_channel_idx" ON "OutreachTemplate"("project_id", "channel");
CREATE INDEX IF NOT EXISTS "OutreachTemplate_deleted_at_idx" ON "OutreachTemplate"("deleted_at");

CREATE INDEX IF NOT EXISTS "OutreachBucketAssignment_prospect_candidate_id_idx" ON "OutreachBucketAssignment"("prospect_candidate_id");
CREATE INDEX IF NOT EXISTS "OutreachBucketAssignment_bucket_status_idx" ON "OutreachBucketAssignment"("bucket", "status");
CREATE INDEX IF NOT EXISTS "OutreachBucketAssignment_deleted_at_idx" ON "OutreachBucketAssignment"("deleted_at");
