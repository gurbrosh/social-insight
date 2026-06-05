import fs from "fs";
import path from "path";
import { promisify } from "util";

// Promisify fs functions for async/await usage
const writeFile = promisify(fs.writeFile);
const appendFile = promisify(fs.appendFile);
const readFile = promisify(fs.readFile);
const mkdir = promisify(fs.mkdir);

export interface ScraperExecutionLog {
  executionId: string;
  orchestrationId: string;
  threadId: string;
  threadName: string;
  stepExecutionId: string;
  scraperId: string;
  scraperName: string;
  platform: string;
  projectId: string;
  projectName?: string;
  startTime: Date;
  endTime?: Date;
  duration?: number; // in milliseconds
  recordsCollected?: number;
  recordsInserted?: number;
  recordsNew?: number;
  recordsUpdated?: number;
  recordsDiscarded?: number;
  duplicateRecords?: number;
  status: "STARTED" | "COMPLETED" | "FAILED" | "CANCELLED";
  errorMessage?: string;
  scrapeJobId?: string;
}

export interface SentimentAnalysisLog {
  orchestrationId: string;
  executionId: string;
  projectId: string;
  projectName?: string;
  mode?: string;
  source?: string;
  processed: number;
  skipped: number;
  errors: number;
  duration: number; // in seconds
  sentimentBreakdown: {
    POSITIVE: number;
    NEGATIVE: number;
    NEUTRAL: number;
    MIXED: number;
  };
  analysisBreakdown?: {
    conversations: number;
    sentimentAnalyzed: number;
    influentialPeople: number;
    newsItems: number;
    themesMatched: number;
  };
  timestamp: Date;
}

export interface ExecutionSummary {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  cancelledExecutions: number;
  totalRecordsCollected: number;
  totalRecordsInserted: number;
  totalRecordsNew: number;
  totalRecordsUpdated: number;
  totalRecordsDiscarded: number;
  totalDuplicateRecords: number;
  averageDuration: number;
  totalDuration: number;
}

class ExecutionLogger {
  private logDir: string;
  private logFile: string;
  private lockFile: string;
  private isInitialized = false;
  /** Serialize writes in-process so concurrent steps don't stampede the same `.lock` file. */
  private logSerializeChain: Promise<unknown> = Promise.resolve();
  private static readonly STALE_LOCK_MS = 120_000;
  private static readonly MAX_LOCK_RETRIES = 200;
  private static readonly BASE_RETRY_MS = 50;

  constructor() {
    this.logDir = path.join(process.cwd(), "logs", "orchestration");
    this.logFile = path.join(this.logDir, "scraper-executions.jsonl");
    this.lockFile = path.join(this.logDir, ".lock");
  }

  /**
   * Initialize the logger by creating directories and files if they don't exist
   */
  private async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Create logs directory if it doesn't exist
      await mkdir(this.logDir, { recursive: true });

      // Create log file if it doesn't exist
      if (!fs.existsSync(this.logFile)) {
        await writeFile(this.logFile, "", "utf8");
      }

      this.isInitialized = true;
    } catch (error) {
      console.error("Failed to initialize execution logger:", error);
      throw error;
    }
  }

  private async serializeLog<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.logSerializeChain.then(operation, operation) as Promise<T>;
    this.logSerializeChain = run.then(
      () => undefined,
      () => undefined
    ) as Promise<unknown>;
    return run;
  }

  /** If `.lock` was left behind (crash, killed dev server), remove it after STALE_LOCK_MS. */
  private tryRemoveStaleLock(): void {
    try {
      if (!fs.existsSync(this.lockFile)) return;
      const st = fs.statSync(this.lockFile);
      const age = Date.now() - st.mtimeMs;
      if (age > ExecutionLogger.STALE_LOCK_MS) {
        fs.unlinkSync(this.lockFile);
        console.warn(
          `[ExecutionLogger] Removed stale lock file (${Math.round(age / 1000)}s old)`
        );
      }
    } catch {
      // ignore
    }
  }

  /**
   * Acquire a file lock for thread-safe writing (cross-process). In-process contention is handled by serializeLog.
   */
  private async acquireLock(): Promise<void> {
    for (let i = 0; i < ExecutionLogger.MAX_LOCK_RETRIES; i++) {
      this.tryRemoveStaleLock();
      try {
        const fd = fs.openSync(this.lockFile, "wx");
        fs.closeSync(fd);
        return;
      } catch (error: unknown) {
        const code =
          error && typeof error === "object" && "code" in error
            ? (error as { code: string }).code
            : "";
        if (code === "EEXIST") {
          const delay = Math.min(
            ExecutionLogger.BASE_RETRY_MS + Math.floor(i / 10) * 25,
            500
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }

    throw new Error("Failed to acquire file lock after maximum retries");
  }

  /**
   * Release the file lock
   */
  private async releaseLock(): Promise<void> {
    try {
      if (fs.existsSync(this.lockFile)) {
        fs.unlinkSync(this.lockFile);
      }
    } catch (error) {
      console.error("Failed to release file lock:", error);
    }
  }

  /**
   * Log scraper execution start
   */
  async logExecutionStart(
    logData: Omit<ScraperExecutionLog, "endTime" | "duration" | "status">
  ): Promise<void> {
    try {
      await this.serializeLog(async () => {
        await this.initialize();
        await this.acquireLock();
        try {
          const logEntry: ScraperExecutionLog = {
            ...logData,
            status: "STARTED",
          };

          const logLine = JSON.stringify(logEntry) + "\n";
          await appendFile(this.logFile, logLine, "utf8");
        } finally {
          await this.releaseLock();
        }
      });
    } catch (e) {
      console.error("[ExecutionLogger] logExecutionStart failed (non-fatal):", e);
    }
  }

  /**
   * Format duration in human-readable format
   */
  private formatDuration(ms: number): string {
    const seconds = ms / 1000;
    return `${seconds.toFixed(3)} seconds`;
  }

  /**
   * Log scraper execution completion
   */
  async logExecutionComplete(
    stepExecutionId: string,
    updates: {
      endTime: Date;
      duration: number;
      recordsCollected?: number;
      recordsInserted?: number;
      recordsDiscarded?: number;
      recordsNew?: number;
      recordsUpdated?: number;
      duplicateRecords?: number;
      status: "COMPLETED" | "FAILED" | "CANCELLED";
      errorMessage?: string;
      /**
       * Include orchestrationId, executionId, scraperName, etc. so getOrchestrationLogs still lists the step
       * when logExecutionStart was missed or failed (completion lines are merged by stepExecutionId).
       */
      identity?: Partial<
        Pick<
          ScraperExecutionLog,
          | "executionId"
          | "orchestrationId"
          | "threadId"
          | "threadName"
          | "scraperId"
          | "scraperName"
          | "platform"
          | "projectId"
          | "projectName"
        >
      > & { startTime?: Date };
    }
  ): Promise<void> {
    try {
      await this.serializeLog(async () => {
        await this.initialize();
        await this.acquireLock();
        try {
          const logEntry: Partial<ScraperExecutionLog> = {
            ...(updates.identity ?? {}),
            stepExecutionId,
            endTime: updates.endTime,
            duration: updates.duration / 1000, // Convert milliseconds to seconds
            recordsCollected: updates.recordsCollected,
            recordsInserted: updates.recordsInserted,
            recordsDiscarded: updates.recordsDiscarded,
            recordsNew: updates.recordsNew,
            recordsUpdated: updates.recordsUpdated,
            duplicateRecords: updates.duplicateRecords,
            status: updates.status,
            errorMessage: updates.errorMessage,
          };

          const logLine = JSON.stringify(logEntry) + "\n";
          await appendFile(this.logFile, logLine, "utf8");
        } finally {
          await this.releaseLock();
        }
      });
    } catch (e) {
      console.error("[ExecutionLogger] logExecutionComplete failed (non-fatal):", e);
    }
  }

  /**
   * Get execution logs for a specific orchestration
   */
  async getOrchestrationLogs(orchestrationId: string): Promise<ScraperExecutionLog[]> {
    await this.initialize();

    try {
      const logContent = await readFile(this.logFile, "utf8");
      const lines = logContent
        .trim()
        .split("\n")
        .filter((line) => line.trim());

      const logs: ScraperExecutionLog[] = [];
      const logMap = new Map<string, ScraperExecutionLog>();

      // Parse logs and merge start/completion entries
      for (const line of lines) {
        try {
          const logEntry = JSON.parse(line) as ScraperExecutionLog | Partial<ScraperExecutionLog>;

          if ("stepExecutionId" in logEntry && logEntry.stepExecutionId) {
            const stepId = logEntry.stepExecutionId;

            if (!logMap.has(stepId)) {
              // First entry for this step
              logMap.set(stepId, logEntry as ScraperExecutionLog);
            } else {
              // Merge with existing entry
              const existing = logMap.get(stepId)!;
              logMap.set(stepId, { ...existing, ...logEntry });
            }
          }
        } catch (error) {
          console.error("Failed to parse log line:", line, error);
        }
      }

      // Filter by orchestration ID and convert to array
      for (const log of logMap.values()) {
        if (log.orchestrationId === orchestrationId) {
          logs.push(log);
        }
      }

      // Sort by start time
      logs.sort((a, b) => {
        const aTime = a.startTime instanceof Date ? a.startTime : new Date(a.startTime);
        const bTime = b.startTime instanceof Date ? b.startTime : new Date(b.startTime);
        return aTime.getTime() - bTime.getTime();
      });

      // If there are multiple executions, only return the most recent one
      if (logs.length > 0) {
        // Group logs by execution ID
        const executionGroups = new Map<string, ScraperExecutionLog[]>();
        for (const log of logs) {
          const executionId = log.executionId;
          if (!executionGroups.has(executionId)) {
            executionGroups.set(executionId, []);
          }
          executionGroups.get(executionId)!.push(log);
        }

        // Find the most recent execution (highest start time)
        let mostRecentExecutionId = "";
        let mostRecentTime = 0;
        for (const [executionId, executionLogs] of executionGroups) {
          const firstLog = executionLogs[0];
          const startTime =
            firstLog.startTime instanceof Date ? firstLog.startTime : new Date(firstLog.startTime);
          if (startTime.getTime() > mostRecentTime) {
            mostRecentTime = startTime.getTime();
            mostRecentExecutionId = executionId;
          }
        }

        // Return only logs from the most recent execution
        return executionGroups.get(mostRecentExecutionId) || [];
      }

      return logs;
    } catch (error) {
      console.error("Failed to read execution logs:", error);
      return [];
    }
  }

  /**
   * Get execution summary for a specific orchestration
   */
  async getOrchestrationSummary(orchestrationId: string): Promise<ExecutionSummary> {
    const logs = await this.getOrchestrationLogs(orchestrationId);

    // Group logs by execution ID to find the most recent execution
    const executionGroups = new Map<string, ScraperExecutionLog[]>();
    logs.forEach((log) => {
      if (log.executionId) {
        if (!executionGroups.has(log.executionId)) {
          executionGroups.set(log.executionId, []);
        }
        executionGroups.get(log.executionId)!.push(log);
      }
    });

    // Get the most recent execution (latest start time)
    let mostRecentExecution: ScraperExecutionLog[] = [];
    let mostRecentStartTime = new Date(0);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const [executionId, executionLogs] of executionGroups) {
      const executionStartTime = executionLogs[0]?.startTime;
      if (executionStartTime && executionStartTime > mostRecentStartTime) {
        mostRecentStartTime = executionStartTime;
        mostRecentExecution = executionLogs;
      }
    }

    // If no recent execution found, use all logs (fallback)
    const summaryLogs = mostRecentExecution.length > 0 ? mostRecentExecution : logs;

    const summary: ExecutionSummary = {
      totalExecutions: logs.length,
      successfulExecutions: logs.filter((log) => log.status === "COMPLETED").length,
      failedExecutions: logs.filter((log) => log.status === "FAILED").length,
      cancelledExecutions: logs.filter((log) => log.status === "CANCELLED").length,
      totalRecordsCollected: summaryLogs.reduce((sum, log) => sum + (log.recordsCollected || 0), 0),
      totalRecordsInserted: summaryLogs.reduce((sum, log) => sum + (log.recordsInserted || 0), 0),
      totalRecordsNew: summaryLogs.reduce((sum, log) => sum + (log.recordsNew || 0), 0),
      totalRecordsUpdated: summaryLogs.reduce((sum, log) => sum + (log.recordsUpdated || 0), 0),
      totalRecordsDiscarded: summaryLogs.reduce((sum, log) => sum + (log.recordsDiscarded || 0), 0),
      totalDuplicateRecords: summaryLogs.reduce((sum, log) => sum + (log.duplicateRecords || 0), 0),
      averageDuration: 0,
      totalDuration: summaryLogs.reduce((sum, log) => sum + (log.duration || 0), 0),
    };

    if (summary.totalExecutions > 0) {
      summary.averageDuration = Math.round(summary.totalDuration / summary.totalExecutions);
    }

    return summary;
  }

  /**
   * Get all execution logs (for admin review)
   */
  async getAllLogs(): Promise<ScraperExecutionLog[]> {
    await this.initialize();

    try {
      const logContent = await readFile(this.logFile, "utf8");
      const lines = logContent
        .trim()
        .split("\n")
        .filter((line) => line.trim());

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const logs: ScraperExecutionLog[] = [];
      const logMap = new Map<string, ScraperExecutionLog>();

      // Parse logs and merge start/completion entries
      for (const line of lines) {
        try {
          const logEntry = JSON.parse(line) as ScraperExecutionLog | Partial<ScraperExecutionLog>;

          if ("stepExecutionId" in logEntry && logEntry.stepExecutionId) {
            const stepId = logEntry.stepExecutionId;

            if (!logMap.has(stepId)) {
              logMap.set(stepId, logEntry as ScraperExecutionLog);
            } else {
              const existing = logMap.get(stepId)!;
              logMap.set(stepId, { ...existing, ...logEntry });
            }
          }
        } catch (error) {
          console.error("Failed to parse log line:", line, error);
        }
      }

      return Array.from(logMap.values()).sort(
        (a, b) => b.startTime.getTime() - a.startTime.getTime()
      );
    } catch (error) {
      console.error("Failed to read execution logs:", error);
      return [];
    }
  }

  /**
   * Clear all logs (for maintenance)
   */
  async clearLogs(): Promise<void> {
    await this.serializeLog(async () => {
      await this.initialize();
      await this.acquireLock();
      try {
        await writeFile(this.logFile, "", "utf8");
      } finally {
        await this.releaseLock();
      }
    });
  }

  /**
   * Log sentiment analysis results for an orchestration
   */
  async logSentimentAnalysis(logData: SentimentAnalysisLog): Promise<void> {
    try {
      await this.serializeLog(async () => {
        await this.initialize();
        await this.acquireLock();
        try {
          const logEntry = {
            type: "SENTIMENT_ANALYSIS",
            ...logData,
          };
          const logLine = JSON.stringify(logEntry) + "\n";
          await appendFile(this.logFile, logLine, "utf8");
        } finally {
          await this.releaseLock();
        }
      });
    } catch (e) {
      console.error("[ExecutionLogger] logSentimentAnalysis failed (non-fatal):", e);
    }
  }

  /**
   * Get sentiment analysis logs for a specific orchestration
   */
  async getSentimentAnalysisLogs(orchestrationId: string): Promise<SentimentAnalysisLog[]> {
    await this.initialize();

    try {
      const logContent = await readFile(this.logFile, "utf8");
      const lines = logContent
        .trim()
        .split("\n")
        .filter((line) => line.trim());

      const sentimentLogs: SentimentAnalysisLog[] = [];

      for (const line of lines) {
        try {
          const logEntry = JSON.parse(line);
          if (
            logEntry.type === "SENTIMENT_ANALYSIS" &&
            logEntry.orchestrationId === orchestrationId
          ) {
            sentimentLogs.push({
              executionId: logEntry.executionId || "",
              orchestrationId: logEntry.orchestrationId,
              projectId: logEntry.projectId,
              projectName: logEntry.projectName,
              mode: logEntry.mode,
              source: logEntry.source,
              processed: logEntry.processed,
              skipped: logEntry.skipped,
              errors: logEntry.errors,
              duration: logEntry.duration,
              sentimentBreakdown: logEntry.sentimentBreakdown,
              analysisBreakdown: logEntry.analysisBreakdown,
              timestamp: new Date(logEntry.timestamp),
            });
          }
        } catch {
          // Skip malformed log entries
          continue;
        }
      }

      return sentimentLogs;
    } catch (error) {
      console.error("Error reading sentiment analysis logs:", error);
      return [];
    }
  }

  /**
   * Get sentiment analysis logs for a specific execution
   */
  async getSentimentAnalysisLogsForExecution(
    orchestrationId: string,
    executionId: string
  ): Promise<SentimentAnalysisLog[]> {
    await this.initialize();

    try {
      const logContent = await readFile(this.logFile, "utf8");
      const lines = logContent
        .trim()
        .split("\n")
        .filter((line) => line.trim());

      const sentimentLogs: SentimentAnalysisLog[] = [];

      for (const line of lines) {
        try {
          const logEntry = JSON.parse(line);
          if (
            logEntry.type === "SENTIMENT_ANALYSIS" &&
            logEntry.orchestrationId === orchestrationId &&
            logEntry.executionId === executionId
          ) {
            sentimentLogs.push({
              executionId: logEntry.executionId || "",
              orchestrationId: logEntry.orchestrationId,
              projectId: logEntry.projectId,
              projectName: logEntry.projectName,
              mode: logEntry.mode,
              source: logEntry.source,
              processed: logEntry.processed,
              skipped: logEntry.skipped,
              errors: logEntry.errors,
              duration: logEntry.duration,
              sentimentBreakdown: logEntry.sentimentBreakdown,
              analysisBreakdown: logEntry.analysisBreakdown,
              timestamp: new Date(logEntry.timestamp),
            });
          }
        } catch {
          // Skip malformed log entries
          continue;
        }
      }

      return sentimentLogs;
    } catch (error) {
      console.error("Error reading sentiment analysis logs for execution:", error);
      return [];
    }
  }

  /**
   * Get sentiment analysis logs for a specific project (across orchestrations)
   */
  async getSentimentAnalysisLogsForProject(
    projectId: string,
    limit = 10
  ): Promise<SentimentAnalysisLog[]> {
    try {
      await this.initialize();
    } catch (initError) {
      // If initialization fails (e.g., can't create log directory), return empty array
      console.warn("Failed to initialize execution logger, returning empty logs:", initError);
      return [];
    }

    try {
      // Check if log file exists before trying to read it
      if (!fs.existsSync(this.logFile)) {
        return [];
      }

      const logContent = await readFile(this.logFile, "utf8");
      const lines = logContent
        .trim()
        .split("\n")
        .filter((line) => line.trim());

      const sentimentLogs: SentimentAnalysisLog[] = [];

      for (const line of lines) {
        try {
          const logEntry = JSON.parse(line);
          if (logEntry.type === "SENTIMENT_ANALYSIS" && logEntry.projectId === projectId) {
            sentimentLogs.push({
              executionId: logEntry.executionId || "",
              orchestrationId: logEntry.orchestrationId,
              projectId: logEntry.projectId,
              projectName: logEntry.projectName,
              mode: logEntry.mode,
              source: logEntry.source,
              processed: logEntry.processed,
              skipped: logEntry.skipped,
              errors: logEntry.errors,
              duration: logEntry.duration,
              sentimentBreakdown: logEntry.sentimentBreakdown,
              analysisBreakdown: logEntry.analysisBreakdown,
              timestamp: new Date(logEntry.timestamp),
            });
          }
        } catch {
          continue;
        }
      }

      return sentimentLogs
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .slice(0, limit);
    } catch (error) {
      console.error("Error reading sentiment analysis logs for project:", error);
      return [];
    }
  }

  /**
   * Generate a clear orchestration summary
   */
  async generateOrchestrationSummary(orchestrationId: string): Promise<string> {
    const logs = await this.getOrchestrationLogs(orchestrationId);
    // Match sentiment lines to the same orchestration execution as the scraper logs (not the latest sentiment row globally).
    const executionId = logs[0]?.executionId;
    const sentimentLogs =
      executionId != null && executionId !== ""
        ? await this.getSentimentAnalysisLogsForExecution(orchestrationId, executionId)
        : [];

    if (logs.length === 0) {
      return `No execution logs found for orchestration ${orchestrationId}`;
    }

    const summary = [];
    summary.push("=".repeat(80));
    summary.push(`ORCHESTRATION EXECUTION SUMMARY`);
    summary.push(`Orchestration ID: ${orchestrationId}`);
    summary.push(`Execution Date: ${new Date(logs[0].startTime).toLocaleDateString()}`);
    summary.push("=".repeat(80));
    summary.push("");

    // Per-scraper details
    summary.push("SCRAPER EXECUTION DETAILS:");
    summary.push("-".repeat(80));

    let totalCollected = 0;
    let totalInserted = 0;
    let totalNew = 0;
    let totalUpdated = 0;
    let totalDiscarded = 0;
    let totalDuplicates = 0;
    let totalDuration = 0;
    let successfulScrapers = 0;
    let failedScrapers = 0;

    for (const log of logs) {
      const duration = this.formatDuration(log.duration || 0);
      const status = log.status === "COMPLETED" ? "✅" : "❌";

      summary.push(`${status} ${log.scraperName} (${log.platform})`);
      summary.push(`   Duration: ${duration}`);
      summary.push(`   Records Collected: ${log.recordsCollected || 0}`);
      summary.push(`   Records Inserted: ${log.recordsInserted || 0}`);
      summary.push(`   Records New: ${log.recordsNew || 0}`);
      summary.push(`   Records Updated: ${log.recordsUpdated || 0}`);
      summary.push(`   Records Discarded: ${log.recordsDiscarded || 0}`);
      summary.push(`   Duplicates: ${log.duplicateRecords || 0}`);
      if (log.errorMessage) {
        summary.push(`   Error: ${log.errorMessage}`);
      }
      summary.push("");

      // Accumulate totals
      totalCollected += log.recordsCollected || 0;
      totalInserted += log.recordsInserted || 0;
      totalNew += log.recordsNew || 0;
      totalUpdated += log.recordsUpdated || 0;
      totalDiscarded += log.recordsDiscarded || 0;
      totalDuplicates += log.duplicateRecords || 0;
      totalDuration += log.duration || 0;

      if (log.status === "COMPLETED") {
        successfulScrapers++;
      } else {
        failedScrapers++;
      }
    }

    // Sentiment Analysis Details
    if (sentimentLogs.length > 0) {
      summary.push("SENTIMENT ANALYSIS DETAILS:");
      summary.push("-".repeat(80));

      let totalProcessed = 0;
      let totalSkipped = 0;
      let totalErrors = 0;
      let totalSentimentDuration = 0;
      const totalSentimentBreakdown = {
        POSITIVE: 0,
        NEGATIVE: 0,
        NEUTRAL: 0,
        MIXED: 0,
      };

      for (const sentimentLog of sentimentLogs) {
        summary.push(`🧠 Project: ${sentimentLog.projectName || sentimentLog.projectId}`);
        summary.push(`   Records Analyzed: ${sentimentLog.processed}`);
        summary.push(`   Skipped: ${sentimentLog.skipped}`);
        summary.push(`   Errors: ${sentimentLog.errors}`);
        summary.push(`   Duration: ${sentimentLog.duration.toFixed(3)} seconds`);
        summary.push(`   Sentiment Breakdown:`);
        summary.push(`     • Positive: ${sentimentLog.sentimentBreakdown.POSITIVE}`);
        summary.push(`     • Negative: ${sentimentLog.sentimentBreakdown.NEGATIVE}`);
        summary.push(`     • Neutral: ${sentimentLog.sentimentBreakdown.NEUTRAL}`);
        summary.push(`     • Mixed: ${sentimentLog.sentimentBreakdown.MIXED}`);
        summary.push("");

        // Accumulate sentiment totals
        totalProcessed += sentimentLog.processed;
        totalSkipped += sentimentLog.skipped;
        totalErrors += sentimentLog.errors;
        totalSentimentDuration += sentimentLog.duration;
        totalSentimentBreakdown.POSITIVE += sentimentLog.sentimentBreakdown.POSITIVE;
        totalSentimentBreakdown.NEGATIVE += sentimentLog.sentimentBreakdown.NEGATIVE;
        totalSentimentBreakdown.NEUTRAL += sentimentLog.sentimentBreakdown.NEUTRAL;
        totalSentimentBreakdown.MIXED += sentimentLog.sentimentBreakdown.MIXED;
      }

      summary.push("SENTIMENT ANALYSIS TOTALS:");
      summary.push("-".repeat(80));
      summary.push(`Total Records Analyzed: ${totalProcessed}`);
      summary.push(`Total Skipped: ${totalSkipped}`);
      summary.push(`Total Errors: ${totalErrors}`);
      summary.push(`Total Duration: ${totalSentimentDuration.toFixed(3)} seconds`);
      summary.push(`Overall Sentiment Breakdown:`);
      summary.push(`  • Positive: ${totalSentimentBreakdown.POSITIVE}`);
      summary.push(`  • Negative: ${totalSentimentBreakdown.NEGATIVE}`);
      summary.push(`  • Neutral: ${totalSentimentBreakdown.NEUTRAL}`);
      summary.push(`  • Mixed: ${totalSentimentBreakdown.MIXED}`);
      summary.push("");
    }

    // Summary totals
    summary.push("ORCHESTRATION TOTALS:");
    summary.push("-".repeat(80));
    summary.push(`Total Scrapers: ${logs.length}`);
    summary.push(`Successful: ${successfulScrapers}`);
    summary.push(`Failed: ${failedScrapers}`);
    summary.push(`Total Duration: ${this.formatDuration(totalDuration)}`);
    summary.push(`Total Records Collected: ${totalCollected}`);
    summary.push(`Total Records Inserted: ${totalInserted}`);
    summary.push(`Total Records New: ${totalNew}`);
    summary.push(`Total Records Updated: ${totalUpdated}`);
    summary.push(`Total Records Discarded: ${totalDiscarded}`);
    summary.push(`Total Duplicates: ${totalDuplicates}`);
    summary.push("=".repeat(80));

    return summary.join("\n");
  }

  /**
   * Export logs to CSV format
   */
  async exportToCSV(orchestrationId?: string): Promise<string> {
    const logs = orchestrationId
      ? await this.getOrchestrationLogs(orchestrationId)
      : await this.getAllLogs();

    const headers = [
      "Execution ID",
      "Orchestration ID",
      "Thread Name",
      "Scraper Name",
      "Platform",
      "Project ID",
      "Start Time",
      "End Time",
      "Duration (ms)",
      "Status",
      "Records Collected",
      "Records Inserted",
      "Duplicate Records",
      "Error Message",
    ];

    const csvLines = [headers.join(",")];

    for (const log of logs) {
      const row = [
        log.executionId,
        log.orchestrationId,
        `"${log.threadName}"`,
        `"${log.scraperName}"`,
        log.platform,
        log.projectId,
        log.startTime.toISOString(),
        log.endTime?.toISOString() || "",
        log.duration?.toString() || "",
        log.status,
        log.recordsCollected?.toString() || "",
        log.recordsInserted?.toString() || "",
        log.duplicateRecords?.toString() || "",
        `"${log.errorMessage || ""}"`,
      ];
      csvLines.push(row.join(","));
    }

    return csvLines.join("\n");
  }
}

// Singleton instance
export const executionLogger = new ExecutionLogger();
