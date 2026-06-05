-- AlterTable: Add ingested_run_id to Post
ALTER TABLE "Post" ADD COLUMN "ingested_run_id" TEXT;

CREATE INDEX "Post_project_id_ingested_run_id_idx" ON "Post"("project_id", "ingested_run_id");

-- AlterTable: Add ingested_run_id to BlogPost
ALTER TABLE "BlogPost" ADD COLUMN "ingested_run_id" TEXT;

CREATE INDEX "BlogPost_project_id_ingested_run_id_idx" ON "BlogPost"("project_id", "ingested_run_id");

-- CreateTable: OrchestrationRun
CREATE TABLE "OrchestrationRun" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "project_id" TEXT NOT NULL,
    "orchestration_execution_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COLLECTING',
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "collected_at" DATETIME,
    "analysis_started_at" DATETIME,
    "analysis_completed_at" DATETIME,
    "metadata" TEXT,
    CONSTRAINT "OrchestrationRun_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "OrchestrationRun_orchestration_execution_id_idx" ON "OrchestrationRun"("orchestration_execution_id");
CREATE INDEX "OrchestrationRun_project_id_status_idx" ON "OrchestrationRun"("project_id", "status");
CREATE INDEX "OrchestrationRun_project_id_started_at_idx" ON "OrchestrationRun"("project_id", "started_at");
CREATE INDEX "OrchestrationRun_deleted_at_idx" ON "OrchestrationRun"("deleted_at");

-- CreateTable: RunRecord
CREATE TABLE "RunRecord" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" DATETIME,
    "run_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "record_type" TEXT NOT NULL,
    "record_key" TEXT NOT NULL,
    "source" TEXT,
    CONSTRAINT "RunRecord_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "OrchestrationRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "RunRecord_run_id_record_type_record_key_key" ON "RunRecord"("run_id", "record_type", "record_key");
CREATE INDEX "RunRecord_run_id_idx" ON "RunRecord"("run_id");
CREATE INDEX "RunRecord_project_id_record_type_idx" ON "RunRecord"("project_id", "record_type");
CREATE INDEX "RunRecord_deleted_at_idx" ON "RunRecord"("deleted_at");

-- CreateTable: AnalysisTask
CREATE TABLE "AnalysisTask" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "project_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "record_type" TEXT NOT NULL,
    "record_key" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "locked_at" DATETIME,
    "last_error" TEXT,
    "result_version" INTEGER NOT NULL DEFAULT 1,
    "completed_at" DATETIME,
    CONSTRAINT "AnalysisTask_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "OrchestrationRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AnalysisTask_project_id_record_type_record_key_step_result_version_key" ON "AnalysisTask"("project_id", "record_type", "record_key", "step", "result_version");
CREATE INDEX "AnalysisTask_project_id_state_step_idx" ON "AnalysisTask"("project_id", "state", "step");
CREATE INDEX "AnalysisTask_run_id_state_idx" ON "AnalysisTask"("run_id", "state");
CREATE INDEX "AnalysisTask_deleted_at_idx" ON "AnalysisTask"("deleted_at");
