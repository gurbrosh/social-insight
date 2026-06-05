-- Progress polling: GROUP BY state for run_id + deleted_at IS NULL
CREATE INDEX "AnalysisTask_run_id_deleted_at_state_idx" ON "AnalysisTask"("run_id", "deleted_at", "state");
