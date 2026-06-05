-- Recipe/orchestration models were missing from earlier migrations; required before
-- 20251106200000_add_initial_run_type (ALTER TABLE OrchestrationRecipeStep).

-- CreateTable
CREATE TABLE "OrchestrationRecipe" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "user_id" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "OrchestrationRecipe_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrchestrationRecipeStep" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "recipe_id" TEXT NOT NULL,
    "orchestration_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "initial_enabled" BOOLEAN NOT NULL DEFAULT false,
    "hourly_interval" INTEGER,
    "daily_interval" INTEGER,
    "daily_time" TEXT,
    CONSTRAINT "OrchestrationRecipeStep_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "OrchestrationRecipe" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrchestrationRecipeStep_orchestration_id_fkey" FOREIGN KEY ("orchestration_id") REFERENCES "Orchestration" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrchestrationTimerTask" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "recipe_step_id" TEXT NOT NULL,
    "orchestration_id" TEXT NOT NULL,
    "task_type" TEXT NOT NULL,
    "scheduled_at" DATETIME NOT NULL,
    "executed_at" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    CONSTRAINT "OrchestrationTimerTask_recipe_step_id_fkey" FOREIGN KEY ("recipe_step_id") REFERENCES "OrchestrationRecipeStep" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "OrchestrationRecipeStep_recipe_id_sequence_key" ON "OrchestrationRecipeStep"("recipe_id", "sequence");

-- CreateIndex
CREATE INDEX "OrchestrationRecipeStep_recipe_id_idx" ON "OrchestrationRecipeStep"("recipe_id");

-- CreateIndex
CREATE INDEX "OrchestrationRecipeStep_orchestration_id_idx" ON "OrchestrationRecipeStep"("orchestration_id");

-- CreateIndex
CREATE INDEX "OrchestrationRecipeStep_sequence_idx" ON "OrchestrationRecipeStep"("sequence");

-- CreateIndex
CREATE INDEX "OrchestrationRecipeStep_deleted_at_idx" ON "OrchestrationRecipeStep"("deleted_at");

-- CreateIndex
CREATE INDEX "OrchestrationRecipe_user_id_idx" ON "OrchestrationRecipe"("user_id");

-- CreateIndex
CREATE INDEX "OrchestrationRecipe_deleted_at_idx" ON "OrchestrationRecipe"("deleted_at");

-- CreateIndex
CREATE INDEX "OrchestrationRecipe_is_active_idx" ON "OrchestrationRecipe"("is_active");

-- CreateIndex
CREATE INDEX "OrchestrationTimerTask_recipe_step_id_idx" ON "OrchestrationTimerTask"("recipe_step_id");

-- CreateIndex
CREATE INDEX "OrchestrationTimerTask_orchestration_id_idx" ON "OrchestrationTimerTask"("orchestration_id");

-- CreateIndex
CREATE INDEX "OrchestrationTimerTask_scheduled_at_idx" ON "OrchestrationTimerTask"("scheduled_at");

-- CreateIndex
CREATE INDEX "OrchestrationTimerTask_status_idx" ON "OrchestrationTimerTask"("status");

-- CreateIndex
CREATE INDEX "OrchestrationTimerTask_task_type_idx" ON "OrchestrationTimerTask"("task_type");

-- CreateIndex
CREATE INDEX "OrchestrationTimerTask_deleted_at_idx" ON "OrchestrationTimerTask"("deleted_at");
