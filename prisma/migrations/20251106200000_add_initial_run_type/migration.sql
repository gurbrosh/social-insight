-- Add columns for initial run strategy
ALTER TABLE "OrchestrationRecipeStep" ADD COLUMN "initial_run_type" TEXT NOT NULL DEFAULT 'NOW';
ALTER TABLE "OrchestrationRecipeStep" ADD COLUMN "initial_schedule_time" TEXT;

-- Create table for conflicting step skips
CREATE TABLE "OrchestrationRecipeStepSkip" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "step_id" TEXT NOT NULL,
    "skip_step_id" TEXT NOT NULL,
    CONSTRAINT "OrchestrationRecipeStepSkip_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "OrchestrationRecipeStep"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrchestrationRecipeStepSkip_skip_step_id_fkey" FOREIGN KEY ("skip_step_id") REFERENCES "OrchestrationRecipeStep"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OrchestrationRecipeStepSkip_step_id_skip_step_id_key" ON "OrchestrationRecipeStepSkip"("step_id", "skip_step_id");
CREATE INDEX "OrchestrationRecipeStepSkip_skip_step_id_idx" ON "OrchestrationRecipeStepSkip"("skip_step_id");
