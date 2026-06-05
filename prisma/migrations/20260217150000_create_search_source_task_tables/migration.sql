-- SearchSourceTask and TaskRun were missing from earlier migrations; required before
-- 20260218000000_add_search_source_task_duration (ADD COLUMN timing_duration_*).
-- Base SearchSourceTask excludes timing_duration_number and timing_duration_unit.

-- CreateTable
CREATE TABLE "SearchSourceTask" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "timing_definition" TEXT NOT NULL,
    "openai_prompt_text" TEXT NOT NULL DEFAULT '',
    "target" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "config_json" TEXT
);

-- CreateTable
CREATE TABLE "TaskRun" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "task_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "execution_id" TEXT,
    "step_execution_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "started_at" DATETIME,
    "completed_at" DATETIME,
    "error_message" TEXT,
    "result_preview" TEXT,
    CONSTRAINT "TaskRun_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "SearchSourceTask" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TaskRun_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TaskRun_step_execution_id_fkey" FOREIGN KEY ("step_execution_id") REFERENCES "OrchestrationStepExecution" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SearchSourceTask_name_key" ON "SearchSourceTask"("name");

-- CreateIndex
CREATE INDEX "SearchSourceTask_name_idx" ON "SearchSourceTask"("name");

-- CreateIndex
CREATE INDEX "SearchSourceTask_is_active_idx" ON "SearchSourceTask"("is_active");

-- CreateIndex
CREATE INDEX "SearchSourceTask_deleted_at_idx" ON "SearchSourceTask"("deleted_at");

-- CreateIndex
CREATE INDEX "TaskRun_task_id_idx" ON "TaskRun"("task_id");

-- CreateIndex
CREATE INDEX "TaskRun_project_id_idx" ON "TaskRun"("project_id");

-- CreateIndex
CREATE INDEX "TaskRun_execution_id_idx" ON "TaskRun"("execution_id");

-- CreateIndex
CREATE INDEX "TaskRun_step_execution_id_idx" ON "TaskRun"("step_execution_id");

-- CreateIndex
CREATE INDEX "TaskRun_status_idx" ON "TaskRun"("status");

-- CreateIndex
CREATE INDEX "TaskRun_deleted_at_idx" ON "TaskRun"("deleted_at");
