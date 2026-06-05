-- AlterTable: Add orchestration_run_id to ScrapeJob for task-based analysis
ALTER TABLE "ScrapeJob" ADD COLUMN "orchestration_run_id" TEXT;
