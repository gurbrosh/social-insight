-- CreateTable
CREATE TABLE "Orchestration" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "user_id" TEXT NOT NULL,
    "project_ids" TEXT NOT NULL,
    "threads" TEXT NOT NULL,
    "is_running" BOOLEAN NOT NULL DEFAULT false,
    "last_run_at" DATETIME,
    CONSTRAINT "Orchestration_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrchestrationExecution" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "orchestration_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "started_at" DATETIME,
    "completed_at" DATETIME,
    "error_message" TEXT,
    "total_threads" INTEGER NOT NULL DEFAULT 0,
    "completed_threads" INTEGER NOT NULL DEFAULT 0,
    "total_jobs" INTEGER NOT NULL DEFAULT 0,
    "completed_jobs" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "OrchestrationExecution_orchestration_id_fkey" FOREIGN KEY ("orchestration_id") REFERENCES "Orchestration" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrchestrationThreadExecution" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "execution_id" TEXT NOT NULL,
    "thread_name" TEXT NOT NULL,
    "thread_sequence" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "started_at" DATETIME,
    "completed_at" DATETIME,
    "error_message" TEXT,
    "total_steps" INTEGER NOT NULL DEFAULT 0,
    "completed_steps" INTEGER NOT NULL DEFAULT 0,
    "current_step" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "OrchestrationThreadExecution_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "OrchestrationExecution" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrchestrationStepExecution" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "thread_execution_id" TEXT NOT NULL,
    "step_sequence" INTEGER NOT NULL,
    "scraper_id" TEXT NOT NULL,
    "scraper_name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "started_at" DATETIME,
    "completed_at" DATETIME,
    "error_message" TEXT,
    "scrape_job_id" TEXT,
    CONSTRAINT "OrchestrationStepExecution_thread_execution_id_fkey" FOREIGN KEY ("thread_execution_id") REFERENCES "OrchestrationThreadExecution" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrchestrationStepExecution_scrape_job_id_fkey" FOREIGN KEY ("scrape_job_id") REFERENCES "ScrapeJob" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Orchestration_user_id_idx" ON "Orchestration"("user_id");

-- CreateIndex
CREATE INDEX "Orchestration_deleted_at_idx" ON "Orchestration"("deleted_at");

-- CreateIndex
CREATE INDEX "Orchestration_is_running_idx" ON "Orchestration"("is_running");

-- CreateIndex
CREATE INDEX "OrchestrationExecution_orchestration_id_idx" ON "OrchestrationExecution"("orchestration_id");

-- CreateIndex
CREATE INDEX "OrchestrationExecution_status_idx" ON "OrchestrationExecution"("status");

-- CreateIndex
CREATE INDEX "OrchestrationExecution_deleted_at_idx" ON "OrchestrationExecution"("deleted_at");

-- CreateIndex
CREATE INDEX "OrchestrationThreadExecution_execution_id_idx" ON "OrchestrationThreadExecution"("execution_id");

-- CreateIndex
CREATE INDEX "OrchestrationThreadExecution_thread_sequence_idx" ON "OrchestrationThreadExecution"("thread_sequence");

-- CreateIndex
CREATE INDEX "OrchestrationThreadExecution_status_idx" ON "OrchestrationThreadExecution"("status");

-- CreateIndex
CREATE INDEX "OrchestrationThreadExecution_deleted_at_idx" ON "OrchestrationThreadExecution"("deleted_at");

-- CreateIndex
CREATE INDEX "OrchestrationStepExecution_thread_execution_id_idx" ON "OrchestrationStepExecution"("thread_execution_id");

-- CreateIndex
CREATE INDEX "OrchestrationStepExecution_step_sequence_idx" ON "OrchestrationStepExecution"("step_sequence");

-- CreateIndex
CREATE INDEX "OrchestrationStepExecution_status_idx" ON "OrchestrationStepExecution"("status");

-- CreateIndex
CREATE INDEX "OrchestrationStepExecution_scraper_id_idx" ON "OrchestrationStepExecution"("scraper_id");

-- CreateIndex
CREATE INDEX "OrchestrationStepExecution_deleted_at_idx" ON "OrchestrationStepExecution"("deleted_at");
