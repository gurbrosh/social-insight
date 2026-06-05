import { prisma } from "@/lib/prisma";
import { getBrandDirectoryUrlsForProject } from "@/lib/brand-directory/project-brand-urls-service";
import {
  getProjectContextForRelevance,
  isPostRelevantToProjectContext,
} from "@/lib/comprehensive-analysis";
import {
  transformGenericPost,
  transformFacebookComments,
  // transformLinkedInComments,
  validatePostData,
  extractYouTubeVideoIdFromUrl,
} from "@/lib/data-transformer";
import { extractTranscriptFromYouTubeItem } from "@/lib/youtube-transcript";
import { summarizeTranscriptWithOpenAI } from "@/lib/youtube-summary";
import { configService } from "@/lib/config-service";
import { detectLanguage } from "@/lib/utils/language-detector";
import { Prisma } from "@prisma/client";

const DOWNSTREAM_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Single GET /actor-runs/:id — should be fast; retry on hang instead of one 15m abort. */
const APIFY_RUN_STATUS_FETCH_TIMEOUT_MS = Math.max(
  30_000,
  parseInt(process.env.APIFY_RUN_STATUS_FETCH_TIMEOUT_MS ?? "", 10) || 120_000
);

function isTransientApifyStatusFetchError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const msg = e.message || "";
  const name = e.name || "";
  return (
    name === "AbortError" ||
    /aborted|timeout|ETIMEDOUT|ECONNRESET|EAI_AGAIN|fetch failed|SocketError|UND_ERR_SOCKET/i.test(
      msg
    )
  );
}

/**
 * Parse oldestPostDate string (e.g. "2 days", "1 day", "1 week") to milliseconds.
 * Returns null if unparseable. Used for YouTube date filtering.
 */
function parseOldestPostDateToMs(value: string | null | undefined): number | null {
  const s = (value || "").trim();
  if (!s) return null;
  const match = s.match(/^(\d+)\s*(day|days|week|weeks|month|months|year|years)$/i);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  if (!Number.isFinite(num) || num < 0) return null;
  const unit = match[2].toLowerCase().replace(/s$/, ""); // "days" -> "day"
  const multipliers: Record<string, number> = {
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000,
  };
  const ms = multipliers[unit];
  return ms != null ? num * ms : null;
}

/**
 * Sanitize string for Prisma/JSON - remove backslashes that cause "unexpected end of hex escape".
 * Returns null for empty/undefined; otherwise returns string with backslashes removed.
 */
function sanitizeStringForPrisma(s: string | null | undefined): string | null {
  if (s == null || typeof s !== "string") return null;
  const t = s.trim();
  if (t === "") return null;
  return t.replace(/\\/g, "");
}

/**
 * For `prisma.post.upsert` `update`: omit `ingested_run_id` so re-scrapes do not re-tag existing rows
 * to the current orchestration run. `freezeRunMembership` only includes posts whose first insert
 * stamped this run (new content only).
 */
function postUpsertUpdateWithoutIngestedRunId<T extends Record<string, unknown>>(
  data: T
): Omit<T, "ingested_run_id"> {
  const { ingested_run_id: _omitIngestedRunId, ...rest } = data as T & {
    ingested_run_id?: string | null;
  };
  void _omitIngestedRunId;
  return rest;
}

const FACEBOOK_ONLY_POSTS_NEWER_UNITS = ["minute", "hour", "day", "week", "month", "year"] as const;

/**
 * Normalize onlyPostsNewerThan for Apify Facebook Posts Scraper.
 * API expects: number + optional space + lowercase unit (minute|hour|day|week|month|year) + optional 's'.
 * e.g. "1 Day" -> "1 day", "2 Weeks" -> "2 weeks".
 */
function normalizeOnlyPostsNewerThan(value: string): string | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d+)\s*(\w+)$/i);
  if (!match) return null;
  const num = match[1];
  const word = match[2].toLowerCase().replace(/s$/, ""); // "days" -> "day"
  if (
    !FACEBOOK_ONLY_POSTS_NEWER_UNITS.includes(
      word as (typeof FACEBOOK_ONLY_POSTS_NEWER_UNITS)[number]
    )
  ) {
    return null;
  }
  return `${num} ${word}`;
}

/**
 * Normalize X/Twitter profile URL to x.com form required by Apify X Profile Posts Scraper.
 * Actor accepts only: ^(https:\/\/)?(www\.)?x\.com\/[^\s,]+$
 * Converts twitter.com URLs to x.com; leaves x.com URLs as-is (canonicalized).
 */
function normalizeXProfileUrl(url: string): string {
  const trimmed = (url || "").trim().replace(/\/+$/, "");
  if (!trimmed) return trimmed;
  try {
    const u = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    const host = u.hostname.toLowerCase();
    let path = u.pathname.replace(/^\/+|\/+$/g, "") || "";
    // Strip /status/... or other path segments - we only want the profile handle (first segment)
    const firstSegment = path.split("/")[0];
    if (firstSegment) path = firstSegment;
    if (!path) return trimmed;
    return `https://x.com/${path}`;
  } catch {
    return trimmed;
  }
}

/**
 * Derive an X profile URL for the Profile Posts scraper from a DownstreamPost row
 * (Twitter Search → Profile Posts orchestration). Prefer stored authorProfileUrl;
 * otherwise parse /{handle}/status/... from the tweet permalink. Skip x.com/i/status/... when handle is missing.
 */
function deriveXProfileUrlFromDownstreamRow(row: {
  authorProfileUrl: string | null;
  url: string | null;
}): string | null {
  const author = typeof row.authorProfileUrl === "string" ? row.authorProfileUrl.trim() : "";
  if (author) {
    const n = normalizeXProfileUrl(author);
    if (n && !/\/i\/?$/i.test(n) && !n.endsWith("://x.com/i")) return n;
  }
  const tweet = typeof row.url === "string" ? row.url.trim() : "";
  if (!tweet) return null;
  try {
    const u = new URL(tweet);
    const host = u.hostname.toLowerCase();
    if (host !== "x.com" && host !== "twitter.com" && host !== "www.twitter.com") {
      return null;
    }
    const parts = u.pathname.split("/").filter(Boolean);
    if (
      parts.length >= 2 &&
      parts[0] !== "i" &&
      parts[0] !== "intent" &&
      parts[1] === "status"
    ) {
      return normalizeXProfileUrl(`https://x.com/${parts[0]}`);
    }
  } catch {
    /* fall through */
  }
  return null;
}

interface ApifyRunResult {
  id: string;
  status: string;
  startedAt?: string;
  finishedAt?: string;
  defaultDatasetId?: string;
  defaultKeyValueStoreId?: string;
  statusMessage?: string;
  notFound?: boolean;
}

interface ApifyDatasetItem {
  [key: string]: any; // Raw data from Apify, will be transformed
}

export class ApifyService {
  // Global stop flag to prevent spawning new runs when stopping orchestrations
  private static stopRequested = false;

  static requestStop(): void {
    ApifyService.stopRequested = true;
    console.log("🛑 ApifyService: stop requested - will not start new runs");
  }

  static clearStop(): void {
    ApifyService.stopRequested = false;
    console.log("✅ ApifyService: stop cleared - new runs can start");
  }
  private apiToken: string | null = null;
  // Base URL is now retrieved dynamically from config service

  constructor() {
    // Don't initialize API token in constructor to avoid build-time errors
    // Token will be checked when methods are actually called
  }

  /**
   * curious_coder/discord-data-scraper INPUT schema (Apify Console) uses flat keys:
   * action, token, scrapeMessages.channelUrl | scrapeChannelMembers.channelUrl, count, …
   * We do not pass `cursor` — incremental resume via this actor has proven unreliable.
   * Strip `items`, nested `scrapeMessages`, and any cursor fields from config drift.
   * @see https://console.apify.com/actors/AxFvOpSpBwSnI0Iyy/information/latest/input
   */
  private canonicalizeDiscordDataScraperInput(input: any): void {
    if (!input || typeof input !== "object") return;

    const action = (input.action as string) || "scrapeMessages";
    input.action = action;

    const sm = input.scrapeMessages;
    if (typeof sm === "object" && sm !== null) {
      if (input.count == null && (sm as { count?: unknown }).count != null) {
        const n = Number((sm as { count?: unknown }).count);
        if (Number.isFinite(n)) input.count = n;
      }
    }
    delete input.cursor;
    delete input["scrapeMessages.cursor"];

    delete input.items;
    delete input.channelUrl;
    delete input.scrapeMessages;

    if (action === "scrapeMessages") {
      delete input["scrapeChannelMembers.channelUrl"];
    } else if (action === "scrapeChannelMembers") {
      delete input["scrapeMessages.channelUrl"];
    }
  }

  private finalizeDiscordApifyInput(input: any, platform?: string): void {
    if (!input || typeof input !== "object") return;

    const plat = platform?.toLowerCase();
    const sm = input.scrapeMessages;
    const scm = input.scrapeChannelMembers;
    // Nested-only configs use scrapeMessages: { channelUrl: "..." | [...] } without a root
    // "scrapeMessages.channelUrl" key — that must still count as Discord.
    const nestedSm =
      sm &&
      typeof sm === "object" &&
      (typeof (sm as { channelUrl?: unknown }).channelUrl === "string" ||
        Array.isArray((sm as { channelUrl?: unknown }).channelUrl));
    const nestedMembers =
      scm &&
      typeof scm === "object" &&
      (typeof (scm as { channelUrl?: unknown }).channelUrl === "string" ||
        Array.isArray((scm as { channelUrl?: unknown }).channelUrl));

    const forDiscord =
      plat === "discord" ||
      "scrapeMessages.channelUrl" in input ||
      "scrapeChannelMembers.channelUrl" in input ||
      nestedSm ||
      nestedMembers ||
      (typeof input.channelUrl === "string" && input.channelUrl.includes("discord.com"));

    if (!forDiscord) return;

    // Never send internal orchestration fields to Apify. Maps stringify as {} and can confuse actors.
    for (const key of Object.keys(input)) {
      if (key.startsWith("_")) {
        delete input[key];
      }
    }

    const dotted = input["scrapeMessages.channelUrl"];
    const dottedM = input["scrapeChannelMembers.channelUrl"];
    const flat = input.channelUrl;
    let url = "";
    let urlResolvedFromMembers = false;
    if (typeof flat === "string" && flat.trim()) url = flat.trim();
    else if (typeof dotted === "string" && dotted.trim()) url = dotted.trim();
    else if (Array.isArray(dotted) && typeof dotted[0] === "string" && dotted[0]?.trim()) {
      url = dotted[0].trim();
    } else if (sm && typeof sm === "object") {
      const ch = (sm as { channelUrl?: unknown }).channelUrl;
      if (typeof ch === "string" && ch.trim()) url = ch.trim();
      else if (Array.isArray(ch) && typeof ch[0] === "string" && ch[0]?.trim()) {
        url = ch[0].trim();
      }
    } else if (typeof dottedM === "string" && dottedM.trim()) {
      url = dottedM.trim();
      urlResolvedFromMembers = true;
    } else if (Array.isArray(dottedM) && typeof dottedM[0] === "string" && dottedM[0]?.trim()) {
      url = dottedM[0].trim();
      urlResolvedFromMembers = true;
    } else if (scm && typeof scm === "object") {
      const ch = (scm as { channelUrl?: unknown }).channelUrl;
      if (typeof ch === "string" && ch.trim()) url = ch.trim();
      else if (Array.isArray(ch) && typeof ch[0] === "string" && ch[0]?.trim()) {
        url = ch[0].trim();
      }
      if (url) urlResolvedFromMembers = true;
    }

    const explicitAction = input.action as string | undefined;
    const action =
      explicitAction || (urlResolvedFromMembers ? "scrapeChannelMembers" : "scrapeMessages");
    if (url) {
      if (action === "scrapeChannelMembers") {
        input["scrapeChannelMembers.channelUrl"] = url;
        input.action = "scrapeChannelMembers";
      } else {
        input["scrapeMessages.channelUrl"] = url;
        input.action = "scrapeMessages";
      }
    }

    const fromEnv = process.env.DISCORD_BOT_TOKEN?.trim();
    if (fromEnv) input.token = fromEnv;

    this.canonicalizeDiscordDataScraperInput(input);
  }

  private async getBaseUrl(): Promise<string> {
    const configUrl = await configService.getConfig("api", "apify_base_url");

    if (!configUrl) {
      throw new Error(
        "Apify base URL not configured. Please set the 'apify_base_url' configuration in the API category."
      );
    }

    return configUrl;
  }

  private async getTimeoutForPlatform(platform: string): Promise<number> {
    const platformKey =
      platform.toLowerCase() === "x" || platform.toLowerCase() === "twitter"
        ? "twitter_timeout"
        : `${platform.toLowerCase()}_timeout`;

    const timeout = await configService.getConfig("scraping", platformKey);
    return timeout || (await configService.getConfig("scraping", "default_timeout")) || 3600;
  }

  private ensureApiToken(): string {
    if (!this.apiToken) {
      this.apiToken = process.env.APIFY_API_TOKEN || "";
      if (!this.apiToken) {
        throw new Error("APIFY_API_TOKEN environment variable is required");
      }
    }
    return this.apiToken;
  }

  /**
   * Cancel an Apify job
   */
  async cancelJob(runId: string): Promise<void> {
    const token = this.ensureApiToken();

    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/actor-runs/${runId}/abort`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Failed to cancel Apify job ${runId}:`, errorText);
        throw new Error(`Failed to cancel Apify job: ${response.status} ${response.statusText}`);
      }

      console.log(`Successfully cancelled Apify job ${runId}`);
    } catch (error) {
      console.error(`Error cancelling Apify job ${runId}:`, error);
      throw error;
    }
  }

  /**
   * Get all running jobs for the user
   */
  async getAllRunningJobs(): Promise<any[]> {
    const token = this.ensureApiToken();

    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/actor-runs?status=RUNNING&limit=100`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Failed to get running jobs:`, errorText);
        throw new Error(`Failed to get running jobs: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.data || [];
    } catch (error) {
      console.error(`Error getting running jobs:`, error);
      throw error;
    }
  }

  /**
   * Cancel ALL running jobs for the user
   */
  async cancelAllRunningJobs(): Promise<void> {
    this.ensureApiToken();

    try {
      console.log("Fetching all running Apify jobs...");
      const runningJobs = await this.getAllRunningJobs();

      // Handle case where API returns undefined or null
      if (!runningJobs || !Array.isArray(runningJobs)) {
        console.log("No running jobs found to cancel (API returned:", runningJobs, ")");
        return;
      }

      if (runningJobs.length === 0) {
        console.log("No running jobs found to cancel");
        return;
      }

      console.log(`Found ${runningJobs.length} running jobs to cancel`);

      const cancelPromises = runningJobs.map(async (job) => {
        try {
          await this.cancelJob(job.id);
          console.log(`Cancelled job ${job.id} (${job.actorId})`);
        } catch (error) {
          console.error(`Failed to cancel job ${job.id}:`, error);
        }
      });

      await Promise.allSettled(cancelPromises);
      console.log("Finished cancelling all running jobs");
    } catch (error) {
      console.error(`Error cancelling all running jobs:`, error);
      // Don't throw error - just log it and continue
      console.log("Continuing despite error...");
    }
  }

  /**
   * Get job status from Apify API
   */
  async getJobStatus(runId: string): Promise<any> {
    const token = this.ensureApiToken();

    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}/actor-runs/${runId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Failed to get job status ${runId}:`, errorText);
        throw new Error(`Failed to get job status: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.data || {};
    } catch (error) {
      console.error(`Error getting job status ${runId}:`, error);
      throw error;
    }
  }

  /**
   * Start a scraper run on Apify (asynchronous)
   */
  async startScraper(actorId: string, input: any, platform?: string): Promise<ApifyRunResult> {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`🚀 STARTING SCRAPER RUN`);
    console.log(`${"=".repeat(80)}`);
    console.log(`Actor ID: ${actorId}`);
    console.log(`Platform: ${platform || "not specified"}`);
    console.log(`\n📋 SCRAPER INPUT CONFIGURATION:`);
    console.log(JSON.stringify(input, null, 2));
    console.log(`${"=".repeat(80)}\n`);

    const baseUrl = await this.getBaseUrl();

    // Get timeout based on platform (defaults to 1 hour if not specified)
    const timeoutSecs = platform ? await this.getTimeoutForPlatform(platform) : 3600;
    console.log(`Starting scraper - Timeout: ${timeoutSecs} seconds (${timeoutSecs / 60} minutes)`);

    // Add timeout as URL parameter (as per apify-client-js)
    const url = `${baseUrl}/acts/${actorId}/runs?timeout=${timeoutSecs}`;
    console.log(`Starting scraper - URL: ${url}`);

    this.finalizeDiscordApifyInput(input, platform);

    // Send input at the top-level, matching successful curl tests
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.ensureApiToken()}`,
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(15 * 60 * 1000), // 15 minutes timeout for HTTP request
    });

    console.log(`Starting scraper - Response status: ${response.status}`);

    if (!response.ok) {
      const error = await response.text();
      console.log(`Starting scraper - Error response:`, error);
      throw new Error(`Failed to start scraper: ${error}`);
    }

    const json = await response.json();
    console.log(`Starting scraper - Success response:`, JSON.stringify(json, null, 2));
    return json && json.data ? json.data : json;
  }

  /**
   * Start a scraper run synchronously and wait for completion
   */
  async runScraperSync(actorId: string, input: any, platform?: string): Promise<ApifyRunResult> {
    // Get timeout based on platform (defaults to 30 minutes if not specified)
    const timeoutSecs = platform ? await this.getTimeoutForPlatform(platform) : 1800;
    console.log(
      `Sync scraper - Platform: ${platform || "not specified"}, Timeout: ${timeoutSecs} seconds (${timeoutSecs / 60} minutes)`
    );

    // Add waitForFinish and timeout parameters
    const baseUrl = await this.getBaseUrl();
    const url = `${baseUrl}/acts/${actorId}/runs?waitForFinish=${timeoutSecs}&timeout=${timeoutSecs}`;

    this.finalizeDiscordApifyInput(input, platform);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.ensureApiToken()}`,
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(15 * 60 * 1000), // 15 minutes timeout
    });

    if (!response.ok) {
      const error = await response.text();
      console.log(`Synchronous scraper - Error response:`, error);
      throw new Error(`Failed to run scraper synchronously: ${error}`);
    }

    const json = await response.json();

    const runData = json && json.data ? json.data : json;

    // If the run is still not finished, poll for completion
    if ((runData.status === "READY" || runData.status === "RUNNING") && !runData.finishedAt) {
      console.log(`Run is ${runData.status} but not finished, polling for completion...`);

      const baseUrl = await this.getBaseUrl();
      const statusUrl = `${baseUrl}/acts/${runData.actId}/runs/${runData.id}`;
      let attempts = 0;
      const maxAttempts = 20; // Poll for up to 10 minutes (20 * 30 seconds)

      while (attempts < maxAttempts) {
        attempts++;
        const pollingInterval =
          (await configService.getConfig("performance", "apify_status_polling_interval")) || 30000;
        console.log(
          `Polling attempt ${attempts}/${maxAttempts} - waiting ${pollingInterval / 1000} seconds...`
        );
        await new Promise((resolve) => setTimeout(resolve, pollingInterval));

        try {
          const statusResponse = await fetch(statusUrl, {
            headers: {
              Authorization: `Bearer ${this.ensureApiToken()}`,
            },
            signal: AbortSignal.timeout(15 * 60 * 1000), // 15 minutes timeout
          });

          if (statusResponse.ok) {
            const statusResult = await statusResponse.json();
            const currentRunData = statusResult.data || statusResult;
            const currentStatus = currentRunData.status;
            const finishedAt = currentRunData.finishedAt;

            console.log(
              `Poll attempt ${attempts}: status=${currentStatus}, finishedAt=${finishedAt}`
            );

            if (
              finishedAt ||
              currentStatus === "SUCCEEDED" ||
              currentStatus === "FAILED" ||
              currentStatus === "ABORTED"
            ) {
              console.log(`Run completed with status: ${currentStatus}`);
              return currentRunData;
            }

            // Log progress if available
            if (currentRunData.statusMessage) {
              console.log(`Progress: ${currentRunData.statusMessage}`);
            }
          } else {
            console.log(`Status check failed on attempt ${attempts}`);
          }
        } catch (error) {
          console.log(`Error checking status on attempt ${attempts}:`, error);
        }
      }

      console.log(
        `Run did not complete within ${maxAttempts * 30} seconds, returning current status`
      );
    }

    return runData;
  }

  /**
   * Get the status of a scraper run.
   * Retries on 502/503/504 (transient gateway errors) up to 3 times with backoff.
   */
  async getRunStatus(runId: string): Promise<ApifyRunResult> {
    const baseUrl = await this.getBaseUrl();
    const url = `${baseUrl}/actor-runs/${runId}`;
    const maxRetries = 5;
    const retryableStatuses = new Set([502, 503, 504]);
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.ensureApiToken()}`,
          },
          signal: AbortSignal.timeout(APIFY_RUN_STATUS_FETCH_TIMEOUT_MS),
        });

        if (response.ok) {
          const json = await response.json();
          const data = json && json.data ? json.data : json;
          if (data && !data.statusMessage && data.data?.statusMessage) {
            data.statusMessage = data.data.statusMessage;
          }
          return data;
        }

        const rawText = await response.text();
        let parsed: any = null;
        try {
          parsed = rawText ? JSON.parse(rawText) : null;
        } catch {
          // Ignore JSON parse errors
        }

        const errorType = parsed?.error?.type;
        const statusMessage =
          parsed?.error?.message ||
          parsed?.message ||
          rawText ||
          `HTTP ${response.status} ${response.statusText}`;

        if (response.status === 404 || errorType === "record-not-found") {
          console.warn(
            `[ApifyService] Run ${runId} not found (status ${response.status}). Marking as failed.`
          );
          return {
            id: runId,
            status: "NOT-FOUND",
            startedAt: new Date(0).toISOString(),
            finishedAt: new Date().toISOString(),
            statusMessage,
            notFound: true,
          };
        }

        const err = new Error(`Failed to get run status (${response.status}): ${statusMessage}`);
        if (retryableStatuses.has(response.status) && attempt < maxRetries) {
          const delayMs = attempt * 2000;
          console.warn(
            `[ApifyService] Run ${runId} got ${response.status} (attempt ${attempt}/${maxRetries}). Retrying in ${delayMs}ms...`
          );
          lastError = err;
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        throw err;
      } catch (e) {
        if (e instanceof Error) {
          lastError = e;
          const gatewayErr =
            e.message.includes("502") ||
            e.message.includes("503") ||
            e.message.includes("504");
          const transient = isTransientApifyStatusFetchError(e);
          if (attempt < maxRetries && (gatewayErr || transient)) {
            const delayMs = attempt * 2000;
            console.warn(
              `[ApifyService] Run ${runId} status request failed (attempt ${attempt}/${maxRetries}). Retrying in ${delayMs}ms…`,
              e.message
            );
            await new Promise((r) => setTimeout(r, delayMs));
            continue;
          }
        }
        throw e;
      }
    }

    throw (
      lastError ?? new Error(`Failed to get run status for ${runId} after ${maxRetries} attempts`)
    );
  }

  private async waitForRunCompletion(runId: string, scraperName: string): Promise<void> {
    console.log(
      `🔍 DEBUG: waitForRunCompletion called with runId: ${runId}, scraperName: ${scraperName}`
    );
    const maxAttempts = 60; // ~30 minutes with 30s interval
    const pollingInterval =
      (await configService.getConfig("performance", "apify_status_polling_interval")) || 30000;

    for (let attempts = 0; attempts < maxAttempts; attempts++) {
      let runStatus: ApifyRunResult;
      try {
        runStatus = await this.getRunStatus(runId);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(
          `[ApifyService] Status poll error for ${runId} (${scraperName}) ` +
            `(wait attempt ${attempts + 1}/${maxAttempts}): ${msg}. Retrying in ${pollingInterval}ms.`
        );
        await new Promise((resolve) => setTimeout(resolve, pollingInterval));
        continue;
      }

      const status = runStatus.status;
      if (status === "SUCCEEDED") {
        console.log(`✅ Run ${runId} (${scraperName}) completed successfully`);
        return;
      }
      if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
        const message = (runStatus as any).statusMessage || status;
        throw new Error(`Run ${runId} (${scraperName}) failed: ${message}`);
      }
      console.log(`Run ${runId} status: ${status} (attempt ${attempts + 1}/${maxAttempts})`);
      await new Promise((resolve) => setTimeout(resolve, pollingInterval));
    }
    throw new Error(`Run ${runId} (${scraperName}) did not complete within the expected time`);
  }

  /**
   * Get the dataset from a completed run
   */
  async getDatasetItems(datasetId: string): Promise<ApifyDatasetItem[]> {
    // First, let's check the dataset info to see if it has any items
    const baseUrl = await this.getBaseUrl();
    const datasetInfoUrl = `${baseUrl}/datasets/${datasetId}`;

    try {
      const infoResponse = await fetch(datasetInfoUrl, {
        headers: {
          Authorization: `Bearer ${this.ensureApiToken()}`,
        },
        signal: AbortSignal.timeout(15 * 60 * 1000), // 15 minutes timeout
      });

      if (infoResponse.ok) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const datasetInfo = await infoResponse.json();
      }
    } catch (error) {
      console.log(`Error getting dataset info:`, error);
    }

    // Now try to get the items
    const url = `${baseUrl}/datasets/${datasetId}/items`;

    // Try multiple times with delays, as dataset might not be immediately available
    for (let attempt = 1; attempt <= 3; attempt++) {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.ensureApiToken()}`,
        },
        signal: AbortSignal.timeout(15 * 60 * 1000), // 15 minutes timeout
      });

      if (!response.ok) {
        const error = await response.text();
        console.log(`Dataset fetch error:`, error);
        if (attempt === 3) {
          throw new Error(`Failed to get dataset items after 3 attempts: ${error}`);
        }
        // Wait before retry
        const retryDelay = (await configService.getConfig("performance", "retry_delay")) || 2000;
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        continue;
      }

      const data = await response.json();

      // Handle both array and object responses
      let items: ApifyDatasetItem[] = [];
      if (Array.isArray(data)) {
        items = data;
      } else if (data && typeof data === "object" && Array.isArray(data.items)) {
        items = data.items;
      } else {
        items = [];
      }

      // If we got items, return them
      if (items.length > 0) {
        return items;
      }

      // If no items and this isn't the last attempt, wait and retry
      if (attempt < 3) {
        const retryDelay = (await configService.getConfig("performance", "retry_delay")) || 2000;
        await new Promise((resolve) => setTimeout(resolve, retryDelay + 1000)); // Add 1 second for dataset retries
      }
    }

    return [];
  }

  /**
   * Test a scraper with sample input
   */
  async testScraper(actorId: string, input: any): Promise<any> {
    try {
      const run = await this.startScraper(actorId, input);

      // Verify the run actually started
      if (!run || !run.id) {
        return {
          success: false,
          error: "Failed to start scraper - no run ID returned",
        };
      }

      // Check if the run status indicates it started properly
      if (run.status === "FAILED" || run.status === "ABORTED") {
        return {
          success: false,
          runId: run.id,
          status: run.status,
          error: `Scraper run failed to start properly. Status: ${run.status}`,
        };
      }

      // Only return success if we have a valid run ID and it's not in a failed state
      return {
        success: true,
        runId: run.id,
        status: run.status,
        message: `Scraper run started successfully with ID: ${run.id}. Status: ${run.status}`,
      };
    } catch (error) {
      console.error("Error in testScraper:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Try to derive a stable platform post ID from raw item data and/or URL when not provided.
   * This normalizes differences across actors before validation/upsert.
   */
  private derivePostIdFromItem(
    raw: Record<string, any>,
    transformed: Record<string, any>,
    platform?: string
  ): string | null {
    const url: string | undefined = transformed?.url || raw?.url || raw?.post_url || raw?.permalink;
    const extra = transformed?.extraJson || raw?.extraJson || raw;
    const lowerPlatform = (platform || transformed?.platform || raw?.platform || "")
      .toString()
      .toLowerCase();

    // 1) Direct known id fields from actors
    const directCandidates: Array<any> = [
      transformed?.postId,
      raw?.postId,
      raw?.id,
      raw?.id_str,
      raw?.tweetId,
      raw?.tweet_id,
      raw?.replyId, // For X Post Replies scraper
      extra?.activity_id,
      extra?.id,
      extra?.id_str,
    ];
    for (const cand of directCandidates) {
      if (cand !== undefined && cand !== null && String(cand).trim() !== "") {
        return String(cand);
      }
    }

    if (url && typeof url === "string") {
      // 2) Platform-specific extraction from URL
      if (lowerPlatform === "x" || lowerPlatform === "twitter") {
        // https://x.com/{user}/status/1234567890123456789
        const m = url.match(/\/(?:status|statuses)\/(\d{8,})/);
        if (m?.[1]) return m[1];
      }
      if (lowerPlatform === "linkedin") {
        // https://www.linkedin.com/posts/...activity-7378459113904758784-...
        const m1 = url.match(/activity-(\d{6,})/);
        if (m1?.[1]) return m1[1];
        // Or urn:li:activity:737845...
        const urn = extra?.full_urn || transformed?.threadRefId || raw?.full_urn;
        const m2 = typeof urn === "string" ? urn.match(/activity:(\d{6,})/) : null;
        if (m2?.[1]) return m2[1];
      }
      if (lowerPlatform === "reddit") {
        // https://www.reddit.com/r/<sub>/comments/<postId>/...
        const m = url.match(/\/comments\/([a-z0-9]{5,})\//i);
        if (m?.[1]) return m[1];
      }
      if (lowerPlatform === "facebook") {
        // Try story_fbid or fbid param, else trailing numeric segment
        const story =
          new URL(url).searchParams.get("story_fbid") || new URL(url).searchParams.get("fbid");
        if (story) return story;
        const m = url.match(/(\d{8,})(?:\/?|$)/);
        if (m?.[1]) return m[1];
      }
      if (lowerPlatform === "discord") {
        // Discord message URL: .../channels/<guild>/<channel>/<messageId>
        const m = url.match(/\/channels\/\d+\/\d+\/(\d{8,})/);
        if (m?.[1]) return m[1];
      }
    }

    // 3) Fallbacks via extraJson text
    if (extra && typeof extra === "object") {
      const urn = extra.full_urn || extra.urn || extra.thread || extra.thread_id;
      const m = typeof urn === "string" ? urn.match(/(\d{6,})/) : null;
      if (m?.[1]) return m[1];
    }

    return null;
  }

  /**
   * Process scraped data and save to database
   */
  async processAndSavePosts(
    projectId: string,
    jobId: string | null,
    items: ApifyDatasetItem[],
    isTest: boolean = false,
    platform?: string,
    scraperName?: string,
    saveToDb: boolean = true,
    orchestrationExecutionId?: string,
    scraperConfig?: { oldestPostDate?: string },
    /** When set, this scraper consumes from another (e.g. YouTube Comments from YouTube Search). Skip YouTube validation — parent already decided what's in scope. */
    urlInputSourceScraper?: string | null,
    /** When set (e.g. job.used_urls for YouTube Comments), a single URL is used as fallback thread_ref_id for every comment when the item has no videoId. */
    sourceVideoUrls?: string[] | null,
    /** OrchestrationRun.id for task-based analysis; stamped on Post when saving. */
    ingestedRunId?: string | null
  ): Promise<{
    savedCount: number;
    discardedCount: number;
    newCount: number;
    updatedCount: number;
  }> {
    let savedCount = 0;
    let discardedCount = 0;
    let newCount = 0;
    let updatedCount = 0;
    /** Trimmed upstream source name; whitespace-only must not enable "downstream consumer" paths. */
    const urlInputTrimmed = (urlInputSourceScraper ?? "").trim();

    // Fetch project-specific engagement thresholds
    let projectThresholds: {
      linkedin?: number | null;
      facebook?: number | null;
      twitter?: number | null;
    } = {};

    if (projectId && saveToDb) {
      try {
        const project = await prisma.project.findUnique({
          where: { id: projectId, deleted_at: null },
          select: {
            linkedin_engagement_threshold: true,
            facebook_engagement_threshold: true,
            twitter_engagement_threshold: true,
          },
        });

        if (project) {
          projectThresholds = {
            linkedin: project.linkedin_engagement_threshold,
            facebook: project.facebook_engagement_threshold,
            twitter: project.twitter_engagement_threshold,
          };
          console.log(
            `[Engagement Thresholds] Loaded from database for project ${projectId}: ` +
              `LinkedIn=${projectThresholds.linkedin ?? "null (default: 0)"}, ` +
              `Facebook=${projectThresholds.facebook ?? "null (default: 0)"}, ` +
              `Twitter=${projectThresholds.twitter ?? "null (default: 0)"}`
          );
        }
      } catch (error) {
        console.error("Error fetching project thresholds:", error);
        // Continue with default thresholds if fetch fails
      }
    } else {
      console.log(
        `[Engagement Thresholds] No projectId or saveToDb=false, using defaults: LinkedIn=0, Facebook=0, Twitter=0`
      );
    }

    // Track thresholds used for summary logging
    let linkedinThresholdUsed: number | null = null;
    let linkedinIsNoCookiesScraper = false;
    let facebookThresholdUsed: number | null = null;
    let twitterThresholdUsed: number | null = null;

    // Project context for relevance filter (lazy-loaded when first needed for DownstreamPost path)
    let projectContextForRelevance: string | null = null;

    // YouTube filter counters (for end-of-run summary)
    let youtubeFilteredNoTranscript = 0;
    let youtubeFilteredOldestPostDate = 0;
    let youtubeFilteredRelevance = 0;
    const YOUTUBE_DISCARD_LOG_CAP = 3; // Log first N per reason, then rely on end summary
    let youtubeLoggedOldest = 0;
    let youtubeLoggedRelevance = 0;
    let youtubeLoggedNoTranscript = 0;
    let youtubeSkipValidationLogged = false;
    let youtubeOrchestrationUpstreamSkipLogged = false;

    // Special handling for Facebook comments scraper format
    // Check if all items are Facebook comments (have postTitle, text, likesCount, facebookUrl)
    const isFacebookCommentsFormat =
      items.length > 0 &&
      items.every(
        (item) =>
          item.postTitle !== undefined &&
          item.text !== undefined &&
          item.likesCount !== undefined &&
          item.facebookUrl !== undefined &&
          !item.postId &&
          !item.postText
      );

    // DEBUG: Log Facebook Comments format detection for debugging
    if (platform?.toLowerCase() === "facebook" && items.length > 0) {
      const sampleItem = items[0];
      console.log(`[Facebook Comments] Format detection check:`);
      console.log(`  - Items count: ${items.length}`);
      console.log(`  - Sample item keys: ${Object.keys(sampleItem).slice(0, 15).join(", ")}`);
      console.log(`  - has postTitle: ${sampleItem.postTitle !== undefined}`);
      console.log(`  - has text: ${sampleItem.text !== undefined}`);
      console.log(`  - has likesCount: ${sampleItem.likesCount !== undefined}`);
      console.log(`  - has facebookUrl: ${sampleItem.facebookUrl !== undefined}`);
      console.log(
        `  - has postId: ${sampleItem.postId !== undefined} (value: ${sampleItem.postId || "undefined"})`
      );
      console.log(
        `  - has postText: ${sampleItem.postText !== undefined} (value: ${sampleItem.postText || "undefined"})`
      );
      console.log(`  - Detection result: isFacebookCommentsFormat = ${isFacebookCommentsFormat}`);
    }

    // If this is Facebook comments format, process as a batch to establish hierarchy
    if (isFacebookCommentsFormat && platform?.toLowerCase() === "facebook") {
      console.log(
        `Detected Facebook comments format - processing ${items.length} comments with hierarchy detection`
      );
      const { rootPost, comments: transformedComments } = transformFacebookComments(items);

      // Store the root post's postId to link comments to it
      let savedRootPostId: string | null = null;

      // First, process the root post if it exists
      if (rootPost) {
        try {
          const finalPlatform = rootPost.platform || platform || "facebook";

          // Sanitize root post id/url for Prisma (avoid "unexpected end of hex escape")
          const safeRootPostId =
            sanitizeStringForPrisma(rootPost.postId) ??
            (String(rootPost.postId || "").replace(/\\/g, "") || null);
          if (!safeRootPostId) {
            console.warn("[Facebook] Skipping root post: postId empty after sanitization");
          } else {
            rootPost.postId = safeRootPostId;
          }
          if (rootPost.url != null && typeof rootPost.url === "string") {
            rootPost.url = sanitizeStringForPrisma(rootPost.url) ?? rootPost.url.replace(/\\/g, "");
          }

          if (!safeRootPostId) {
            // Skip root post save; comments may still be processed but won't link to a root
          } else {
            // Defensive check: if content is empty, try to get it from extraJson
            let rootPostContent = rootPost.content;
            if (!rootPostContent || rootPostContent.trim() === "") {
              const extraJson = rootPost.extraJson || {};
              rootPostContent = (
                extraJson.text ||
                extraJson.commentText ||
                extraJson.content ||
                extraJson.message ||
                extraJson.postTitle ||
                ""
              ).trim();
            }

            const detectedLanguage = detectLanguage(rootPostContent || "");
            const normalizedProjectId =
              typeof projectId === "string" && projectId.trim() !== "" ? projectId : null;

            const rootPostData = {
              platform: finalPlatform,
              postId: rootPost.postId,
              authorId: rootPost.authorId ? String(rootPost.authorId) : null,
              authorName: rootPost.authorName,
              content: rootPostContent || null, // Use null instead of empty string for Prisma
              createdAt: new Date(rootPost.createdAt),
              editedAt: rootPost.editedAt ? new Date(rootPost.editedAt) : null,
              url: rootPost.url,
              channelId: rootPost.channelId,
              threadRefId: rootPost.threadRefId || null, // Root post has no parent
              media: rootPost.media,
              metricsLikes: rootPost.metricsLikes || 0,
              metricsComments: rootPost.metricsComments || 0,
              metricsShares: rootPost.metricsShares || 0,
              extraJson: rootPost.extraJson,
              isTest: isTest,
              language: detectedLanguage,
              project_id: normalizedProjectId,
              job_id: jobId || null,
              ...(ingestedRunId != null ? { ingested_run_id: ingestedRunId } : {}),
            };

            if (saveToDb) {
              // Check if root post already exists
              const existingRootPost = await prisma.post.findUnique({
                where: {
                  project_id_platform_postId: {
                    project_id: projectId,
                    platform: finalPlatform,
                    postId: rootPost.postId,
                  },
                },
                select: { id: true, postId: true },
              });

              // Save root post to Post table
              const savedRootPost = await prisma.post.upsert({
                where: {
                  project_id_platform_postId: {
                    project_id: projectId,
                    platform: finalPlatform,
                    postId: rootPost.postId,
                  },
                },
                create: rootPostData,
                update: {
                  ...postUpsertUpdateWithoutIngestedRunId(rootPostData),
                  job_id: jobId,
                },
              });

              // Store the actual saved root post's postId for linking comments
              savedRootPostId = savedRootPost.postId;
              console.log(`[Facebook] Saved root post with postId: ${savedRootPostId}`);

              if (existingRootPost) {
                updatedCount++;
              } else {
                newCount++;
              }
            } else {
              // For downstream posts, save root post as well
              if (scraperName && normalizedProjectId) {
                const existingDownstreamPost = await prisma.downstreamPost.findFirst({
                  where: {
                    platform: finalPlatform,
                    postId: rootPost.postId,
                    project_id: normalizedProjectId,
                    origScraper: scraperName,
                  },
                });

                const downstreamRootPostData: any = {
                  ...rootPostData,
                  origScraper: scraperName,
                  authorProfileUrl: rootPost.authorProfileUrl,
                  authorHeadline: rootPost.authorHeadline,
                  authorImageUrl: rootPost.authorImageUrl,
                  search_query: rootPost.searchQuery ?? null,
                  expires_at: new Date(Date.now() + DOWNSTREAM_RETENTION_MS),
                  orchestration_execution_id: orchestrationExecutionId ?? null,
                };

                if (existingDownstreamPost) {
                  await prisma.downstreamPost.update({
                    where: { id: existingDownstreamPost.id },
                    data: downstreamRootPostData,
                  });
                  updatedCount++;
                } else {
                  await prisma.downstreamPost.create({
                    data: downstreamRootPostData,
                  });
                  newCount++;
                }

                // Also upsert into main Post table
                const savedRootPost = await prisma.post.upsert({
                  where: {
                    project_id_platform_postId: {
                      project_id: normalizedProjectId,
                      platform: finalPlatform,
                      postId: rootPost.postId,
                    },
                  },
                  create: rootPostData,
                  update: {
                    ...postUpsertUpdateWithoutIngestedRunId(rootPostData),
                    job_id: jobId,
                  },
                });

                // Store the actual saved root post's postId for linking comments
                savedRootPostId = savedRootPost.postId;
                console.log(
                  `[Facebook] Saved root post (downstream) with postId: ${savedRootPostId}`
                );
              } else {
                // Even if not saving to DB, store the postId for linking
                savedRootPostId = rootPost.postId;
              }
            }

            savedCount++;
            console.log(
              `[Facebook] Saved root post postId=${rootPost.postId} with ${transformedComments.length} comments`
            );
          }
        } catch (error) {
          console.error("Error saving Facebook root post:", error);
          discardedCount++;
        }
      }

      // Process each transformed comment with full processing logic
      for (let i = 0; i < transformedComments.length; i++) {
        const transformedData = transformedComments[i];
        const item = items[i];

        try {
          // CRITICAL: Ensure createdAt is always set (defensive check)
          // Some transformation paths might miss this, especially for Facebook comments
          if (
            !transformedData.createdAt ||
            typeof transformedData.createdAt !== "string" ||
            transformedData.createdAt.trim() === ""
          ) {
            transformedData.createdAt = new Date().toISOString();
            // Note: Not logging - this is expected for Facebook comments which don't have timestamps
          }

          // Normalize/derive postId BEFORE validation
          if (!transformedData.postId || String(transformedData.postId).trim() === "") {
            const derived = this.derivePostIdFromItem(item, transformedData, platform);
            if (derived) {
              transformedData.postId = derived;
            }
          }

          // Use provided platform or fall back to transformed data platform
          const finalPlatform = platform || transformedData.platform;

          // Validate transformed data
          const validation = validatePostData(transformedData);
          if (!validation.valid) {
            console.warn("Skipping invalid Facebook comment data:", validation.errors);
            discardedCount++;
            continue;
          }

          // Detect language from content
          const detectedLanguage = detectLanguage(transformedData.content);

          const normalizedProjectId =
            typeof projectId === "string" && projectId.trim() !== "" ? projectId : null;

          // CRITICAL: Ensure createdAt is valid before using it
          const validCreatedAt =
            transformedData.createdAt &&
            typeof transformedData.createdAt === "string" &&
            transformedData.createdAt.trim() !== ""
              ? transformedData.createdAt
              : new Date().toISOString();

          // Defensive check: if content is empty, try to get it from extraJson
          let finalContent = transformedData.content;
          if (!finalContent || finalContent.trim() === "") {
            const extraJson = transformedData.extraJson || {};
            finalContent = (
              extraJson.text ||
              extraJson.commentText ||
              extraJson.content ||
              extraJson.message ||
              ""
            ).trim();
          }

          // CRITICAL: If this is a top-level comment (not a reply to another comment) and we have a saved root post,
          // link it to the root post. Otherwise, use the threadRefId from transformation (for nested replies).
          let finalThreadRefId = transformedData.threadRefId;
          if (savedRootPostId) {
            // Check if this comment should be linked to the root post
            // It should be linked if:
            // 1. It has no threadRefId (top-level comment), OR
            // 2. Its threadRefId matches the original root post's postId (before saving)
            const shouldLinkToRoot =
              !finalThreadRefId || (rootPost && finalThreadRefId === rootPost.postId);

            if (shouldLinkToRoot) {
              // This is a top-level comment - link it to the saved root post
              finalThreadRefId = savedRootPostId;
              // No logging to avoid spam
            }
            // If it has a different threadRefId, it's a nested reply - keep the original threadRefId
          } else if (
            finalThreadRefId &&
            finalPlatform?.toLowerCase() === "facebook" &&
            normalizedProjectId
          ) {
            // When processing Facebook comments individually (not in batch), ensure the root post exists
            // Check if a post exists with the threadRefId (root post ID)
            const rootPostExists = await prisma.post.findUnique({
              where: {
                project_id_platform_postId: {
                  project_id: normalizedProjectId,
                  platform: finalPlatform,
                  postId: finalThreadRefId,
                },
              },
              select: { id: true },
            });

            // If root post doesn't exist, create it from the comment's postTitle and facebookUrl
            if (!rootPostExists && transformedData.extraJson) {
              const postTitle = transformedData.extraJson.postTitle || "";
              const facebookUrl =
                transformedData.url || transformedData.extraJson.facebookUrl || "";

              if (postTitle && facebookUrl) {
                try {
                  const rootPostData = {
                    platform: finalPlatform,
                    postId: finalThreadRefId,
                    authorId: null,
                    authorName: null,
                    content: postTitle.substring(0, 5000), // Use postTitle as content
                    createdAt: new Date(validCreatedAt), // Use comment's date as fallback
                    editedAt: null,
                    url: facebookUrl,
                    channelId: transformedData.channelId || null,
                    threadRefId: null, // Root post has no threadRefId
                    media: Prisma.JsonNull,
                    metricsLikes: 0,
                    metricsComments: 0,
                    metricsShares: 0,
                    extraJson: {
                      postTitle: postTitle,
                      facebookUrl: facebookUrl,
                      isRootPost: true,
                    },
                    isTest: isTest,
                    language: detectedLanguage,
                    project_id: normalizedProjectId,
                    job_id: jobId || null,
                    ...(ingestedRunId != null ? { ingested_run_id: ingestedRunId } : {}),
                  };

                  await prisma.post.upsert({
                    where: {
                      project_id_platform_postId: {
                        project_id: normalizedProjectId,
                        platform: finalPlatform,
                        postId: finalThreadRefId,
                      },
                    },
                    create: rootPostData,
                    update: {
                      ...postUpsertUpdateWithoutIngestedRunId(rootPostData),
                      job_id: jobId, // Update job_id if post exists
                    },
                  });

                  // Root post created successfully - no logging to avoid spam
                } catch {
                  // Silently continue - root post creation failure is not critical
                  // Continue processing comment even if root post creation fails
                }
              }
            }
          }

          const basePostData = {
            platform: finalPlatform,
            postId: transformedData.postId,
            authorId: transformedData.authorId ? String(transformedData.authorId) : null,
            authorName: transformedData.authorName,
            content: finalContent || null, // Use null instead of empty string for Prisma
            createdAt: new Date(validCreatedAt),
            editedAt: transformedData.editedAt ? new Date(transformedData.editedAt) : null,
            url: transformedData.url,
            channelId: transformedData.channelId,
            threadRefId: finalThreadRefId || null,
            media: transformedData.media,
            metricsLikes: transformedData.metricsLikes,
            metricsComments: transformedData.metricsComments,
            metricsShares: transformedData.metricsShares,
            extraJson: transformedData.extraJson,
            isTest: isTest,
            language: detectedLanguage,
            project_id: normalizedProjectId,
            job_id: jobId || null,
            ...(ingestedRunId != null ? { ingested_run_id: ingestedRunId } : {}),
          };

          const authorProfileUrl =
            transformedData.authorProfileUrl ??
            transformedData.extraJson?.authorProfileUrl ??
            transformedData.extraJson?.author?.profile_url ??
            null;
          const authorHeadline =
            transformedData.authorHeadline ??
            transformedData.extraJson?.authorHeadline ??
            transformedData.extraJson?.author?.headline ??
            null;
          const authorImageUrl =
            transformedData.authorImageUrl ??
            transformedData.extraJson?.authorImageUrl ??
            transformedData.extraJson?.author?.image_url ??
            null;
          const searchQuery =
            transformedData.searchQuery ??
            transformedData.extraJson?.searchInput ??
            transformedData.extraJson?.search_input ??
            null;

          const rawStats = (item as Record<string, unknown>)?.stats as
            | Record<string, unknown>
            | undefined;
          let likes = Number(transformedData.metricsLikes ?? 0);
          let comments = Number(transformedData.metricsComments ?? 0);
          let shares = Number(transformedData.metricsShares ?? 0);

          if (rawStats) {
            const rawLikesCandidate = Number(
              rawStats.total_reactions ??
                rawStats.totalLikes ??
                rawStats.likes ??
                rawStats.reactions ??
                0
            );
            if (Number.isFinite(rawLikesCandidate) && rawLikesCandidate > likes) {
              likes = rawLikesCandidate;
            }

            const rawCommentsCandidate = Number(
              rawStats.comments ?? rawStats.totalComments ?? rawStats.comment ?? 0
            );
            if (Number.isFinite(rawCommentsCandidate) && rawCommentsCandidate > comments) {
              comments = rawCommentsCandidate;
            }

            const rawSharesCandidate = Number(
              rawStats.shares ?? rawStats.totalShares ?? rawStats.share ?? 0
            );
            if (Number.isFinite(rawSharesCandidate) && rawSharesCandidate > shares) {
              shares = rawSharesCandidate;
            }
          }

          if (!Number.isFinite(likes)) likes = 0;
          if (!Number.isFinite(comments)) comments = 0;
          if (!Number.isFinite(shares)) shares = 0;

          if (saveToDb) {
            // Check if post already exists before upsert
            const existingPost = await prisma.post.findUnique({
              where: {
                project_id_platform_postId: {
                  project_id: projectId,
                  platform: finalPlatform,
                  postId: transformedData.postId,
                },
              },
              select: { id: true },
            });

            // Save to regular Post table using atomic upsert keyed by (project_id, platform, postId)
            await prisma.post.upsert({
              where: {
                project_id_platform_postId: {
                  project_id: projectId,
                  platform: finalPlatform,
                  postId: transformedData.postId,
                },
              },
              create: basePostData,
              update: {
                ...postUpsertUpdateWithoutIngestedRunId(basePostData),
                job_id: jobId, // Ensure job_id is always updated, even if post exists
              },
            });

            // Track whether this was a new record or update
            if (existingPost) {
              updatedCount++;
            } else {
              newCount++;
            }
          } else {
            // For Facebook comments, we don't apply the same filtering as posts
            // Comments are replies to posts, so they should all be saved to DownstreamPost
            // (No 48-hour or engagement filtering for comments)

            // Save to DownstreamPost table with origScraper field
            if (!scraperName) {
              console.warn("No scraper name provided for downstream post, skipping");
              discardedCount++;
              continue;
            }

            const existingDownstreamPost = await prisma.downstreamPost.findFirst({
              where: {
                platform: finalPlatform,
                postId: transformedData.postId,
                project_id: normalizedProjectId,
                origScraper: scraperName,
              },
            });

            const downstreamPostData: any = {
              ...basePostData,
              origScraper: scraperName,
              authorProfileUrl,
              authorHeadline,
              authorImageUrl,
              search_query: searchQuery ?? null,
              metricsLikes: likes,
              metricsComments: comments,
              metricsShares: shares,
              orchestration_execution_id: orchestrationExecutionId ?? null,
            };

            if (existingDownstreamPost) {
              await prisma.downstreamPost.update({
                where: { id: existingDownstreamPost.id },
                data: downstreamPostData,
              });
              console.log(
                `[DownstreamPost] Updated existing Facebook comment postId=${
                  transformedData.postId
                } (${finalPlatform})`
              );
            } else {
              await prisma.downstreamPost.create({
                data: downstreamPostData,
              });
              console.log(
                `[DownstreamPost] Created Facebook comment postId=${transformedData.postId} (${finalPlatform})`
              );
            }

            // Also upsert into main Post table so root posts are available for downstream analyses
            if (normalizedProjectId) {
              try {
                const postWhereUnique = {
                  project_id_platform_postId: {
                    project_id: normalizedProjectId,
                    platform: finalPlatform,
                    postId: transformedData.postId,
                  },
                };

                await prisma.post.upsert({
                  where: postWhereUnique,
                  create: basePostData,
                  update: {
                    ...postUpsertUpdateWithoutIngestedRunId(basePostData),
                    job_id: jobId,
                  },
                });
              } catch (error) {
                console.error(
                  `[DownstreamPost] Failed to upsert root post ${transformedData.postId} into Post table:`,
                  error
                );
              }
            } else {
              console.warn(
                `[DownstreamPost] Missing project ID for root post ${transformedData.postId}, skipping Post table upsert`
              );
            }
          }

          savedCount++;
        } catch (error) {
          console.error("Error saving Facebook comment:", error);
          discardedCount++;
          // Continue processing other items
        }
      }

      // Return early since we processed all Facebook comments
      return {
        savedCount,
        discardedCount,
        newCount,
        updatedCount,
      };
    }

    // Special handling for LinkedIn comments scraper format
    // CRITICAL: LinkedIn Comments Scraper returns FLAT comment objects (not root posts with comments array)
    // Each item has: comment_id, text, post_input, author, stats, etc.
    // We need to detect this format and group comments by post_input to create root posts
    const isLinkedInCommentsScraper = scraperName?.toLowerCase().includes("comment");

    console.log(`[processAndSavePosts] LinkedIn Comments Detection Check:`);
    console.log(`  - Scraper name: "${scraperName}"`);
    console.log(`  - isLinkedInCommentsScraper: ${isLinkedInCommentsScraper}`);
    console.log(`  - Platform: ${platform}`);
    console.log(`  - Items count: ${items.length}`);

    if (isLinkedInCommentsScraper && items.length > 0) {
      // Check first few items to see their structure
      const sampleItems = items.slice(0, 3);
      sampleItems.forEach((item, idx) => {
        console.log(`  - Item ${idx + 1} structure:`);
        console.log(`    - has comment_id: ${item.comment_id !== undefined}`);
        console.log(
          `    - has post_input: ${item.post_input !== undefined} (value: ${item.post_input?.substring(0, 50) || "N/A"})`
        );
        console.log(`    - has shareUrn: ${item.shareUrn !== undefined}`);
        console.log(`    - has comments array: ${Array.isArray(item.comments)}`);
        console.log(`    - Top-level keys: ${Object.keys(item).slice(0, 10).join(", ")}`);
      });
    }

    // Detect LinkedIn Comments Scraper format: items have comment_id and post_input (flat comment objects)
    const isLinkedInCommentsFormat =
      isLinkedInCommentsScraper &&
      items.length > 0 &&
      items.some((item) => item.comment_id !== undefined && item.post_input !== undefined);

    console.log(
      `  - Final detection result: isLinkedInCommentsFormat = ${isLinkedInCommentsFormat}`
    );
    console.log(
      `  - Platform check: platform=${platform}, lowercase=${platform?.toLowerCase()}, match=${platform?.toLowerCase() === "linkedin"}`
    );

    // If this is LinkedIn comments format, process flat comment objects
    // CRITICAL: Comments scraper returns individual comments, not root posts with comments arrays
    // We need to group by post_input and create root posts
    if (isLinkedInCommentsFormat && platform?.toLowerCase() === "linkedin") {
      console.log(
        `[LinkedIn Comments] ✅ DETECTION TRIGGERED - Processing ${items.length} flat comment objects`
      );
      console.log(
        `[LinkedIn Comments] Comments will be grouped by post_input to create root posts`
      );

      // Group comments by post_input (URL)
      const commentsByPost = new Map<string, any[]>();
      for (const item of items) {
        const postInput = item.post_input;
        if (!postInput) {
          console.warn(
            `[LinkedIn Comments] Skipping comment without post_input: ${item.comment_id || "unknown"}`
          );
          discardedCount++;
          continue;
        }
        if (!commentsByPost.has(postInput)) {
          commentsByPost.set(postInput, []);
        }
        commentsByPost.get(postInput)!.push(item);
      }

      console.log(
        `[LinkedIn Comments] Grouped ${items.length} comments into ${commentsByPost.size} unique posts`
      );

      // Process each post group
      for (const [postInputUrl, comments] of commentsByPost.entries()) {
        try {
          console.log(
            `[LinkedIn Comments] Processing post: ${postInputUrl.substring(0, 60)}... (${comments.length} comments)`
          );

          // Try to find root post data from DownstreamPost
          // Extract postId from URL or use URL as identifier
          let rootPostId: string | null = null;
          let rootPostData: any = null;

          // Extract post ID from post_input
          // post_input can be either:
          // 1. URL format: "https://www.linkedin.com/posts/...-activity-7396146780297449472-..."
          // 2. Numeric ID format: "7302346926123798528"
          let extractedPostId: string | null = null;
          let urnType: "activity" | "ugcPost" = "activity";

          // Check if post_input is a numeric ID (just digits)
          if (/^\d+$/.test(postInputUrl)) {
            // It's a numeric ID - use it directly
            extractedPostId = postInputUrl;
            // Default to activity URN for numeric IDs (can't determine type from ID alone)
            urnType = "activity";
          } else {
            // It's a URL - extract ID from URL pattern
            // URL formats:
            // - https://www.linkedin.com/posts/...-activity-7396146780297449472-...
            // - https://www.linkedin.com/posts/...-ugcPost-7396623570052993024-...
            const urlMatch = postInputUrl.match(/(?:activity|ugcPost)-(\d+)/);
            if (urlMatch && urlMatch[1]) {
              extractedPostId = urlMatch[1];
              // Determine URN type from URL
              urnType = postInputUrl.includes("-ugcPost-") ? "ugcPost" : "activity";
            }
          }

          // Create rootPostId from extracted ID
          if (extractedPostId) {
            rootPostId = `urn:li:${urnType}:${extractedPostId}`;
          } else {
            // Fallback: use URL as postId (shouldn't happen, but be safe)
            console.warn(
              `[LinkedIn Comments] Could not extract post ID from post_input: ${postInputUrl.substring(0, 80)}`
            );
            rootPostId = postInputUrl;
          }

          console.log(
            `[LinkedIn Comments] Extracted rootPostId: ${rootPostId} from URL: ${postInputUrl.substring(0, 60)}...`
          );

          // Normalize URL for matching (remove query parameters)
          const normalizedUrl = postInputUrl.split("?")[0];

          // Look up root post in DownstreamPost
          // Try multiple matching strategies:
          // 1. Exact URL match (with query params)
          // 2. Normalized URL match (without query params)
          // 3. PostId match (URN format)
          // 4. PostId match (numeric ID only)
          const normalizedProjectId =
            typeof projectId === "string" && projectId.trim() !== "" ? projectId : null;
          const numericPostId = rootPostId?.replace(/^urn:li:(?:activity|ugcPost):/, "");

          const downstreamPost = await prisma.downstreamPost.findFirst({
            where: {
              project_id: normalizedProjectId ?? undefined,
              OR: [
                { url: postInputUrl }, // Exact match
                { url: normalizedUrl }, // Normalized match (no query params)
                { url: { startsWith: normalizedUrl } }, // Starts with match
                { postId: rootPostId }, // URN format match
                ...(numericPostId ? [{ postId: numericPostId }] : []), // Numeric ID match
              ],
            },
            orderBy: { createdAt: "desc" },
          });

          if (downstreamPost) {
            console.log(
              `[LinkedIn Comments] ✅ Found root post in DownstreamPost: postId=${downstreamPost.postId}, url=${downstreamPost.url?.substring(0, 60)}...`
            );
            // Create root post from DownstreamPost data
            rootPostData = {
              platform: "linkedin",
              postId: rootPostId,
              authorId: downstreamPost.authorId,
              authorName: downstreamPost.authorName,
              content: downstreamPost.content,
              createdAt: downstreamPost.createdAt.toISOString(),
              url: downstreamPost.url || postInputUrl,
              threadRefId: null,
              metricsLikes: downstreamPost.metricsLikes || 0,
              metricsComments: downstreamPost.metricsComments || 0,
              metricsShares: downstreamPost.metricsShares || 0,
            };
          } else {
            // Create minimal root post from URL
            console.log(
              `[LinkedIn Comments] ⚠️  No DownstreamPost found for postInputUrl: ${postInputUrl.substring(0, 80)}...`
            );
            console.log(
              `[LinkedIn Comments] Looked for: rootPostId=${rootPostId}, normalizedUrl=${normalizedUrl.substring(0, 60)}...`
            );
            console.log(`[LinkedIn Comments] Creating minimal root post from URL`);
            rootPostData = {
              platform: "linkedin",
              postId: rootPostId,
              authorId: null,
              authorName: null,
              content: null, // Will be populated if we can extract from comments
              createdAt: new Date().toISOString(),
              url: postInputUrl,
              threadRefId: null,
              metricsLikes: 0,
              metricsComments: comments.length,
              metricsShares: 0,
            };
          }

          // Transform comments
          const transformedComments: any[] = [];
          for (const comment of comments) {
            const transformed = transformGenericPost(comment, "linkedin");
            // Override threadRefId to link to root post
            transformed.threadRefId = rootPostId;
            transformedComments.push(transformed);
          }

          console.log(
            `[LinkedIn Comments] Root post data prepared, Comments count: ${transformedComments.length}`
          );

          // Store the root post's postId to link comments to it
          let savedRootPostId: string | null = null;

          // Save root post
          if (rootPostData) {
            try {
              const finalPlatform = rootPostData.platform || platform || "linkedin";

              const detectedLanguage = detectLanguage(rootPostData.content || "");
              const normalizedProjectId =
                typeof projectId === "string" && projectId.trim() !== "" ? projectId : null;

              const rootPostDbData = {
                platform: finalPlatform,
                postId: rootPostData.postId,
                authorId: rootPostData.authorId ? String(rootPostData.authorId) : null,
                authorName: rootPostData.authorName,
                content: rootPostData.content || null,
                createdAt: new Date(rootPostData.createdAt),
                editedAt: null,
                url: rootPostData.url,
                channelId: null,
                threadRefId: null,
                media: Prisma.JsonNull,
                metricsLikes: rootPostData.metricsLikes || 0,
                metricsComments: rootPostData.metricsComments || 0,
                metricsShares: rootPostData.metricsShares || 0,
                extraJson: { source: "downstream_post", originalUrl: postInputUrl } as any,
                isTest: isTest,
                language: detectedLanguage,
                project_id: normalizedProjectId,
                job_id: jobId || null,
                ...(ingestedRunId != null ? { ingested_run_id: ingestedRunId } : {}),
              };

              if (saveToDb) {
                // Check if root post already exists
                const existingRootPost = await prisma.post.findUnique({
                  where: {
                    project_id_platform_postId: {
                      project_id: projectId,
                      platform: finalPlatform,
                      postId: rootPostData.postId,
                    },
                  },
                  select: { id: true },
                });

                await prisma.post.upsert({
                  where: {
                    project_id_platform_postId: {
                      project_id: projectId,
                      platform: finalPlatform,
                      postId: rootPostData.postId,
                    },
                  },
                  create: rootPostDbData,
                  update: {
                    ...postUpsertUpdateWithoutIngestedRunId(rootPostDbData),
                    job_id: jobId || null,
                  },
                });

                if (existingRootPost) {
                  updatedCount++;
                } else {
                  newCount++;
                }

                savedRootPostId = rootPostData.postId;
                console.log(
                  `[LinkedIn Comments] ✅ Saved root post: ${rootPostData.postId} (${finalPlatform}), postId length: ${rootPostData.postId?.length || 0}`
                );
              } else {
                console.log(`[LinkedIn Comments] ⚠️  saveToDb=false, skipping root post save`);
              }
            } catch (error) {
              console.error(
                `[LinkedIn Comments] ❌ ERROR saving root post (postId: ${rootPostData.postId}):`,
                error
              );
              console.error(
                `[LinkedIn Comments] Root post data:`,
                JSON.stringify({
                  postId: rootPostData.postId,
                  platform: rootPostData.platform,
                  hasContent: !!rootPostData.content,
                  createdAt: rootPostData.createdAt,
                })
              );
              // Don't continue processing comments if root post failed to save
              discardedCount++;
              continue;
            }
          }

          // Then process all comments, linking them to the root post
          for (const transformedData of transformedComments) {
            try {
              // CRITICAL: Ensure createdAt is always set
              if (
                !transformedData.createdAt ||
                typeof transformedData.createdAt !== "string" ||
                transformedData.createdAt.trim() === ""
              ) {
                transformedData.createdAt = new Date().toISOString();
              }

              // CRITICAL: Always override threadRefId to use root post's shareUrn (not URL)
              // The root post uses shareUrn as postId, so comments must link via shareUrn
              // transformLinkedInPost might set threadRefId to a URL, but we need shareUrn
              if (savedRootPostId) {
                transformedData.threadRefId = savedRootPostId;
              }

              const finalPlatform = transformedData.platform || platform || "linkedin";

              // Defensive check: if content is empty, try to get it from extraJson
              let commentContent = transformedData.content;
              if (!commentContent || commentContent.trim() === "") {
                const extraJson = transformedData.extraJson || {};
                commentContent = (
                  extraJson.text ||
                  extraJson.commentText ||
                  extraJson.content ||
                  extraJson.message ||
                  ""
                ).trim();
              }

              const detectedLanguage = detectLanguage(commentContent || "");
              const normalizedProjectId =
                typeof projectId === "string" && projectId.trim() !== "" ? projectId : null;

              const basePostData = {
                platform: finalPlatform,
                postId: transformedData.postId,
                authorId: transformedData.authorId ? String(transformedData.authorId) : null,
                authorName: transformedData.authorName,
                content: commentContent || null,
                createdAt: new Date(transformedData.createdAt),
                editedAt: transformedData.editedAt ? new Date(transformedData.editedAt) : null,
                url: transformedData.url,
                channelId: transformedData.channelId,
                threadRefId: transformedData.threadRefId || null,
                media: transformedData.media,
                metricsLikes: transformedData.metricsLikes || 0,
                metricsComments: transformedData.metricsComments || 0,
                metricsShares: transformedData.metricsShares || 0,
                extraJson: transformedData.extraJson,
                isTest: isTest,
                language: detectedLanguage,
                project_id: normalizedProjectId,
                job_id: jobId || null,
                ...(ingestedRunId != null ? { ingested_run_id: ingestedRunId } : {}),
              };

              // Validate before saving
              const validation = validatePostData(transformedData);
              if (!validation.valid) {
                console.warn(
                  `Skipping invalid LinkedIn comment data: ${JSON.stringify(validation.errors)}`
                );
                discardedCount++;
                continue;
              }

              if (saveToDb) {
                const existingPost = await prisma.post.findUnique({
                  where: {
                    project_id_platform_postId: {
                      project_id: projectId,
                      platform: finalPlatform,
                      postId: transformedData.postId,
                    },
                  },
                  select: { id: true },
                });

                await prisma.post.upsert({
                  where: {
                    project_id_platform_postId: {
                      project_id: projectId,
                      platform: finalPlatform,
                      postId: transformedData.postId,
                    },
                  },
                  create: basePostData,
                  update: {
                    ...postUpsertUpdateWithoutIngestedRunId(basePostData),
                    job_id: jobId || null,
                  },
                });

                if (existingPost) {
                  updatedCount++;
                } else {
                  newCount++;
                }
              }

              savedCount++;
            } catch (error) {
              console.error("Error saving LinkedIn comment:", error);
              discardedCount++;
            }
          }
        } catch (error) {
          console.error("Error processing LinkedIn comments item:", error);
          discardedCount++;
        }
      }

      // Return early since we processed all LinkedIn comments
      console.log(
        `[LinkedIn Comments] ✅ COMPLETED - Saved: ${savedCount}, Discarded: ${discardedCount}, New: ${newCount}, Updated: ${updatedCount}`
      );
      return {
        savedCount,
        discardedCount,
        newCount,
        updatedCount,
      };
    } else {
      // Log why detection didn't trigger
      if (platform?.toLowerCase() === "linkedin" && isLinkedInCommentsScraper) {
        console.log(
          `[LinkedIn Comments] ⚠️  Detection failed - isLinkedInCommentsScraper=true, platform=linkedin, but format check failed`
        );
        if (items.length === 0) {
          console.log(`[LinkedIn Comments] Reason: No items in dataset`);
        } else {
          const firstItem = items[0];
          console.log(
            `[LinkedIn Comments] First item check: shareUrn=${firstItem.shareUrn !== undefined}, comments=${Array.isArray(firstItem.comments)}, commentsLength=${Array.isArray(firstItem.comments) ? firstItem.comments.length : "N/A"}`
          );
        }
      }
    }

    // Upstream orchestration seeds (save_to_db=false, not a downstream consumer): close out stale PENDING rows
    // from other executions so fetchUrlsFromDownstreamPosts only sees this run's tweets/videos.
    const upstreamSeedProjectId =
      typeof projectId === "string" && projectId.trim() !== "" ? projectId : null;
    if (
      !saveToDb &&
      orchestrationExecutionId &&
      scraperName &&
      !urlInputTrimmed &&
      upstreamSeedProjectId
    ) {
      try {
        const now = new Date();
        const superseded = await prisma.downstreamPost.updateMany({
          where: {
            project_id: upstreamSeedProjectId,
            origScraper: scraperName,
            status: "PENDING",
            OR: [
              { orchestration_execution_id: null },
              { orchestration_execution_id: { not: orchestrationExecutionId } },
            ],
          },
          data: { status: "PROCESSED", processed_at: now },
        });
        if (superseded.count > 0) {
          console.log(
            `[DownstreamPost] Superseded ${superseded.count} stale PENDING seed(s) for origScraper="${scraperName}" ` +
              `(project=${upstreamSeedProjectId}, execution=${orchestrationExecutionId})`
          );
        }
      } catch (e) {
        console.error("[DownstreamPost] Failed to supersede stale upstream seeds:", e);
      }
    }

    for (const item of items) {
      try {
        // Skip Facebook scraper error responses (url, error, errorDescription) - they are not posts/comments
        if (platform?.toLowerCase() === "facebook") {
          const hasError = item.error !== undefined || item.errorDescription !== undefined;
          const hasPostContent =
            item.postTitle !== undefined ||
            item.text !== undefined ||
            item.postId !== undefined ||
            item.postText !== undefined;
          if (hasError && !hasPostContent) {
            discardedCount++;
            continue;
          }
        }

        // Transform raw data to standardized format
        const transformedData = transformGenericPost(item, platform);

        // CRITICAL: Ensure createdAt is always set (defensive check)
        // Some transformation paths might miss this, especially for Facebook comments
        if (
          !transformedData.createdAt ||
          typeof transformedData.createdAt !== "string" ||
          transformedData.createdAt.trim() === ""
        ) {
          transformedData.createdAt = new Date().toISOString();
          // Note: Not logging - this is expected for Facebook comments which don't have timestamps
        }

        // Normalize/derive postId BEFORE validation
        if (!transformedData.postId || String(transformedData.postId).trim() === "") {
          const derived = this.derivePostIdFromItem(item, transformedData, platform);
          if (derived) {
            transformedData.postId = derived;
          }
        }

        // Sanitize postId and url for Prisma (avoid "unexpected end of hex escape" from backslashes)
        const rawPostId = transformedData.postId ? String(transformedData.postId).trim() : "";
        const sanitizedPostId =
          sanitizeStringForPrisma(rawPostId) ?? (rawPostId.replace(/\\/g, "") || null);
        if (!sanitizedPostId) {
          console.warn("Skipping post data: postId empty after sanitization");
          discardedCount++;
          continue;
        }
        transformedData.postId = sanitizedPostId;
        if (transformedData.url != null && typeof transformedData.url === "string") {
          const sanitizedUrl =
            sanitizeStringForPrisma(transformedData.url) ?? transformedData.url.replace(/\\/g, "");
          transformedData.url = sanitizedUrl || transformedData.url;
        }
        if (
          transformedData.threadRefId != null &&
          typeof transformedData.threadRefId === "string"
        ) {
          const t =
            sanitizeStringForPrisma(transformedData.threadRefId) ??
            transformedData.threadRefId.replace(/\\/g, "");
          transformedData.threadRefId = t && t.trim() ? t.trim() : undefined;
        }

        // CRITICAL: Prefer transformed data platform (from data transformer) over provided platform parameter
        // The transformer knows the correct platform from the data structure itself
        // Only use provided platform if transformed data doesn't have one (shouldn't happen)
        const finalPlatform: string = transformedData.platform || platform || "unknown";

        // Log warning if there's a mismatch (indicates scraper config issue)
        if (
          platform &&
          transformedData.platform &&
          platform.toLowerCase() !== transformedData.platform.toLowerCase()
        ) {
          console.warn(
            `[processAndSavePosts] Platform mismatch: scraper says "${platform}", but data transformer detected "${transformedData.platform}". Using "${transformedData.platform}".`
          );
        }

        // YouTube comments = replies: must have threadRefId = video ID so they attach to the video root and reach chatter.
        const finalPlatformForYt = transformedData.platform || platform || "";
        if (
          finalPlatformForYt.toLowerCase() === "youtube" &&
          (transformedData.threadRefId == null || transformedData.threadRefId === "")
        ) {
          const raw = item as Record<string, unknown>;
          const urls = [
            raw.pageUrl, // Comments scraper uses pageUrl for video URL
            raw.url,
            raw.video_url,
            raw.comment_url,
            raw.videoUrl,
            raw.sourceUrl,
            typeof raw.video === "object" &&
            raw.video != null &&
            typeof (raw.video as Record<string, unknown>).url === "string"
              ? (raw.video as Record<string, unknown>).url
              : null,
          ].filter((u): u is string => typeof u === "string" && u.trim() !== "");
          const rawVideo =
            typeof raw.video === "object" && raw.video != null
              ? (raw.video as Record<string, unknown>)
              : null;
          const fromRaw =
            (typeof raw.videoId === "string" && raw.videoId.trim() ? raw.videoId.trim() : null) ??
            (typeof raw.video_id === "string" && raw.video_id.trim()
              ? raw.video_id.trim()
              : null) ??
            (rawVideo && typeof rawVideo.id === "string" && rawVideo.id.trim()
              ? rawVideo.id.trim()
              : null) ??
            (rawVideo && typeof rawVideo.videoId === "string" && rawVideo.videoId.trim()
              ? rawVideo.videoId.trim()
              : null) ??
            urls.reduce<string | null>((acc, u) => acc ?? extractYouTubeVideoIdFromUrl(u), null);
          if (fromRaw) {
            const t = sanitizeStringForPrisma(fromRaw) ?? fromRaw.replace(/\\/g, "");
            transformedData.threadRefId = t && t.trim() ? t.trim() : undefined;
          } else if (
            sourceVideoUrls &&
            sourceVideoUrls.length === 1 &&
            typeof sourceVideoUrls[0] === "string" &&
            sourceVideoUrls[0].trim() !== ""
          ) {
            // Single-video run: every comment in this job belongs to that video (e.g. one run per video).
            const videoIdFromJob = extractYouTubeVideoIdFromUrl(sourceVideoUrls[0].trim());
            if (videoIdFromJob) {
              const t =
                sanitizeStringForPrisma(videoIdFromJob) ?? videoIdFromJob.replace(/\\/g, "");
              transformedData.threadRefId = t && t.trim() ? t.trim() : undefined;
            }
          }
          // Only warn for comments/replies that are missing threadRefId (videos are roots, so they don't need threadRefId)
          const rawType = typeof raw.type === "string" ? raw.type.toLowerCase() : "";
          const isCommentOrReply =
            rawType === "comment" ||
            rawType === "reply" ||
            raw.comment_id != null ||
            raw.comment_text != null ||
            raw.comment != null ||
            raw.reply_id != null ||
            raw.reply_text != null ||
            raw.parent_comment_id != null;
          if (
            finalPlatformForYt.toLowerCase() === "youtube" &&
            isCommentOrReply &&
            (transformedData.threadRefId == null || transformedData.threadRefId === "")
          ) {
            console.warn(
              `[YouTube Comments] Missing video ID for comment postId=${transformedData.postId}; raw keys: ${Object.keys(raw).join(", ")}. Comment will not attach to a video (no thread_ref_id).`
            );
          }
        }

        // Discord-specific rule: skip records with empty text content
        if (
          String(finalPlatform).toLowerCase() === "discord" &&
          (!transformedData.content || String(transformedData.content).trim() === "")
        ) {
          console.warn("Skipping Discord post with empty content");
          discardedCount++;
          continue;
        }

        // Validate transformed data
        const validation = validatePostData(transformedData);
        if (!validation.valid) {
          console.warn("Skipping invalid post data:", validation.errors);
          discardedCount++;
          continue;
        }

        // Detect language from content
        const detectedLanguage = detectLanguage(transformedData.content);

        const normalizedProjectId =
          typeof projectId === "string" && projectId.trim() !== "" ? projectId : null;

        const basePostData = {
          platform: finalPlatform,
          postId: transformedData.postId,
          authorId: transformedData.authorId ? String(transformedData.authorId) : null,
          authorName: transformedData.authorName,
          content: transformedData.content,
          createdAt: new Date(transformedData.createdAt),
          editedAt: transformedData.editedAt ? new Date(transformedData.editedAt) : null,
          url: transformedData.url,
          channelId: transformedData.channelId,
          threadRefId: transformedData.threadRefId,
          media: transformedData.media,
          metricsLikes: transformedData.metricsLikes,
          metricsComments: transformedData.metricsComments,
          metricsShares: transformedData.metricsShares,
          extraJson: transformedData.extraJson,
          isTest: isTest,
          language: detectedLanguage,
          project_id: normalizedProjectId,
          job_id: jobId || null,
          ...(ingestedRunId != null ? { ingested_run_id: ingestedRunId } : {}),
        };

        const authorProfileUrl =
          transformedData.authorProfileUrl ??
          transformedData.extraJson?.authorProfileUrl ??
          transformedData.extraJson?.author?.profile_url ??
          null;
        const authorHeadline =
          transformedData.authorHeadline ??
          transformedData.extraJson?.authorHeadline ??
          transformedData.extraJson?.author?.headline ??
          null;
        const authorImageUrl =
          transformedData.authorImageUrl ??
          transformedData.extraJson?.authorImageUrl ??
          transformedData.extraJson?.author?.image_url ??
          null;
        const searchQuery =
          transformedData.searchQuery ??
          transformedData.extraJson?.searchInput ??
          transformedData.extraJson?.search_input ??
          (typeof (item as any)?.search_input === "string" ? (item as any).search_input : null);

        const rawStats = (item as Record<string, unknown>)?.stats as
          | Record<string, unknown>
          | undefined;
        let likes = Number(transformedData.metricsLikes ?? 0);
        let comments = Number(transformedData.metricsComments ?? 0);
        let shares = Number(transformedData.metricsShares ?? 0);

        if (rawStats) {
          const rawLikesCandidate = Number(
            rawStats.total_reactions ??
              rawStats.totalLikes ??
              rawStats.likes ??
              rawStats.reactions ??
              0
          );
          if (Number.isFinite(rawLikesCandidate) && rawLikesCandidate > likes) {
            likes = rawLikesCandidate;
          }

          const rawCommentsCandidate = Number(
            rawStats.comments ?? rawStats.totalComments ?? rawStats.comment ?? 0
          );
          if (Number.isFinite(rawCommentsCandidate) && rawCommentsCandidate > comments) {
            comments = rawCommentsCandidate;
          }

          const rawSharesCandidate = Number(
            rawStats.shares ?? rawStats.totalShares ?? rawStats.share ?? 0
          );
          if (Number.isFinite(rawSharesCandidate) && rawSharesCandidate > shares) {
            shares = rawSharesCandidate;
          }
        }

        if (!Number.isFinite(likes)) likes = 0;
        if (!Number.isFinite(comments)) comments = 0;
        if (!Number.isFinite(shares)) shares = 0;

        if (saveToDb) {
          // Check if post already exists before upsert
          const existingPost = await prisma.post.findUnique({
            where: {
              project_id_platform_postId: {
                project_id: projectId,
                platform: finalPlatform,
                postId: transformedData.postId,
              },
            },
            select: { id: true },
          });

          // Save to regular Post table using atomic upsert keyed by (project_id, platform, postId)
          await prisma.post.upsert({
            where: {
              project_id_platform_postId: {
                project_id: projectId,
                platform: finalPlatform,
                postId: transformedData.postId,
              },
            },
            create: basePostData,
            update: {
              ...postUpsertUpdateWithoutIngestedRunId(basePostData),
              job_id: jobId, // Ensure job_id is always updated, even if post exists
            },
          });

          // Track whether this was a new record or update
          if (existingPost) {
            updatedCount++;
          } else {
            newCount++;
          }

          // YouTube Search → Comments orchestration: the Comments step loads video URLs from
          // DownstreamPost (origScraper + PENDING). The save_to_db=true path only wrote Post above;
          // without staging here, fetchUrlsFromDownstreamPosts returns 0 even when Post has many rows.
          if (
            orchestrationExecutionId &&
            finalPlatform?.toLowerCase() === "youtube" &&
            !urlInputTrimmed &&
            scraperName
          ) {
            try {
              const { ingested_run_id: _omitIngestedRun, ...postFieldsForDownstream } =
                basePostData;
              void _omitIngestedRun;
              const existingDownstreamPost = await prisma.downstreamPost.findFirst({
                where: {
                  platform: finalPlatform,
                  postId: transformedData.postId,
                  project_id: normalizedProjectId,
                  origScraper: scraperName,
                },
              });
              const downstreamPayload = {
                ...postFieldsForDownstream,
                origScraper: scraperName,
                orchestration_execution_id: orchestrationExecutionId ?? null,
              };
              if (existingDownstreamPost) {
                await prisma.downstreamPost.update({
                  where: { id: existingDownstreamPost.id },
                  data: downstreamPayload as Prisma.DownstreamPostUncheckedUpdateInput,
                });
              } else {
                await prisma.downstreamPost.create({
                  data: downstreamPayload as Prisma.DownstreamPostUncheckedCreateInput,
                });
              }
            } catch (e) {
              console.error(
                `[DownstreamPost] YouTube orchestration staging (save_to_db=true) failed postId=${transformedData.postId}:`,
                e
              );
            }
          }
        } else {
          // Calculate engagement score for logging
          const engagementScore = likes + comments + shares;

          // YouTube: do not disqualify for zero or low engagement (e.g. no comments). Only project-context relevance applies.
          const isYouTube = finalPlatform?.toLowerCase() === "youtube";
          if (!isYouTube) {
            // For LinkedIn scrapers, apply project-specific thresholds (default: 0 = no filtering)
            if (finalPlatform?.toLowerCase() === "linkedin") {
              // Use project-specific threshold from UI, default to 0 (no filtering)
              const threshold = projectThresholds.linkedin ?? 0;

              // Track threshold for summary
              linkedinThresholdUsed = threshold;
              linkedinIsNoCookiesScraper = false; // No special case for "No Cookies" scraper

              // Only filter if threshold is explicitly set (> 0)
              if (threshold > 0 && engagementScore < threshold) {
                console.log(
                  `[LinkedIn Filter] ❌ DISCARDED - postId=${transformedData.postId}, engagement=${engagementScore} (< ${threshold} (project threshold)), likes=${likes}, comments=${comments}, shares=${shares}, search="${
                    (item as any)?.search_input ??
                    (item as any)?.inputUrl ??
                    transformedData.searchQuery ??
                    searchQuery ??
                    ""
                  }", scraper="${scraperName}"`
                );
                discardedCount++;
                continue;
              }

              // Log posts that passed filtering (or if threshold is 0, all posts pass)
              if (threshold > 0) {
                console.log(
                  `[LinkedIn Filter] ✅ QUALIFIED - postId=${transformedData.postId}, engagement=${engagementScore} (likes=${likes}, comments=${comments}, shares=${shares}), threshold=${threshold} (project), scraper="${scraperName}"`
                );
              }
            }

            // For Facebook search results, apply filtering criteria:
            // 1. Discard posts older than 48 hours
            // 2. Discard posts with engagement score below project threshold (default: 0 = no filtering)
            if (finalPlatform?.toLowerCase() === "facebook") {
              // Check if post is older than 48 hours
              const postDate = new Date(transformedData.createdAt);
              const now = new Date();
              const hoursSincePost = (now.getTime() - postDate.getTime()) / (1000 * 60 * 60);

              // Use project-specific threshold from UI, default to 0 (no filtering)
              const facebookThreshold = projectThresholds.facebook ?? 0;

              // Track threshold for summary
              facebookThresholdUsed = facebookThreshold;

              // Track filtering reasons
              const filterReasons: string[] = [];

              if (hoursSincePost > 48) {
                filterReasons.push(`age: ${hoursSincePost.toFixed(1)}h (threshold: 48h)`);
              }

              // Only filter by engagement if threshold is explicitly set (> 0)
              if (facebookThreshold > 0 && engagementScore < facebookThreshold) {
                filterReasons.push(
                  `engagement: ${engagementScore} (threshold: >=${facebookThreshold} (project))`
                );
              }

              // Log detailed filtering information
              if (filterReasons.length > 0) {
                const searchTerm =
                  (item as any)?.search_input ??
                  transformedData.searchQuery ??
                  searchQuery ??
                  "unknown";

                console.log(
                  `[Facebook Filter] ❌ DISCARDED - postId=${transformedData.postId}, reasons: ${filterReasons.join(", ")}, ` +
                    `metrics: likes=${likes}, comments=${comments}, shares=${shares}, ` +
                    `age=${hoursSincePost.toFixed(1)}h, engagement=${engagementScore}, ` +
                    `search="${searchTerm}", ` +
                    `url=${transformedData.url?.substring(0, 60) || "N/A"}...`
                );
                discardedCount++;
                continue;
              }

              // Log posts that passed filtering
              console.log(
                `[Facebook Filter] ✅ QUALIFIED - postId=${transformedData.postId}, ` +
                  `engagement=${engagementScore} (likes=${likes}, comments=${comments}, shares=${shares}), ` +
                  `age=${hoursSincePost.toFixed(1)}h, ` +
                  `threshold=${facebookThreshold > 0 ? `${facebookThreshold} (project)` : "0 (no filtering)"}, ` +
                  `search="${(item as any)?.search_input ?? transformedData.searchQuery ?? searchQuery ?? "unknown"}"`
              );
            }

            // For Twitter/X posts, apply project-specific threshold if set
            if (
              (finalPlatform?.toLowerCase() === "twitter" ||
                finalPlatform?.toLowerCase() === "x") &&
              projectThresholds.twitter !== null &&
              projectThresholds.twitter !== undefined
            ) {
              const twitterThreshold = projectThresholds.twitter;

              // Track threshold for summary
              twitterThresholdUsed = twitterThreshold;

              if (engagementScore < twitterThreshold) {
                console.log(
                  `[Twitter/X Filter] ❌ DISCARDED - postId=${transformedData.postId}, engagement=${engagementScore} (< ${twitterThreshold} (project threshold)), likes=${likes}, comments=${comments}, shares=${shares}, search="${
                    (item as any)?.search_input ??
                    (item as any)?.inputUrl ??
                    transformedData.searchQuery ??
                    searchQuery ??
                    ""
                  }", scraper="${scraperName}"`
                );
                discardedCount++;
                continue;
              }

              // Log posts that passed filtering
              console.log(
                `[Twitter/X Filter] ✅ QUALIFIED - postId=${transformedData.postId}, engagement=${engagementScore} (likes=${likes}, comments=${comments}, shares=${shares}), threshold=${twitterThreshold} (project), scraper="${scraperName}"`
              );
            }
          }

          // YouTube: apply cheap filters first (video date + transcript from scrape output), then relevance, then summarize.
          // CRITICAL: Never run these filters for the Comments scraper. We do NOT re-validate DownstreamPost records.
          // The Search step already filtered videos and wrote them to DownstreamPost; Comments just fetches comments for those URLs and saves them. No second validation pass.
          let transcript: string | null = null;
          let videoSummary: string | null = null;
          const isYouTubeResponseToVideo =
            finalPlatform?.toLowerCase() === "youtube" && transformedData.threadRefId != null;
          const skipYouTubeValidation = Boolean(
            finalPlatform?.toLowerCase() === "youtube" &&
              (urlInputTrimmed || (scraperName?.toLowerCase().includes("comment") ?? false))
          );
          // Orchestration: Search step (save_to_db=false) must still write DownstreamPost rows for the Comments step.
          // Apify often omits transcript on search results — without this, every video is discarded and Comments gets 0 URLs.
          const skipYouTubeTranscriptAndRelevanceForOrchestrationUpstream =
            finalPlatform?.toLowerCase() === "youtube" &&
            Boolean(orchestrationExecutionId) &&
            !urlInputTrimmed &&
            !(scraperName?.toLowerCase().includes("comment") ?? false);
          // Option A: Comments scraper output can include type "video" / "shorts" — don't create records for those; only comments.
          // Only apply when this step is actually the Comments scraper by name. Do NOT use skipYouTubeValidation alone:
          // a stray space in url_input_source_scraper would classify Search as "consumer" and discard every video row.
          const isYouTubeCommentsDataset =
            finalPlatform?.toLowerCase() === "youtube" &&
            (scraperName?.toLowerCase().includes("comment") ?? false);
          if (isYouTubeCommentsDataset) {
            const rawType = (item as Record<string, unknown>)?.type;
            const typeStr = typeof rawType === "string" ? rawType.toLowerCase() : "";
            if (typeStr === "video" || typeStr === "shorts") {
              discardedCount++;
              continue;
            }
          }
          if (finalPlatform?.toLowerCase() === "youtube" && !skipYouTubeValidation) {
            // 1. Filter by oldestPostDate (from scrape output - no API cost)
            const oldestPostDateMs = parseOldestPostDateToMs(scraperConfig?.oldestPostDate);
            if (oldestPostDateMs != null) {
              const cutoffDate = new Date(Date.now() - oldestPostDateMs);
              const videoDate = new Date(transformedData.createdAt);
              if (videoDate < cutoffDate) {
                if (youtubeLoggedOldest < YOUTUBE_DISCARD_LOG_CAP) {
                  console.log(
                    `[YouTube oldestPostDate Filter] ❌ DISCARDED - postId=${transformedData.postId} (youtube) ` +
                      `post date ${videoDate.toISOString()} is older than cutoff ${cutoffDate.toISOString()} (oldestPostDate: ${scraperConfig?.oldestPostDate}). Scraper="${scraperName}"`
                  );
                  youtubeLoggedOldest++;
                }
                youtubeFilteredOldestPostDate++;
                discardedCount++;
                continue;
              }
            }
            // 2. Filter by transcript only for videos (root posts). Comments/replies have no transcript; save them for conversation threads.
            if (!isYouTubeResponseToVideo) {
              transcript = extractTranscriptFromYouTubeItem(item);
              if (skipYouTubeTranscriptAndRelevanceForOrchestrationUpstream) {
                if (!youtubeOrchestrationUpstreamSkipLogged) {
                  console.log(
                    `[YouTube Orchestration] Upstream search: not requiring transcript/relevance in Actor output (executionId=${orchestrationExecutionId}). Staging videos for Comments. Scraper="${scraperName}"`
                  );
                  youtubeOrchestrationUpstreamSkipLogged = true;
                }
              } else if (!transcript || transcript.trim() === "") {
                if (youtubeLoggedNoTranscript < YOUTUBE_DISCARD_LOG_CAP) {
                  console.log(
                    `[YouTube Transcript Filter] ❌ DISCARDED - postId=${transformedData.postId} (youtube) has no transcription. Scraper="${scraperName}"`
                  );
                  youtubeLoggedNoTranscript++;
                }
                youtubeFilteredNoTranscript++;
                discardedCount++;
                continue;
              }
            }
          } else if (skipYouTubeValidation) {
            if (!youtubeSkipValidationLogged) {
              console.log(
                `[YouTube] Comments scraper: only saving comments (video/shorts items in output are skipped). Scraper="${scraperName}".`
              );
              youtubeSkipValidationLogged = true;
            }
            // Downstream scraper (e.g. YouTube Comments): still extract transcript for root videos for summary; comments have none.
            if (!isYouTubeResponseToVideo) {
              transcript = extractTranscriptFromYouTubeItem(item);
            }
          }

          // 3. Project-context relevance filter (API cost - run last after cheap filters). Skip for downstream YouTube scrapers — parent already validated.
          if (
            !skipYouTubeValidation &&
            !skipYouTubeTranscriptAndRelevanceForOrchestrationUpstream &&
            normalizedProjectId &&
            process.env.OPENAI_API_KEY
          ) {
            if (projectContextForRelevance === null) {
              try {
                projectContextForRelevance = await getProjectContextForRelevance(projectId);
              } catch (error) {
                console.error(
                  "[DownstreamPost] Error building project context for relevance filter:",
                  error
                );
              }
            }
            if (projectContextForRelevance) {
              const textForRelevance =
                finalPlatform?.toLowerCase() === "youtube" && transcript
                  ? transcript
                  : (basePostData.content ?? "");
              const { relevant, reason } = await isPostRelevantToProjectContext(
                projectContextForRelevance,
                textForRelevance,
                { platform: finalPlatform, authorName: transformedData.authorName ?? undefined }
              );
              if (!relevant) {
                if (youtubeLoggedRelevance < YOUTUBE_DISCARD_LOG_CAP) {
                  console.log(
                    `[Project Context Filter] ❌ DISCARDED - postId=${transformedData.postId} (${finalPlatform}) not relevant to project scope. Reason: ${reason || "no reason provided"}. Scraper="${scraperName}"`
                  );
                  youtubeLoggedRelevance++;
                }
                if (finalPlatform?.toLowerCase() === "youtube") {
                  youtubeFilteredRelevance++;
                }
                discardedCount++;
                continue;
              }
            }
          }

          // 4. YouTube only: summarize transcript (API cost - only for videos that passed relevance)
          if (finalPlatform?.toLowerCase() === "youtube" && transcript) {
            try {
              videoSummary = await summarizeTranscriptWithOpenAI(transcript);
            } catch (err) {
              console.warn(
                "[DownstreamPost] YouTube summary failed for",
                transformedData.postId,
                err
              );
            }
          }

          // Save to DownstreamPost table with origScraper field
          if (!scraperName) {
            console.warn("No scraper name provided for downstream post, skipping");
            continue;
          }

          const existingDownstreamPost = await prisma.downstreamPost.findFirst({
            where: {
              platform: finalPlatform,
              postId: transformedData.postId,
              project_id: normalizedProjectId,
              origScraper: scraperName,
            },
          });

          // DownstreamPost has no `ingested_run_id` (Post-only field on Post). Spreading basePostData
          // previously passed that key into create/update and Prisma rejected the payload.
          const { ingested_run_id: _omitIngestedRun, ...postFieldsForDownstream } = basePostData;
          void _omitIngestedRun; // Post-only field; strip for DownstreamPost

          const downstreamPostData = {
            ...postFieldsForDownstream,
            origScraper: scraperName,
            authorProfileUrl,
            authorHeadline,
            authorImageUrl,
            search_query: searchQuery ?? null,
            metricsLikes: likes,
            metricsComments: comments,
            metricsShares: shares,
            // Always set so Prisma updates replace a stale execution id from an earlier run (omit key left old value).
            orchestration_execution_id: orchestrationExecutionId ?? null,
            ...(transcript != null && { transcript }),
            ...(videoSummary != null && {
              summary: videoSummary,
              ai_processed_at: new Date(),
            }),
          };

          if (existingDownstreamPost) {
            await prisma.downstreamPost.update({
              where: { id: existingDownstreamPost.id },
              data: downstreamPostData as Prisma.DownstreamPostUncheckedUpdateInput,
            });
            console.log(
              `[DownstreamPost] Updated existing record postId=${
                transformedData.postId
              } (${finalPlatform}) engagement=${engagementScore} search="${searchQuery ?? ""}"`
            );
          } else {
            await prisma.downstreamPost.create({
              data: downstreamPostData as Prisma.DownstreamPostUncheckedCreateInput,
            });
            console.log(
              `[DownstreamPost] Created record postId=${transformedData.postId} (${finalPlatform}) engagement=${engagementScore} search="${
                searchQuery ?? ""
              }"`
            );
          }

          // Also upsert into main Post table so root posts are available for downstream analyses
          if (normalizedProjectId) {
            try {
              const postWhereUnique = {
                project_id_platform_postId: {
                  project_id: normalizedProjectId,
                  platform: finalPlatform,
                  postId: transformedData.postId,
                },
              };
              const existingPost = await prisma.post.findUnique({
                where: postWhereUnique,
                select: { id: true },
              });

              await prisma.post.upsert({
                where: postWhereUnique,
                create: basePostData,
                update: {
                  ...postUpsertUpdateWithoutIngestedRunId(basePostData),
                  job_id: jobId || null,
                },
              });

              if (existingPost) {
                updatedCount++;
              } else {
                newCount++;
              }
            } catch (error) {
              console.error(
                `[DownstreamPost] Failed to upsert root post ${transformedData.postId} into Post table:`,
                error
              );
            }
          } else {
            console.warn(
              `[DownstreamPost] Missing project ID for root post ${transformedData.postId}, skipping Post table upsert`
            );
          }
        }

        savedCount++;
      } catch (error) {
        console.error("Error saving post:", error);
        discardedCount++; // Count as discarded due to save error
        // Continue processing other items
      }
    }

    // Update job with final post count (skip if no job_id)
    if (jobId) {
      console.log(
        `🔍 DEBUG: Updating ScrapeJob ${jobId} with posts_count: ${savedCount}, discarded_count: ${discardedCount}`
      );
      await prisma.scrapeJob.update({
        where: { id: jobId },
        data: {
          posts_count: savedCount,
          discarded_count: discardedCount,
        },
      });
      console.log(`🔍 DEBUG: Successfully updated ScrapeJob ${jobId}`);
    } else {
      console.log(`🔍 DEBUG: No jobId provided, skipping ScrapeJob update`);
    }

    console.log(
      `📊 Post processing summary: ${savedCount} saved (${newCount} new, ${updatedCount} updated), ${discardedCount} discarded, ${items.length} total processed`
    );

    // Log comprehensive filtering summary for platforms with engagement thresholds
    const finalPlatformLower = platform?.toLowerCase() || "";
    const scraperNameLower = scraperName?.toLowerCase() || "";

    // LinkedIn summary
    if (finalPlatformLower === "linkedin" && linkedinThresholdUsed !== null) {
      const thresholdSource =
        projectThresholds.linkedin !== null && projectThresholds.linkedin !== undefined
          ? `project threshold: ${projectThresholds.linkedin}`
          : "default: 0 (no filtering)";

      console.log(
        `\n${"=".repeat(70)}\n` +
          `[LinkedIn Engagement Filter Summary] Platform: ${platform}, Scraper: ${scraperName || "unknown"}\n` +
          `${"=".repeat(70)}\n` +
          `Total Processed: ${items.length}\n` +
          `✅ Qualified & Saved to DownstreamPost: ${savedCount}\n` +
          `❌ Discarded (below threshold): ${discardedCount}\n` +
          `\nEngagement Threshold Applied:\n` +
          `   - Minimum engagement score: ${linkedinThresholdUsed} (${thresholdSource})\n` +
          `   - Engagement = likes + comments + shares\n` +
          `   - Note: Threshold of 0 means no filtering (all posts saved)\n` +
          `\n💡 Tip: Check logs above for detailed filtering information for each post\n` +
          `${"=".repeat(70)}\n`
      );
    }

    // Facebook summary
    if (
      finalPlatformLower === "facebook" &&
      scraperNameLower.includes("posts") &&
      facebookThresholdUsed !== null
    ) {
      const thresholdSource =
        projectThresholds.facebook !== null && projectThresholds.facebook !== undefined
          ? `project threshold: ${projectThresholds.facebook}`
          : "default: 0 (no filtering)";

      console.log(
        `\n${"=".repeat(70)}\n` +
          `[Facebook Posts Filter Summary] Platform: ${platform}, Scraper: ${scraperName || "unknown"}\n` +
          `${"=".repeat(70)}\n` +
          `Total Processed: ${items.length}\n` +
          `✅ Qualified & Saved to DownstreamPost: ${savedCount}\n` +
          `❌ Discarded: ${discardedCount}\n` +
          `\nFiltering Criteria Applied:\n` +
          `   - Post age must be <= 48 hours (always enforced)\n` +
          `   - Engagement score must be >= ${facebookThresholdUsed} (${thresholdSource})\n` +
          `   - Engagement = likes + comments + shares\n` +
          `   - Note: Threshold of 0 means no engagement filtering (only age filter applies)\n` +
          `\n💡 Tip: Check logs above for detailed reasons why each post was filtered\n` +
          `${"=".repeat(70)}\n`
      );
    }

    // Twitter/X summary
    if (
      (finalPlatformLower === "twitter" || finalPlatformLower === "x") &&
      twitterThresholdUsed !== null
    ) {
      console.log(
        `\n${"=".repeat(70)}\n` +
          `[Twitter/X Engagement Filter Summary] Platform: ${platform}, Scraper: ${scraperName || "unknown"}\n` +
          `${"=".repeat(70)}\n` +
          `Total Processed: ${items.length}\n` +
          `✅ Qualified & Saved to DownstreamPost: ${savedCount}\n` +
          `❌ Discarded (below threshold): ${discardedCount}\n` +
          `\nEngagement Threshold Applied:\n` +
          `   - Minimum engagement score: ${twitterThresholdUsed} (project threshold)\n` +
          `   - Engagement = likes + comments + shares\n` +
          `\n💡 Tip: Check logs above for detailed filtering information for each post\n` +
          `${"=".repeat(70)}\n`
      );
    }

    // YouTube summary
    if (finalPlatformLower === "youtube") {
      const totalFiltered =
        youtubeFilteredNoTranscript + youtubeFilteredOldestPostDate + youtubeFilteredRelevance;
      console.log(
        `\n${"=".repeat(70)}\n` +
          `[YouTube Scraper Summary] Platform: youtube, Scraper: ${scraperName || "unknown"}\n` +
          `${"=".repeat(70)}\n` +
          `Records scraped: ${items.length}\n` +
          `✅ Inserted (DownstreamPost + Post): ${savedCount}\n` +
          `❌ Filtered out: ${totalFiltered}\n` +
          (totalFiltered > 0
            ? `   - No transcription: ${youtubeFilteredNoTranscript}\n` +
              `   - Older than oldestPostDate: ${youtubeFilteredOldestPostDate}\n` +
              `   - Not relevant to project: ${youtubeFilteredRelevance}\n` +
              (totalFiltered > YOUTUBE_DISCARD_LOG_CAP
                ? `   (Only first ${YOUTUBE_DISCARD_LOG_CAP} per reason logged above; full counts here.)\n`
                : "")
            : "") +
          `${"=".repeat(70)}\n`
      );
    }

    return { savedCount, discardedCount, newCount, updatedCount };
  }

  /**
   * Start a scraping job for a project
   */
  async startScrapingJob(
    projectId: string,
    scraperId: string,
    keywords: string[]
  ): Promise<string> {
    // Backwards-compatible single job launcher (array input)
    // Prefer using startScrapingJobsForScraper for advanced input control
    // Get scraper configuration
    const scraper = await prisma.scraper.findFirst({
      where: { id: scraperId, deleted_at: null },
    });

    if (!scraper) {
      throw new Error("Scraper not found");
    }

    // Create job record
    const job = await prisma.scrapeJob.create({
      data: {
        project_id: projectId,
        scraper_id: scraperId,
        status: "PENDING",
      },
    });

    try {
      // Parse scraper configuration
      const config = JSON.parse(scraper.config_json);

      // Prepare input for Apify (array keywords by default)
      // For Reddit scrapers, combine keywords with Reddit URLs
      // For X scrapers, combine keywords with X URLs
      let input;
      if (scraper.platform === "reddit") {
        input = await this.resolveRedditConfigPlaceholders(
          config,
          keywords,
          projectId,
          scraper.actor_id
        );
      } else if (scraper.platform === "x" || scraper.platform === "X") {
        input = await this.resolveXConfigPlaceholders(
          config,
          keywords,
          projectId,
          scraper.actor_id,
          undefined
        );
      } else {
        input = this.resolveConfigPlaceholders(config, {
          keywords,
        });
      }

      // Start the scraper run with platform-specific timeout
      const run = await this.startScraper(scraper.actor_id, input, scraper.platform);

      // Update job with Apify run ID
      await prisma.scrapeJob.update({
        where: { id: job.id },
        data: {
          apify_run_id: run.id,
          status: "RUNNING",
          started_at: new Date(),
        },
      });

      return job.id;
    } catch (error) {
      // Update job with error
      await prisma.scrapeJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          error_message: error instanceof Error ? error.message : "Unknown error",
          completed_at: new Date(),
        },
      });

      throw error;
    }
  }

  /**
   * Fetch URLs from DownstreamPost table for a specific source scraper.
   * When orchestrationExecutionId is provided (e.g. during orchestration), only returns records
   * from that execution so the Comments step uses URLs from the current run only.
   */
  async fetchUrlsFromDownstreamPosts(
    projectId: string,
    sourceScraperName: string,
    preferUrls: boolean = false,
    orchestrationExecutionId?: string | null
  ): Promise<string[]> {
    const normalizedProjectId =
      typeof projectId === "string" && projectId.trim() !== "" ? projectId : null;

    console.log(
      `[fetchUrlsFromDownstreamPosts] Looking for DownstreamPost records: projectId=${normalizedProjectId}, sourceScraperName="${sourceScraperName}"${orchestrationExecutionId ? `, executionId=${orchestrationExecutionId}` : ""}`
    );

    let downstreamPosts = await prisma.downstreamPost.findMany({
      where: {
        project_id: normalizedProjectId ?? undefined,
        origScraper: sourceScraperName,
        status: "PENDING",
        ...(orchestrationExecutionId
          ? { orchestration_execution_id: orchestrationExecutionId }
          : {}),
      },
      select: {
        id: true,
        postId: true,
        url: true,
        origScraper: true,
      },
      orderBy: { createdAt: "asc" },
    });

    // Upstream LinkedIn/X search sometimes writes seeds before orchestration_execution_id is stamped
    // on ScrapeJob, so DownstreamPost rows stay null and strict lookup returns 0 — Apify never runs.
    // Second pass: PENDING seeds for this scraper created after this execution started (slack −2min).
    if (
      downstreamPosts.length === 0 &&
      orchestrationExecutionId &&
      normalizedProjectId
    ) {
      const exec = await prisma.orchestrationExecution.findFirst({
        where: { id: orchestrationExecutionId, deleted_at: null },
        select: { created_at: true },
      });
      if (exec?.created_at) {
        const since = new Date(exec.created_at.getTime() - 120_000);
        const fallbackRows = await prisma.downstreamPost.findMany({
          where: {
            project_id: normalizedProjectId,
            origScraper: sourceScraperName,
            status: "PENDING",
            orchestration_execution_id: null,
            createdAt: { gte: since },
          },
          select: {
            id: true,
            postId: true,
            url: true,
            origScraper: true,
          },
          orderBy: { createdAt: "asc" },
        });
        if (fallbackRows.length > 0) {
          console.warn(
            `[fetchUrlsFromDownstreamPosts] Fallback: ${fallbackRows.length} PENDING seed(s) with orchestration_execution_id=null ` +
              `(created ≥ ${since.toISOString()}) matched source "${sourceScraperName}". ` +
              `This run will proceed; staging should stamp orchestration_execution_id=${orchestrationExecutionId}.`
          );
          downstreamPosts = fallbackRows;
        }
      }
    }

    console.log(
      `[fetchUrlsFromDownstreamPosts] Found ${downstreamPosts.length} DownstreamPost records with origScraper="${sourceScraperName}"`
    );

    // If no records found, check what scraper names actually exist in DownstreamPost
    if (downstreamPosts.length === 0) {
      const allDownstreamPosts = await prisma.downstreamPost.findMany({
        where: {
          project_id: normalizedProjectId ?? undefined,
        },
        select: {
          origScraper: true,
        },
      });

      const uniqueScraperNames = Array.from(
        new Set(allDownstreamPosts.map((p) => p.origScraper).filter(Boolean))
      );

      console.log(
        `[fetchUrlsFromDownstreamPosts] ⚠️  No records found for "${sourceScraperName}". Available scraper names in DownstreamPost: ${JSON.stringify(uniqueScraperNames)}`
      );
      console.log(
        `[fetchUrlsFromDownstreamPosts] 💡 Tip: Make sure url_input_source_scraper exactly matches the scraper name used when saving to DownstreamPost`
      );

      // YouTube Search → Comments: explain whether rows exist but were filtered out (wrong name, status, execution id)
      try {
        const baseProject = {
          project_id: normalizedProjectId ?? undefined,
          origScraper: sourceScraperName,
        };
        const totalForName = await prisma.downstreamPost.count({ where: baseProject });
        const byStatus = await prisma.downstreamPost.groupBy({
          by: ["status"],
          where: baseProject,
          _count: { id: true },
        });
        const pendingNoExec = orchestrationExecutionId
          ? await prisma.downstreamPost.count({
              where: {
                ...baseProject,
                status: "PENDING",
                orchestration_execution_id: null,
              },
            })
          : 0;
        const pendingWrongExec = orchestrationExecutionId
          ? await prisma.downstreamPost.count({
              where: {
                ...baseProject,
                status: "PENDING",
                orchestration_execution_id: { not: orchestrationExecutionId },
              },
            })
          : 0;
        console.log(
          `[fetchUrlsFromDownstreamPosts] Diagnostics for origScraper="${sourceScraperName}": ` +
            `total rows (any status)=${totalForName}; byStatus=${JSON.stringify(byStatus.map((r) => ({ status: r.status, n: r._count.id })))}` +
            (orchestrationExecutionId
              ? `; PENDING+null execution=${pendingNoExec}; PENDING+other execution=${pendingWrongExec} (wanted executionId=${orchestrationExecutionId})`
              : "")
        );
        if (totalForName > 0 && downstreamPosts.length === 0) {
          console.warn(
            `[fetchUrlsFromDownstreamPosts] Rows exist for this origScraper but none matched filters (status=PENDING` +
              (orchestrationExecutionId
                ? ` + orchestration_execution_id=${orchestrationExecutionId}`
                : "") +
              `). Non-PENDING rows must be re-staged or execution id must match the Search step.`
          );
        }
      } catch (diagErr) {
        console.error(`[fetchUrlsFromDownstreamPosts] Diagnostics query failed:`, diagErr);
      }
    }

    // Extract identifiers
    // For Facebook Comments Scraper, prefer URLs (since it needs full Facebook URLs)
    // For other scrapers, prefer postId (more reliable identifier)
    const identifiers = downstreamPosts
      .map((post, idx) => {
        if (preferUrls) {
          // Prefer URL for Facebook Comments Scraper
          const url = typeof post.url === "string" ? post.url.trim() : "";
          if (url) {
            // Validate URL format
            try {
              const urlObj = new URL(url);
              if (urlObj.protocol && urlObj.protocol.startsWith("http")) {
                console.log(
                  `[fetchUrlsFromDownstreamPosts] ✅ Extracted valid URL at index ${idx}: ${url.substring(0, 60)}...`
                );
                return url;
              } else {
                console.error(
                  `[fetchUrlsFromDownstreamPosts] ❌ Invalid URL protocol at index ${idx}: ${url}`
                );
                return null;
              }
            } catch (e) {
              const errorMessage = e instanceof Error ? e.message : String(e);
              console.error(
                `[fetchUrlsFromDownstreamPosts] ❌ Invalid URL format at index ${idx}: ${url}, error: ${errorMessage}`
              );
              return null;
            }
          }
          // Don't fall back to postId for Facebook Comments Scraper - it needs URLs
          console.warn(
            `[fetchUrlsFromDownstreamPosts] ⚠️  No URL available for post at index ${idx}, postId: ${post.postId}`
          );
          return null;
        } else {
          // Default: prefer postId, fall back to URL
          const postId = typeof post.postId === "string" ? post.postId.trim() : "";
          if (postId) {
            return postId;
          }
          const url = typeof post.url === "string" ? post.url.trim() : "";
          return url || null;
        }
      })
      .filter((value): value is string => value !== null && value.length > 0);

    // Remove duplicates while preserving order
    const uniqueIdentifiers = Array.from(new Set(identifiers));

    console.log(
      `[fetchUrlsFromDownstreamPosts] Extracted ${uniqueIdentifiers.length} unique identifiers from ${downstreamPosts.length} records (preferUrls: ${preferUrls})`
    );

    // Final validation for Facebook Comments Scraper - ensure all are valid URLs
    if (preferUrls && uniqueIdentifiers.length > 0) {
      const validUrls: string[] = [];
      const invalidUrls: string[] = [];

      uniqueIdentifiers.forEach((identifier, _idx) => {
        try {
          const urlObj = new URL(identifier);
          if (urlObj.protocol && urlObj.protocol.startsWith("http")) {
            validUrls.push(identifier);
          } else {
            invalidUrls.push(identifier);
            console.error(`[fetchUrlsFromDownstreamPosts] ❌ Invalid URL protocol: ${identifier}`);
          }
        } catch (e) {
          invalidUrls.push(identifier);
          const errorMessage = e instanceof Error ? e.message : String(e);
          console.error(
            `[fetchUrlsFromDownstreamPosts] ❌ Invalid URL format: ${identifier}, error: ${errorMessage}`
          );
        }
      });

      if (invalidUrls.length > 0) {
        console.error(
          `[fetchUrlsFromDownstreamPosts] ⚠️  Filtered out ${invalidUrls.length} invalid URLs, keeping ${validUrls.length} valid URLs`
        );
        return validUrls;
      }
    }

    return uniqueIdentifiers;
  }

  /**
   * Unique profile URLs for X Profile Posts scraper when fed from Twitter/X Search DownstreamPost rows.
   * One search result row can map to one profile; many tweets from the same author dedupe to one URL.
   */
  async fetchXProfileUrlsFromDownstreamPosts(
    projectId: string,
    sourceScraperName: string,
    orchestrationExecutionId?: string | null
  ): Promise<string[]> {
    const normalizedProjectId =
      typeof projectId === "string" && projectId.trim() !== "" ? projectId : null;

    const rows = await prisma.downstreamPost.findMany({
      where: {
        project_id: normalizedProjectId ?? undefined,
        origScraper: sourceScraperName,
        status: "PENDING",
        ...(orchestrationExecutionId
          ? { orchestration_execution_id: orchestrationExecutionId }
          : {}),
      },
      select: {
        authorProfileUrl: true,
        url: true,
      },
      orderBy: { createdAt: "asc" },
    });

    const profiles: string[] = [];
    for (const row of rows) {
      const p = deriveXProfileUrlFromDownstreamRow(row);
      if (p) profiles.push(p);
    }
    const unique = Array.from(new Set(profiles.map((u) => normalizeXProfileUrl(u)))).filter(Boolean);

    console.log(
      `[fetchXProfileUrlsFromDownstreamPosts] ${rows.length} DownstreamPost row(s) -> ${unique.length} unique profile URL(s) (source="${sourceScraperName}"` +
        (orchestrationExecutionId ? `, executionId=${orchestrationExecutionId})` : ")")
    );
    if (rows.length > 0 && unique.length === 0) {
      console.warn(
        `[fetchXProfileUrlsFromDownstreamPosts] No profile URLs derived — check authorProfileUrl/url on DownstreamPost rows and tweet URL shape (avoid x.com/i/status/ without username).`
      );
    }

    return unique;
  }

  /** Apify actor id for X (Twitter) Profile Posts Scraper */
  private static readonly X_PROFILE_POSTS_ACTOR_ID = "Fo9GoU5wC270BgcBr";

  /**
   * When Profile Posts runs in an orchestration right after Twitter Search, DownstreamPost rows are keyed by
   * execution id. If the scraper record omits url_input_* (common), we still must load those profiles instead of
   * only project/brand URLs — otherwise Apify runs once against the wrong handles (e.g. a single project profile).
   */
  private async tryLoadXProfilePostsFromSearchExecution(
    projectId: string,
    orchestrationExecutionId: string,
    urlInputSourceScraper: string | null | undefined
  ): Promise<string[]> {
    const trySources = [
      typeof urlInputSourceScraper === "string" ? urlInputSourceScraper.trim() : "",
      "Twitter (X.com) Search Scraper",
    ].filter((s, i, a) => s.length > 0 && a.indexOf(s) === i);

    for (const src of trySources) {
      const found = await this.fetchXProfileUrlsFromDownstreamPosts(
        projectId,
        src,
        orchestrationExecutionId
      );
      if (found.length > 0) {
        console.log(
          `[tryLoadXProfilePostsFromSearchExecution] ${found.length} profile URL(s) from origScraper="${src}"`
        );
        return found;
      }
    }

    const normalizedProjectId =
      typeof projectId === "string" && projectId.trim() !== "" ? projectId : null;
    const orphanRows = await prisma.downstreamPost.findMany({
      where: {
        project_id: normalizedProjectId ?? undefined,
        orchestration_execution_id: orchestrationExecutionId,
        status: "PENDING",
        platform: { in: ["x", "X", "twitter", "Twitter"] },
      },
      select: { authorProfileUrl: true, url: true },
      orderBy: { createdAt: "asc" },
    });
    const acc: string[] = [];
    for (const row of orphanRows) {
      const p = deriveXProfileUrlFromDownstreamRow(row);
      if (p) acc.push(normalizeXProfileUrl(p));
    }
    const unique = [...new Set(acc)];
    if (unique.length > 0) {
      console.log(
        `[tryLoadXProfilePostsFromSearchExecution] ${unique.length} profile URL(s) from ${orphanRows.length} PENDING X DownstreamPost row(s) (any origScraper, execution=${orchestrationExecutionId})`
      );
    }
    return unique;
  }

  /**
   * Inject URLs into a specific field in the configuration object
   */
  injectUrlsIntoConfig(config: any, fieldName: string, urls: string[]): any {
    const clone = (value: any): any => {
      if (Array.isArray(value)) {
        return value.map(clone);
      }
      if (value && typeof value === "object") {
        const result: any = {};
        for (const key of Object.keys(value)) {
          if (key === fieldName) {
            // Inject URLs into the specified field
            result[key] = urls;
          } else {
            result[key] = clone(value[key]);
          }
        }
        return result;
      }
      return value;
    };

    return clone(config);
  }

  /**
   * When no channels match, explain counts and whether other projects hold selected Discord channels.
   */
  private async logDiscordChannelDiagnosticsForProject(projectId: string): Promise<void> {
    const project = await prisma.project.findFirst({
      where: { id: projectId, deleted_at: null },
      select: { name: true },
    });
    const anyDiscord = await prisma.projectProfile.count({
      where: { project_id: projectId, platform: "discord", deleted_at: null },
    });
    const channelType = await prisma.projectProfile.count({
      where: {
        project_id: projectId,
        platform: "discord",
        type: "channel",
        deleted_at: null,
      },
    });
    const selectedChannel = await prisma.projectProfile.count({
      where: {
        project_id: projectId,
        platform: "discord",
        type: "channel",
        is_selected: true,
        deleted_at: null,
      },
    });
    const brandDiscordSources = await prisma.projectBrandSource.count({
      where: {
        project_id: projectId,
        link_type: "DISCORD",
        deleted_at: null,
      },
    });
    const otherRows = await prisma.projectProfile.findMany({
      where: {
        platform: "discord",
        type: "channel",
        is_selected: true,
        deleted_at: null,
        NOT: { project_id: projectId },
      },
      select: { project_id: true },
      take: 50,
    });
    const seen = new Set<string>();
    const otherProjectIds: string[] = [];
    for (const row of otherRows) {
      if (!seen.has(row.project_id)) {
        seen.add(row.project_id);
        otherProjectIds.push(row.project_id);
      }
    }
    const otherProjects =
      otherProjectIds.length > 0
        ? await prisma.project.findMany({
            where: { id: { in: otherProjectIds }, deleted_at: null },
            select: { id: true, name: true },
          })
        : [];
    console.warn(
      `❌ Discord scraper: project "${project?.name ?? "?"} (${projectId})" has no usable Discord channels. ` +
        `Counts for this project — ProjectProfile discord: ${anyDiscord}, type=channel: ${channelType}, selected channel: ${selectedChannel}; ` +
        `Brand Related Sources (DISCORD): ${brandDiscordSources}. ` +
        `The scraper uses selected ProjectProfile channels and/or DISCORD rows in Brand Related Sources.`
    );
    if (otherProjects.length > 0) {
      console.warn(
        `   Discord channels exist on other project(s) — this run does not use them: ${otherProjects
          .map((p) => `"${p.name}" (${p.id})`)
          .join(
            ", "
          )}. Add channels under the project being scraped, or add that project id to this orchestration and save.`
      );
    }
  }

  /**
   * Fetch Discord URLs from multiple projects (orchestrations merge channels from all listed projects).
   * URLs come from (1) selected ProjectProfile discord channels and (2) DISCORD rows in Brand Related Sources.
   * URLs are deduplicated by channel URL; ProjectProfile wins when the same URL exists in both.
   */
  async fetchDiscordUrlsFromProjects(projectIds: string[]): Promise<
    Array<{
      url: string;
      profileId?: string;
    }>
  > {
    const unique = [...new Set(projectIds.filter(Boolean))];
    if (unique.length === 0) return [];
    try {
      console.log(
        `🔍 DEBUG: fetchDiscordUrlsFromProjects - Querying projects: ${unique.join(", ")}`
      );
      const discordProfiles = await prisma.projectProfile.findMany({
        where: {
          project_id: { in: unique },
          platform: "discord",
          type: "channel",
          is_selected: true,
          deleted_at: null,
        },
        select: {
          id: true,
          url: true,
        },
      });

      const brandDiscordRows = await prisma.projectBrandSource.findMany({
        where: {
          project_id: { in: unique },
          link_type: "DISCORD",
          deleted_at: null,
        },
        select: { url: true },
      });

      console.log(
        `🔍 DEBUG: fetchDiscordUrlsFromProjects - Found ${discordProfiles.length} Discord ProjectProfile rows, ${brandDiscordRows.length} Brand Related Sources (DISCORD) (before URL dedupe)`
      );

      const mapped = discordProfiles.map((profile) => ({
        url: profile.url,
        profileId: profile.id,
      }));

      const byUrl = new Map<string, { url: string; profileId?: string }>();
      for (const row of mapped) {
        const u = (row.url || "").trim();
        if (!u) continue;
        if (!byUrl.has(u)) byUrl.set(u, row);
      }
      for (const row of brandDiscordRows) {
        const u = (row.url || "").trim();
        if (!u) continue;
        if (!byUrl.has(u)) {
          byUrl.set(u, { url: u });
        }
      }
      const result = Array.from(byUrl.values());

      if (result.length === 0) {
        for (const id of unique) {
          try {
            await this.logDiscordChannelDiagnosticsForProject(id);
          } catch (diagErr) {
            console.warn("Discord profile diagnostic query failed:", diagErr);
          }
        }
      }

      console.log(
        `🔍 DEBUG: fetchDiscordUrlsFromProjects - Returning ${result.length} channel URLs (after dedupe; ProjectProfile preferred when URL overlaps)`
      );
      return result;
    } catch (error) {
      console.error(`❌ ERROR in fetchDiscordUrlsFromProjects:`, error);
      if (error instanceof Error) {
        console.error(`   Error message: ${error.message}`);
        console.error(`   Error stack: ${error.stack}`);
      }
      throw error;
    }
  }

  /**
   * Fetch Discord URLs from project profiles for Discord scrapers
   */
  async fetchDiscordUrlsFromProject(projectId: string): Promise<
    Array<{
      url: string;
      profileId?: string;
    }>
  > {
    return this.fetchDiscordUrlsFromProjects([projectId]);
  }

  /**
   * Replace Discord URL placeholders in configuration
   */
  replaceDiscordUrlPlaceholders(config: any, discordUrl: string): any {
    const configStr = JSON.stringify(config);

    // Replace Discord placeholders with the Discord URL (as string)
    // Discord scraper expects a single URL string, not an array
    let updatedConfigStr = configStr
      .replace(/\[user_selected_discord_urls\]/g, JSON.stringify(discordUrl))
      .replace(/"\{\{urls\}\}"/g, JSON.stringify(discordUrl));

    // Also replace temp-placeholder (used when JSON parsing fails)
    updatedConfigStr = updatedConfigStr.replace(/"temp-placeholder"/g, JSON.stringify(discordUrl));

    const result = JSON.parse(updatedConfigStr);

    const currentCount = result.count;
    console.log(`🔍 DEBUG: Using count from scraper config_json: ${currentCount ?? "not set"}`);

    this.finalizeDiscordApifyInput(result, "discord");
    return result;
  }

  /**
   * Start scraping job for orchestration execution
   * Uses the specific scraper configuration from the orchestration
   */
  async startOrchestrationScrapingJob(
    projectId: string,
    scraperId: string,
    scraperName: string,
    platform: string,
    orchestrationExecutionId?: string,
    options?: { discordMergeProjectIds?: string[] }
  ): Promise<string[]> {
    // Get scraper configuration
    const scraper = await prisma.scraper.findFirst({
      where: { id: scraperId, deleted_at: null },
    });

    if (!scraper) {
      throw new Error(`Scraper ${scraperName} not found`);
    }

    console.log(`🔍 DEBUG: Scraper ${scraperName} - Actor ID: ${scraper.actor_id}`);

    // Get project data for placeholder resolution
    const project = await prisma.project.findFirst({
      where: { id: projectId, deleted_at: null },
      include: {
        keywords: { where: { deleted_at: null } },
        profiles: { where: { deleted_at: null } },
        brands: { where: { deleted_at: null }, select: { brand_name: true } },
      },
    });

    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    const keywords = project.keywords.map((k) => k.keyword);
    const urls = project.profiles.map((p) => p.url);
    const brandNames = (project as { brands: { brand_name: string }[] }).brands
      .map((b) => (b.brand_name || "").trim())
      .filter(Boolean);

    // Search scrapers get keywords + brand names (array or one-at-a-time depending on scraper)
    const SEARCH_SCRAPER_ACTOR_IDS = [
      "TMBawM4LZpKN15DZX", // Facebook Posts Search
      "5QnEH5N71IK2mFLrP", // LinkedIn Posts Search Scraper
      "2s3kSMq7tpuC3bI6M", // Twitter (X.com) Search Scraper
      "3XedXIRBcjfKrnsDJ", // Mass Reddit Scraper Pro - Fast
      "h7sDV53CddomktSi5", // YouTube Scraper (searchQueries = keywords + brands)
    ];
    const isSearchScraper = SEARCH_SCRAPER_ACTOR_IDS.includes(scraper.actor_id);
    const searchTerms = isSearchScraper
      ? (() => {
          const seen = new Set<string>();
          const out: string[] = [];
          for (const term of [...keywords, ...brandNames]) {
            const n = (term || "").trim().toLowerCase();
            if (n && !seen.has(n)) {
              seen.add(n);
              out.push((term || "").trim());
            }
          }
          return out;
        })()
      : keywords;
    if (isSearchScraper) {
      console.log(
        `🔍 DEBUG: Search scraper - using keywords + brand names: ${keywords.length} keywords, ${brandNames.length} brands → ${searchTerms.length} search terms`
      );
    }

    // Resolve placeholders based on platform
    let resolvedConfig: any;
    try {
      console.log(`🔍 DEBUG: Parsing config for ${scraperName}:`, scraper.config_json);

      // Fix common JSON issues with unquoted placeholders
      let fixedConfigJson = scraper.config_json;

      // Fix unquoted {{keywords}} placeholders in arrays
      fixedConfigJson = fixedConfigJson.replace(/\[\s*\{\{keywords\}\}\s*\]/g, '["{{keywords}}"]');
      fixedConfigJson = fixedConfigJson.replace(/\[\s*\{\{keyword\}\}\s*\]/g, '["{{keyword}}"]');
      fixedConfigJson = fixedConfigJson.replace(/\[\s*\{\{urls\}\}\s*\]/g, '["{{urls}}"]');
      fixedConfigJson = fixedConfigJson.replace(/\[\s*\{\{url\}\}\s*\]/g, '["{{url}}"]');

      // Fix unquoted {{keywords}} placeholders as standalone values
      fixedConfigJson = fixedConfigJson.replace(/:\s*\{\{keywords\}\}/g, ': "{{keywords}}"');
      fixedConfigJson = fixedConfigJson.replace(/:\s*\{\{keyword\}\}/g, ': "{{keyword}}"');
      fixedConfigJson = fixedConfigJson.replace(/:\s*\{\{urls\}\}/g, ': "{{urls}}"');
      fixedConfigJson = fixedConfigJson.replace(/:\s*\{\{url\}\}/g, ': "{{url}}"');

      console.log(`🔍 DEBUG: Fixed config JSON:`, fixedConfigJson);
      resolvedConfig = JSON.parse(fixedConfigJson);
    } catch (error) {
      console.error(`❌ JSON Parse Error for ${scraperName}:`, error);
      console.error(`❌ Raw config_json:`, scraper.config_json);
      throw new Error(`Invalid scraper configuration for ${scraperName}`);
    }

    // Log scrapeUntil BEFORE platform-specific processing for debugging
    if (resolvedConfig.scrapeUntil) {
      console.log(
        `🔍 DEBUG: scrapeUntil BEFORE resolveLinkedInConfigPlaceholders: ${JSON.stringify(resolvedConfig.scrapeUntil)}`
      );
    }

    // Resolve placeholders based on platform
    const isYouTubeSourcesOnlyScraper =
      platform?.toLowerCase() === "youtube" &&
      (scraperName?.toLowerCase().includes("sources") ?? false);
    console.log(
      `🔍 DEBUG: Platform detection - platform: "${platform}", lowerCase: "${platform.toLowerCase()}"`
    );
    switch (platform.toLowerCase()) {
      case "linkedin":
        resolvedConfig = await this.resolveLinkedInConfigPlaceholders(
          resolvedConfig,
          searchTerms,
          projectId,
          scraper.actor_id,
          scraperName
        );
        break;
      case "reddit": {
        const isRedditSourcesOnlyScraper = scraperName?.toLowerCase().includes("sources") ?? false;
        if (isRedditSourcesOnlyScraper) {
          resolvedConfig = await this.resolveRedditSourcesOnlyConfigPlaceholders(
            resolvedConfig,
            projectId,
            scraperName
          );
        } else {
          resolvedConfig = await this.resolveRedditConfigPlaceholders(
            resolvedConfig,
            searchTerms,
            projectId,
            scraper.actor_id
          );
        }
        break;
      }
      case "x":
      case "twitter":
        console.log(`🔍 DEBUG: Processing ${platform} scraper: ${scraperName}`);
        resolvedConfig = await this.resolveXConfigPlaceholders(
          resolvedConfig,
          searchTerms,
          projectId,
          scraper.actor_id,
          orchestrationExecutionId ?? undefined
        );
        console.log(
          `🔍 DEBUG: After resolveXConfigPlaceholders - postUrls length: ${resolvedConfig.postUrls?.length || 0}`
        );
        break;
      case "facebook":
        // For Facebook Comments Scraper, don't set keywords (it uses startUrls from downstream posts)
        // For Facebook Posts Scraper (KoJrdxJCTtpon81KY), use URLs from brand directory
        // For Facebook Posts Search (TMBawM4LZpKN15DZX), use search terms (keywords + brand names)
        const isCommentsScraper = scraperName?.toLowerCase().includes("comments");
        if (!isCommentsScraper) {
          resolvedConfig = await this.resolveFacebookConfigPlaceholders(
            resolvedConfig,
            searchTerms,
            urls,
            projectId,
            scraper.actor_id,
            scraperName
          );
        } else {
          // For Comments scraper, just ensure startUrls exists (will be populated from downstream posts)
          if (!resolvedConfig.startUrls) {
            resolvedConfig.startUrls = [];
          }
        }
        break;
      case "discord": {
        const discordProjectIds = options?.discordMergeProjectIds?.length
          ? options.discordMergeProjectIds
          : [projectId];
        console.log(`🔍 DEBUG: Matched Discord case - calling resolveDiscordConfigPlaceholders`);
        try {
          resolvedConfig = await this.resolveDiscordConfigPlaceholders(
            resolvedConfig,
            keywords,
            discordProjectIds
          );
          console.log(
            `🔍 DEBUG: After resolveDiscordConfigPlaceholders - returned config has ${Array.isArray(resolvedConfig["scrapeMessages.channelUrl"]) ? resolvedConfig["scrapeMessages.channelUrl"].length : "NOT AN ARRAY"} channels`
          );
          console.log(
            `🔍 DEBUG: Config keys:`,
            Object.keys(resolvedConfig).filter((k) => k.includes("channel") || k.startsWith("_"))
          );
        } catch (error) {
          console.error(`❌ ERROR in resolveDiscordConfigPlaceholders:`, error);
          throw error;
        }
        break;
      }
      case "youtube": {
        // YouTube Comments Scraper reads from DownstreamPost (video URLs); do not resolve from brand directory
        const isYouTubeCommentsScraper =
          Boolean(scraper.url_input_source_scraper) &&
          (scraperName?.toLowerCase().includes("comment") ||
            scraper.actor_id === "p7UMdpQnjKmmpR21D");
        if (isYouTubeSourcesOnlyScraper) {
          resolvedConfig = await this.resolveYouTubeSourcesOnlyConfigPlaceholders(
            resolvedConfig,
            projectId,
            scraperName
          );
        } else if (!isYouTubeCommentsScraper) {
          resolvedConfig = await this.resolveYouTubeConfigPlaceholders(
            resolvedConfig,
            searchTerms,
            projectId,
            scraperName
          );
        } else {
          console.log(
            `🔍 DEBUG: YouTube Comments Scraper "${scraperName}" - will receive video URLs from DownstreamPost (${scraper.url_input_source_scraper})`
          );
          if (!resolvedConfig.startUrls || !Array.isArray(resolvedConfig.startUrls)) {
            resolvedConfig.startUrls = [];
          }
        }
        break;
      }
      default:
        console.log(
          `⚠️  WARNING: No specific placeholder resolution for platform: ${platform} (lowercase: ${platform.toLowerCase()})`
        );
    }

    // LinkedIn Post Scraper uses profile/company URLs only — no URLs means no Apify run
    const linkedInPostUrlLen = Array.isArray(resolvedConfig.urls) ? resolvedConfig.urls.length : 0;
    const linkedInPostStartLen = Array.isArray(resolvedConfig.startUrls)
      ? resolvedConfig.startUrls.length
      : 0;
    if (
      platform?.toLowerCase() === "linkedin" &&
      scraper.actor_id === "Wpp1BZ6yGWjySadk3" &&
      linkedInPostUrlLen === 0 &&
      linkedInPostStartLen === 0
    ) {
      console.warn(
        `[Orchestration] Skipping Apify for LinkedIn Post Scraper "${scraperName}": no LinkedIn URLs. ` +
          `Add LinkedIn profile URLs under the project (People & profiles → linkedin) and/or LinkedIn URLs on tracked brands.`
      );
      return [];
    }

    if (platform.toLowerCase() === "discord") {
      const v = resolvedConfig["scrapeMessages.channelUrl"];
      if (v === "" || v === undefined || v === null) {
        resolvedConfig["scrapeMessages.channelUrl"] = [];
      } else if (typeof v === "string" && v.trim()) {
        resolvedConfig["scrapeMessages.channelUrl"] = [v.trim()];
      } else if (typeof v === "string" && !v.trim()) {
        resolvedConfig["scrapeMessages.channelUrl"] = [];
      }
    }

    // Handle downstream-dependent scrapers (e.g., LinkedIn comments that consume staged post IDs)
    // CRITICAL: LinkedIn Comments scraper in Search orchestration should use postIds from DownstreamPost
    // The Search Scraper already filters by engagement >= 30 and saves to DownstreamPost
    // We extract postIds from those filtered results and send them to the Comments scraper
    const isLinkedInCommentsInSearchOrch =
      platform?.toLowerCase() === "linkedin" &&
      scraperName?.toLowerCase().includes("comment") &&
      scraper.url_input_source_scraper &&
      (scraper.url_input_source_scraper.toLowerCase().includes("search") ||
        scraper.url_input_source_scraper.toLowerCase().includes("keywords"));

    let downstreamIdentifiers: string[] = [];
    // YouTube Search scraper (h7sDV53CddomktSi5) uses project keywords; YouTube Search (sources) uses project URLs only; neither requires downstream
    const isYouTubeSearchScraper =
      platform?.toLowerCase() === "youtube" && scraper.actor_id === "h7sDV53CddomktSi5";
    const requiresDownstream =
      Boolean(scraper.url_input_field_name) &&
      Boolean(scraper.url_input_source_scraper) &&
      !isYouTubeSearchScraper &&
      !isYouTubeSourcesOnlyScraper;

    const isYouTubeCommentsOrchestration =
      platform?.toLowerCase() === "youtube" &&
      (scraperName?.toLowerCase().includes("comment") || scraper.actor_id === "p7UMdpQnjKmmpR21D");
    if (isYouTubeCommentsOrchestration) {
      console.log(
        `[YouTubeOrchestration] Comments step "${scraperName}" actor=${scraper.actor_id}: ` +
          `requiresDownstream=${requiresDownstream} url_input_field_name=${scraper.url_input_field_name ?? "(null)"} ` +
          `url_input_source_scraper=${scraper.url_input_source_scraper ?? "(null)"} ` +
          `isYouTubeSearchScraper=${isYouTubeSearchScraper} isYouTubeSourcesOnlyScraper=${isYouTubeSourcesOnlyScraper} ` +
          `orchestrationExecutionId=${orchestrationExecutionId ?? "(null)"}`
      );
      if (!requiresDownstream) {
        console.warn(
          `[YouTubeOrchestration] Comments scraper will NOT load video URLs from DownstreamPost — fix scraper config ` +
            `(set url_input_field_name + url_input_source_scraper matching the Search step scraper name), or Search step was misclassified as isYouTubeSearchScraper/isYouTubeSourcesOnlyScraper.`
        );
      }
    }

    // LinkedIn Comments scraper needs postIds from DownstreamPost (already filtered by engagement >= 20)
    // Don't skip downstream injection - let it use the normal downstream path
    if (requiresDownstream) {
      if (isLinkedInCommentsInSearchOrch) {
        console.log(
          `🔍 DEBUG: LinkedIn Comments scraper "${scraperName}" is part of a Search orchestration. Will use postIds from DownstreamPost (already filtered by engagement >= 30).`
        );
      }
      try {
        // For Facebook Comments Scraper, prefer URLs (needs full Facebook URLs)
        // For LinkedIn Comments Scraper in Search orchestration, use postIds (not URLs)
        // The Search Scraper saves postIds to DownstreamPost (filtered by engagement >= 30)
        // For other scrapers, prefer postIds (more reliable identifiers)
        // CRITICAL: Twitter Post Replies scraper needs full URLs, not postIds
        const fieldName = scraper.url_input_field_name as string;
        const isLinkedInCommentsFieldPostIds =
          platform?.toLowerCase() === "linkedin" &&
          scraperName?.toLowerCase().includes("comment") &&
          fieldName === "postIds";

        /** Search → Profile Posts: Apify expects profile URLs, not tweet postIds. Derive + dedupe by author. */
        const isXProfilePostsFromSearch =
          (platform?.toLowerCase() === "x" || platform?.toLowerCase() === "twitter") &&
          fieldName === "profileUrls" &&
          scraperName.toLowerCase().includes("profile posts");

        const preferUrls =
          (platform?.toLowerCase() === "facebook" &&
            scraperName?.toLowerCase().includes("comments")) ||
          // LinkedIn Comments scraper uses postIds when url_input_field_name is "postIds"
          (platform?.toLowerCase() === "linkedin" &&
            scraperName?.toLowerCase().includes("comment") &&
            !isLinkedInCommentsFieldPostIds) ||
          (platform?.toLowerCase() === "x" &&
            scraperName?.toLowerCase().includes("post replies")) ||
          // YouTube Comments Scraper needs video URLs from DownstreamPost
          (platform?.toLowerCase() === "youtube" &&
            (scraperName?.toLowerCase().includes("comment") ||
              scraper.actor_id === "p7UMdpQnjKmmpR21D"));

        downstreamIdentifiers = isXProfilePostsFromSearch
          ? await this.fetchXProfileUrlsFromDownstreamPosts(
              projectId,
              scraper.url_input_source_scraper as string,
              orchestrationExecutionId ?? undefined
            )
          : await this.fetchUrlsFromDownstreamPosts(
              projectId,
              scraper.url_input_source_scraper as string,
              preferUrls,
              orchestrationExecutionId ?? undefined
            );
        // YouTube Comments: if configured source (e.g. "YouTube Search") has no records, try "YouTube Scraper" so naming matches first step
        const isYouTubeCommentsScraper =
          platform?.toLowerCase() === "youtube" &&
          (scraperName?.toLowerCase().includes("comment") ||
            scraper.actor_id === "p7UMdpQnjKmmpR21D");
        if (
          downstreamIdentifiers.length === 0 &&
          isYouTubeCommentsScraper &&
          scraper.url_input_source_scraper
        ) {
          const fallback =
            (scraper.url_input_source_scraper as string).trim().toLowerCase() === "youtube search"
              ? "YouTube Scraper"
              : "YouTube Search";
          console.log(
            `🔍 DEBUG: YouTube Comments - no records from "${scraper.url_input_source_scraper}", trying fallback "${fallback}"`
          );
          downstreamIdentifiers = await this.fetchUrlsFromDownstreamPosts(
            projectId,
            fallback,
            preferUrls,
            orchestrationExecutionId ?? undefined
          );
        }
        console.log(
          `🔍 DEBUG: Downstream dependency for "${scraperName}" -> ${downstreamIdentifiers.length} identifier(s) from "${scraper.url_input_source_scraper}" ` +
            `(preferUrls: ${preferUrls}${isXProfilePostsFromSearch ? ", mode: unique X profile URLs" : ""})`
        );
      } catch (error) {
        console.error(`❌ Error fetching downstream identifiers for "${scraperName}":`, error);
        downstreamIdentifiers = [];
      }

      if (downstreamIdentifiers.length === 0) {
        const canRescueProfilePosts =
          scraper.actor_id === ApifyService.X_PROFILE_POSTS_ACTOR_ID &&
          orchestrationExecutionId &&
          (platform?.toLowerCase() === "x" || platform?.toLowerCase() === "twitter") &&
          scraper.url_input_field_name === "profileUrls";
        if (canRescueProfilePosts) {
          const rescued = await this.tryLoadXProfilePostsFromSearchExecution(
            projectId,
            orchestrationExecutionId,
            scraper.url_input_source_scraper
          );
          if (rescued.length > 0) {
            downstreamIdentifiers = rescued;
            console.log(
              `[startOrchestrationScrapingJob] X Profile Posts: rescued ${rescued.length} profile URL(s) after configured downstream source "${scraper.url_input_source_scraper}" returned 0 (name mismatch or empty).`
            );
          }
        }
      }

      if (downstreamIdentifiers.length === 0) {
        console.log(
          `⚠️  Skipping scraper "${scraperName}" because downstream source "${scraper.url_input_source_scraper}" returned no identifiers. ` +
            `projectId=${projectId} orchestrationExecutionId=${orchestrationExecutionId ?? "(null)"} ` +
            `(Downstream step needs PENDING DownstreamPost rows from the upstream step with matching origScraper and orchestration_execution_id — see fetchUrlsFromDownstreamPosts diagnostics above).`
        );
        return [];
      }

      // Inject downstream identifiers into the configured input field (replace placeholders if necessary)
      const fieldName = scraper.url_input_field_name as string;

      // CRITICAL: For X/Twitter Post Replies scraper, resolveXConfigPlaceholders already set postUrls with URLs
      // Don't overwrite it with postIds from the general downstream path
      const isXPostReplies =
        (platform?.toLowerCase() === "x" || platform?.toLowerCase() === "twitter") &&
        fieldName === "postUrls" &&
        Array.isArray(resolvedConfig.postUrls) &&
        resolvedConfig.postUrls.length > 0 &&
        typeof resolvedConfig.postUrls[0] === "string" &&
        resolvedConfig.postUrls[0].startsWith("http");

      // For Facebook Comments Scraper, format URLs as objects with { url: "..." } property
      // For LinkedIn Comments Scraper, format URLs as objects with { url: "..." } property
      // Many Apify scrapers expect startUrls to be an array of objects, not strings
      const isFacebookComments =
        platform?.toLowerCase() === "facebook" &&
        scraperName?.toLowerCase().includes("comments") &&
        fieldName === "startUrls";

      const isLinkedInComments =
        platform?.toLowerCase() === "linkedin" &&
        scraperName?.toLowerCase().includes("comment") &&
        fieldName === "startUrls";

      // YouTube Comments Scraper: receive array of video URLs (formatted as startUrls objects)
      const isYouTubeComments =
        platform?.toLowerCase() === "youtube" &&
        (scraperName?.toLowerCase().includes("comment") ||
          scraper.actor_id === "p7UMdpQnjKmmpR21D") &&
        (fieldName === "startUrls" || fieldName === "videoUrls" || fieldName === "urls");

      // Only skip for X Post Replies - LinkedIn Comments needs downstream postIds
      if (isXPostReplies) {
        console.log(
          `🔍 DEBUG: Skipping general downstream injection for X Post Replies - postUrls already set by resolveXConfigPlaceholders with ${resolvedConfig.postUrls.length} URLs`
        );
        // Continue to batching logic below, don't overwrite with downstream URLs
      } else {
        // Log before assignment
        console.log(
          `[startOrchestrationScrapingJob] Before injection - ${fieldName} type: ${typeof resolvedConfig[fieldName]}, value:`,
          resolvedConfig[fieldName]
        );

        let formattedIdentifiers: any[];
        if (isFacebookComments || isLinkedInComments || isYouTubeComments) {
          // Format as array of objects: [{ url: "..." }, { url: "..." }] for Comments scrapers
          formattedIdentifiers = downstreamIdentifiers.map((identifier) => ({
            url: identifier,
          }));
          console.log(
            `[startOrchestrationScrapingJob] Formatting ${downstreamIdentifiers.length} video URLs as array for ${isYouTubeComments ? "YouTube" : isFacebookComments ? "Facebook" : "LinkedIn"} Comments Scraper (field: ${fieldName})`
          );
        } else {
          // For other scrapers, use strings directly
          formattedIdentifiers = downstreamIdentifiers;
        }

        // Directly assign the array (this overwrites any placeholder string)
        resolvedConfig[fieldName] = formattedIdentifiers;

        // Log after assignment
        console.log(
          `[startOrchestrationScrapingJob] After injection - ${fieldName} type: ${typeof resolvedConfig[fieldName]}, isArray: ${Array.isArray(resolvedConfig[fieldName])}, length: ${Array.isArray(resolvedConfig[fieldName]) ? resolvedConfig[fieldName].length : "N/A"}, format: ${isFacebookComments ? "objects with url property" : "strings"}`
        );

        // Ensure it's an array (defensive check)
        if (!Array.isArray(resolvedConfig[fieldName])) {
          console.error(
            `[startOrchestrationScrapingJob] ⚠️  WARNING: ${fieldName} is not an array after assignment! Type: ${typeof resolvedConfig[fieldName]}, Value:`,
            resolvedConfig[fieldName]
          );
          resolvedConfig[fieldName] = formattedIdentifiers; // Force reassignment
        }
      }

      // CRITICAL: LinkedIn Comments Scraper has a limit of 100 items in postIds array
      // If we have more than 100, we need to batch them
      const isLinkedInCommentsWithPostIds =
        platform?.toLowerCase() === "linkedin" &&
        scraperName?.toLowerCase().includes("comment") &&
        fieldName === "postIds" &&
        Array.isArray(resolvedConfig[fieldName]) &&
        resolvedConfig[fieldName].length > 100;

      if (isLinkedInCommentsWithPostIds) {
        console.log(
          `[startOrchestrationScrapingJob] ⚠️  LinkedIn Comments Scraper has ${resolvedConfig[fieldName].length} postIds, but limit is 100. Will batch into chunks.`
        );
        // Store the full array for batching - we'll handle this after config resolution
        // For now, just log - batching will happen in the main logic below
      }
    } else if (
      scraper.actor_id === ApifyService.X_PROFILE_POSTS_ACTOR_ID &&
      orchestrationExecutionId &&
      (platform?.toLowerCase() === "x" || platform?.toLowerCase() === "twitter")
    ) {
      // Scraper admin often leaves url_input_field_name / url_input_source_scraper null; search rows would be ignored.
      const fromSearch = await this.tryLoadXProfilePostsFromSearchExecution(
        projectId,
        orchestrationExecutionId,
        scraper.url_input_source_scraper
      );
      if (fromSearch.length > 0) {
        resolvedConfig.profileUrls = fromSearch;
        console.log(
          `[startOrchestrationScrapingJob] X Profile Posts: profileUrls replaced with ${fromSearch.length} search-derived profile URL(s) (orchestration; scraper had requiresDownstream=false).`
        );
      } else {
        console.warn(
          `[startOrchestrationScrapingJob] X Profile Posts: no PENDING X DownstreamPost rows for execution ${orchestrationExecutionId}; ` +
            `keeping placeholder profileUrls (project/brand only). Set url_input_field_name=profileUrls and url_input_source_scraper to your Twitter Search scraper name if this persists.`
        );
      }
    }

    // Log dependent scrapers for debugging
    if (
      scraperName.includes("Post Replies") ||
      scraperName.includes("Profile Posts") ||
      requiresDownstream
    ) {
      console.log(`🔍 DEBUG: ${scraperName} - Dependent scraper detected`);
      if (resolvedConfig.postUrls) {
        console.log(`🔍 DEBUG: postUrls in config:`, resolvedConfig.postUrls);
      }
      if (requiresDownstream) {
        console.log(
          `🔍 DEBUG: ${scraperName} - ${scraper.url_input_field_name} count: ${downstreamIdentifiers.length}`
        );
      }
    }

    console.log(
      `Starting orchestration scraper "${scraperName}" with resolved config:`,
      JSON.stringify(resolvedConfig, null, 2)
    );

    // For LinkedIn Posts Search (5QnEH5N71IK2mFLrP), iterate over searchTerms (keywords + brand names)
    const termsForLinkedInIteration =
      scraper.actor_id === "5QnEH5N71IK2mFLrP" ? searchTerms : keywords;
    const normalizedKeywords = Array.from(
      new Set(
        termsForLinkedInIteration
          .map((keyword) => (keyword || "").trim())
          .filter((keyword) => keyword.length > 0)
      )
    );

    // Check if this is the new LinkedIn Post Scraper (uses URLs only, no keywords)
    const isNewLinkedInPostScraper = scraper.actor_id === "Wpp1BZ6yGWjySadk3";

    // CRITICAL: LinkedIn Comments scraper in Search orchestration should use postIds from DownstreamPost, NOT keywords
    // Only use keywords if it doesn't have url_input_field_name (meaning it's not downstream-dependent)
    // If it has url_input_field_name, it should use downstream postIds (which are already filtered by engagement >= 30)
    if (
      platform.toLowerCase() === "linkedin" &&
      !scraper.url_input_field_name &&
      !isNewLinkedInPostScraper
    ) {
      const jobIds: string[] = [];

      if (normalizedKeywords.length === 0) {
        console.warn(
          `⚠️ LinkedIn scraper "${scraperName}" skipped: no keywords or brand names after placeholder resolution ` +
            `(linked search actors use project Keywords + tracked brand names). Add keywords/brands or use profile-based LinkedIn Post Scraper.`
        );
        return [];
      }

      console.log(
        `🔁 LinkedIn scraper "${scraperName}" will run ${normalizedKeywords.length} iteration(s):`,
        normalizedKeywords
      );

      for (const keyword of normalizedKeywords) {
        if (ApifyService.stopRequested) {
          console.log(
            `🛑 Stop requested - halting before launching LinkedIn keyword "${keyword}" for ${scraperName}`
          );
          break;
        }

        const freshConfig = JSON.parse(scraper.config_json);

        // Remove placeholder values (only for keyword-based scrapers, not downstream-dependent ones)
        if (freshConfig.postIds === "{{postIds}}" || freshConfig.postIds === "{{postIds}}") {
          delete freshConfig.postIds;
        }
        if (freshConfig.startUrls === "{{startUrls}}" || freshConfig.startUrls === "{{urls}}") {
          delete freshConfig.startUrls;
        }

        const perKeywordConfig = await this.resolveLinkedInConfigPlaceholders(
          freshConfig,
          [keyword],
          projectId,
          scraper.actor_id,
          scraperName
        );

        // Remove placeholder values that weren't resolved (only for keyword-based scrapers)
        if (
          typeof perKeywordConfig.postIds === "string" &&
          perKeywordConfig.postIds.includes("{{")
        ) {
          console.log(
            `🔍 DEBUG: Removing unresolved postIds placeholder from config for keyword "${keyword}"`
          );
          delete perKeywordConfig.postIds;
        }
        if (
          typeof perKeywordConfig.startUrls === "string" &&
          perKeywordConfig.startUrls.includes("{{")
        ) {
          console.log(
            `🔍 DEBUG: Removing unresolved startUrls placeholder from config for keyword "${keyword}"`
          );
          delete perKeywordConfig.startUrls;
        }

        delete perKeywordConfig.timeoutSecs;

        console.log(
          `🚀 DEBUG: Calling Apify API with actor ID: ${scraper.actor_id} for keyword "${keyword}"`
        );
        console.log(
          `🔧 DEBUG: Request body for keyword "${keyword}" (after postIds/startUrls removal):`,
          JSON.stringify(perKeywordConfig, null, 2)
        );

        try {
          console.log(`🔍 DEBUG: Getting timeout and base URL for keyword "${keyword}"...`);
          const keywordTimeoutSecs = await this.getTimeoutForPlatform(platform);
          const baseUrl = await this.getBaseUrl();
          console.log(
            `🔍 DEBUG: Got timeout: ${keywordTimeoutSecs}s, baseUrl: ${baseUrl} for keyword "${keyword}"`
          );

          console.log(`🔍 DEBUG: About to call fetch for keyword "${keyword}"...`);
          console.log(
            `🔍 DEBUG: Fetch URL: ${baseUrl}/acts/${scraper.actor_id}/runs?timeout=${keywordTimeoutSecs}`
          );
          console.log(`🔍 DEBUG: Has API token: ${!!process.env.APIFY_API_TOKEN}`);

          let response;
          try {
            response = await fetch(
              `${baseUrl}/acts/${scraper.actor_id}/runs?timeout=${keywordTimeoutSecs}`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${process.env.APIFY_API_TOKEN}`,
                },
                body: JSON.stringify(perKeywordConfig),
              }
            );
            console.log(
              `🔍 DEBUG: Fetch completed for keyword "${keyword}", status: ${response.status}`
            );

            if (!response.ok) {
              // Log the status immediately
              console.error(
                `❌ HTTP ${response.status} - Failed to start LinkedIn scraper ${scraperName} (keyword "${keyword}")`
              );

              // Try to get error response body
              let errorText = "";
              let errorData = null;
              try {
                const clonedResponse = response.clone();
                errorText = await clonedResponse.text();
                console.error(`❌ Error response body (raw):`, errorText.substring(0, 1000));

                // Try to parse as JSON
                try {
                  errorData = JSON.parse(errorText);
                  console.error(
                    `❌ Error response body (parsed):`,
                    JSON.stringify(errorData, null, 2)
                  );
                } catch {
                  console.error(
                    `❌ Error response is not JSON. Raw text:`,
                    errorText.substring(0, 500)
                  );
                }
              } catch (textError) {
                console.error(`❌ Failed to read error response body:`, textError);
              }

              console.error(`❌ Response headers:`, Object.fromEntries(response.headers.entries()));

              const errorMessage =
                errorData?.error?.message ||
                errorData?.message ||
                errorText.substring(0, 200) ||
                "Unknown error";
              throw new Error(
                `Failed to start LinkedIn scraper ${scraperName} (keyword "${keyword}"): HTTP ${response.status} - ${errorMessage}`
              );
            }
          } catch (fetchError) {
            // If it's already our custom error, just re-throw (it's already logged above)
            if (
              fetchError instanceof Error &&
              fetchError.message.includes("Failed to start LinkedIn scraper")
            ) {
              throw fetchError;
            }

            // Otherwise, it's a network/fetch error
            console.error(`❌ FETCH ERROR for keyword "${keyword}":`, fetchError);
            console.error(`❌ FETCH ERROR type:`, typeof fetchError);
            console.error(
              `❌ FETCH ERROR message:`,
              fetchError instanceof Error ? fetchError.message : String(fetchError)
            );
            console.error(
              `❌ FETCH ERROR stack:`,
              fetchError instanceof Error ? fetchError.stack : "No stack"
            );
            throw fetchError;
          }

          let result;
          try {
            result = await response.json();
          } catch (parseError) {
            const text = await response.text();
            console.error(
              `❌ Failed to parse JSON response from Apify for LinkedIn scraper ${scraperName} (keyword "${keyword}"):`,
              parseError,
              `Response text: ${text.substring(0, 500)}`
            );
            throw new Error(
              `Failed to parse response from Apify for LinkedIn scraper ${scraperName} (keyword "${keyword}"): ${parseError instanceof Error ? parseError.message : "Unknown parse error"}`
            );
          }

          const jobId = result.data?.id;

          if (!jobId) {
            console.error(
              `❌ No job ID in Apify response for LinkedIn scraper ${scraperName} (keyword "${keyword}"):`,
              result
            );
            throw new Error(
              `No job ID returned from Apify for LinkedIn scraper ${scraperName} (keyword "${keyword}"). Response: ${JSON.stringify(result).substring(0, 500)}`
            );
          }

          console.log(
            `✅ Started LinkedIn scraper "${scraperName}" for keyword "${keyword}" with job ID: ${jobId}`
          );
          jobIds.push(jobId);
        } catch (error) {
          // Log the full error details before re-throwing
          console.error(
            `❌ Exception while starting LinkedIn scraper ${scraperName} (keyword "${keyword}"):`,
            error instanceof Error ? error.message : String(error),
            error instanceof Error ? error.stack : undefined
          );
          throw error; // Re-throw to be caught by the orchestration executor
        }
      }

      return jobIds;
    }

    // Timeout is handled via query parameter, not request body
    const requestBody = { ...resolvedConfig };

    // CRITICAL: LinkedIn Comments Scraper has a limit of 100 items in postIds array
    // Batch postIds if they exceed 100
    const isLinkedInCommentsWithPostIds =
      platform?.toLowerCase() === "linkedin" &&
      scraperName?.toLowerCase().includes("comment") &&
      Array.isArray(resolvedConfig.postIds) &&
      resolvedConfig.postIds.length > 100;

    if (isLinkedInCommentsWithPostIds) {
      const postIds = resolvedConfig.postIds;
      const MAX_POSTIDS_PER_RUN = 100;
      const chunks: string[][] = [];

      for (let i = 0; i < postIds.length; i += MAX_POSTIDS_PER_RUN) {
        chunks.push(postIds.slice(i, i + MAX_POSTIDS_PER_RUN));
      }

      console.log(
        `[startOrchestrationScrapingJob] ⚠️  LinkedIn Comments Scraper has ${postIds.length} postIds, batching into ${chunks.length} chunks of max ${MAX_POSTIDS_PER_RUN}`
      );

      const jobIds: string[] = [];

      for (let i = 0; i < chunks.length; i++) {
        if (ApifyService.stopRequested) {
          console.log(
            `🛑 Stop requested - halting before starting LinkedIn Comments batch ${i + 1}/${chunks.length}`
          );
          break;
        }

        const chunkConfig = { ...resolvedConfig };
        chunkConfig.postIds = chunks[i];

        const chunkRequestBody: any = { ...chunkConfig };
        delete chunkRequestBody.timeoutSecs;

        console.log(
          `🚀 DEBUG: Calling Apify API for LinkedIn Comments batch ${i + 1}/${chunks.length} with ${chunks[i].length} postIds`
        );

        const timeoutSecs = await this.getTimeoutForPlatform(platform);
        const baseUrl = await this.getBaseUrl();
        const response = await fetch(
          `${baseUrl}/acts/${scraper.actor_id}/runs?timeout=${timeoutSecs}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.APIFY_API_TOKEN}`,
            },
            body: JSON.stringify(chunkRequestBody),
          }
        );

        if (!response.ok) {
          const errorData = await response.json();
          console.error(
            `❌ HTTP ${response.status} - Failed to start LinkedIn Comments scraper ${scraperName} (batch ${i + 1}/${chunks.length}):`,
            errorData
          );
          console.error(`❌ Response headers:`, Object.fromEntries(response.headers.entries()));
          throw new Error(
            `Failed to start LinkedIn Comments scraper ${scraperName} (batch ${i + 1}/${chunks.length}): ${errorData.error?.message || "Unknown error"}`
          );
        }

        const result = await response.json();
        const jobId = result.data.id;

        if (!jobId) {
          throw new Error(
            `No job ID returned from Apify for LinkedIn Comments scraper ${scraperName} (batch ${i + 1}/${chunks.length})`
          );
        }

        console.log(
          `✅ Started LinkedIn Comments scraper "${scraperName}" (batch ${i + 1}/${chunks.length}) with job ID: ${jobId}`
        );

        // Don't wait here - let StepExecutor handle waiting for all batches
        // This allows proper logging and progress tracking
        jobIds.push(jobId);
      }

      return jobIds;
    }

    // CRITICAL: Ensure startUrls is an array if it exists (for Facebook Comments Scraper)
    // This must happen BEFORE batching logic
    if (requestBody.startUrls !== undefined) {
      if (!Array.isArray(requestBody.startUrls)) {
        console.error(
          `[CRITICAL] startUrls is not an array in initial config! Type: ${typeof requestBody.startUrls}, Value:`,
          requestBody.startUrls
        );
        // Try to fix it - if it's a string, try to parse it, otherwise set to empty array
        if (typeof requestBody.startUrls === "string") {
          try {
            const parsed = JSON.parse(requestBody.startUrls);
            if (Array.isArray(parsed)) {
              requestBody.startUrls = parsed;
              console.log(`[FIXED] Parsed startUrls from string to array in initial config`);
            } else {
              console.error(`[ERROR] Parsed string is not an array, setting to empty array`);
              requestBody.startUrls = [];
            }
          } catch {
            console.error(`[ERROR] Failed to parse startUrls string, setting to empty array`);
            requestBody.startUrls = [];
          }
        } else {
          console.error(`[ERROR] startUrls is not string or array, setting to empty array`);
          requestBody.startUrls = [];
        }
      }
    }

    // Special batching for X replies/profile posts scrapers when postUrls/profileUrls exceed API limits
    // Also batch Discord channels and Facebook keywords
    const jobIds: string[] = [];
    const pl = platform.toLowerCase();
    // Only treat postUrls/profileUrls as batch drivers for the platforms that use them. Discord configs
    // sometimes include postUrls: [] (or leftover arrays); that must NOT win over scrapeMessages.channelUrl
    // or we only iterate min(postUrls.length, discord channels) and drop channels (e.g. 5 postUrls vs 9 Discord).
    const isPostReplies =
      (pl === "x" || pl === "twitter") && Array.isArray(resolvedConfig.postUrls);
    const isProfilePosts =
      (pl === "x" || pl === "twitter") && Array.isArray((resolvedConfig as any).profileUrls);
    const isDiscord =
      pl === "discord" && Array.isArray(resolvedConfig["scrapeMessages.channelUrl"]);
    // Check if this is Facebook Posts Search (uses keywords) vs Facebook Comments (uses startUrls) vs Facebook Posts Scraper (uses startUrls from brands)
    // Facebook Posts Search: has keywords array AND (no startUrls OR empty startUrls array)
    // Facebook Comments: has populated startUrls array (from downstream posts)
    // Facebook Posts Scraper: has populated startUrls array (from brand directory)
    const hasKeywords =
      Array.isArray(resolvedConfig.keywords) && resolvedConfig.keywords.length > 0;
    const hasStartUrls =
      Array.isArray(resolvedConfig.startUrls) && resolvedConfig.startUrls.length > 0;
    const isFacebookPostsScraper =
      platform.toLowerCase() === "facebook" && scraper.actor_id === "KoJrdxJCTtpon81KY";
    const isFacebookPostsSearch =
      platform.toLowerCase() === "facebook" &&
      hasKeywords &&
      !hasStartUrls &&
      !isFacebookPostsScraper; // Only true if keywords exist but startUrls is empty/missing and not the Posts Scraper
    const isFacebookComments =
      platform.toLowerCase() === "facebook" && hasStartUrls && !isFacebookPostsScraper; // Only true if startUrls is populated and not the Posts Scraper
    const isFacebookPosts =
      platform.toLowerCase() === "facebook" && hasStartUrls && isFacebookPostsScraper; // Facebook Posts Scraper with URLs
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const isFacebook = isFacebookPostsSearch || isFacebookComments || isFacebookPosts;

    console.log(
      `🔍 DEBUG: Batching check - isPostReplies: ${isPostReplies}, postUrls length: ${resolvedConfig.postUrls?.length || 0}, isDiscord: ${isDiscord}, discordChannels: ${isDiscord ? resolvedConfig["scrapeMessages.channelUrl"]?.length || 0 : 0}, isFacebookPostsSearch: ${isFacebookPostsSearch}, facebookKeywords: ${isFacebookPostsSearch ? resolvedConfig.keywords?.length || 0 : 0}, isFacebookComments: ${isFacebookComments}, isFacebookPostsScraper: ${isFacebookPosts}, startUrls length: ${isFacebookComments || isFacebookPosts ? resolvedConfig.startUrls?.length || 0 : 0}, scraperName: ${scraperName}`
    );

    const MAX_URLS_PER_RUN = 5;
    const MAX_DISCORD_CHANNELS_PER_RUN = 1; // Process Discord channels one at a time
    const MAX_FACEBOOK_KEYWORDS_PER_RUN = 1; // Process Facebook keywords one at a time
    // Facebook Comments Scraper and Facebook Posts Scraper should NOT be batched - they can handle all URLs in one run
    // Only batch Facebook Posts Search (keywords) and other scrapers
    if (
      (isPostReplies && resolvedConfig.postUrls.length > MAX_URLS_PER_RUN) ||
      (isProfilePosts && (resolvedConfig as any).profileUrls.length > MAX_URLS_PER_RUN) ||
      (isDiscord &&
        resolvedConfig["scrapeMessages.channelUrl"].length > MAX_DISCORD_CHANNELS_PER_RUN) ||
      (isFacebookPostsSearch && resolvedConfig.keywords.length > MAX_FACEBOOK_KEYWORDS_PER_RUN)
    ) {
      const allUrls: string[] = isDiscord
        ? (resolvedConfig["scrapeMessages.channelUrl"] as string[])
        : isPostReplies
          ? resolvedConfig.postUrls
          : isProfilePosts
            ? (resolvedConfig as any).profileUrls
            : isFacebookPostsSearch
              ? resolvedConfig.keywords
              : [];
      const chunkSize = isDiscord
        ? MAX_DISCORD_CHANNELS_PER_RUN
        : isFacebookPostsSearch
          ? MAX_FACEBOOK_KEYWORDS_PER_RUN
          : MAX_URLS_PER_RUN;
      console.log(
        `🔍 DEBUG: Batching ${allUrls.length} items into chunks of ${chunkSize} for ${scraperName}`
      );

      // For Twitter Post Replies scraper, we previously ran batches in parallel to speed up execution.
      // However, this could trigger Scraper service / X rate limits and produce zero-result runs.
      // To reduce the chance of rate limiting, we now run ALL batches sequentially.
      const runBatchesInParallel = false;

      if (runBatchesInParallel) {
        console.log(`🚀 Running ${scraperName} batches in PARALLEL mode for faster execution`);

        // Collect all batch configurations first
        const batchConfigs: Array<{ batchNumber: number; chunk: any[]; chunkRequestBody: any }> =
          [];
        for (let i = 0; i < allUrls.length; i += chunkSize) {
          if (ApifyService.stopRequested) {
            console.log(
              `🛑 Stop requested - halting before preparing batch ${Math.floor(i / chunkSize) + 1} for ${scraperName}`
            );
            break;
          }
          const chunk = allUrls.slice(i, i + chunkSize);
          const chunkConfig = { ...resolvedConfig } as any;
          chunkConfig.postUrls = chunk;

          const chunkRequestBody: any = { ...chunkConfig };
          delete chunkRequestBody.timeoutSecs;

          batchConfigs.push({
            batchNumber: Math.floor(i / chunkSize) + 1,
            chunk,
            chunkRequestBody,
          });
        }

        // Start all batches in parallel
        const timeoutSecs = await this.getTimeoutForPlatform(platform);
        const baseUrl = await this.getBaseUrl();

        console.log(`🚀 Starting ${batchConfigs.length} batches in parallel for ${scraperName}`);

        const batchPromises = batchConfigs.map(async ({ batchNumber, chunkRequestBody }) => {
          if (ApifyService.stopRequested) {
            throw new Error("Stop requested");
          }

          console.log(
            `🚀 DEBUG: Calling Apify API with actor ID: ${scraper.actor_id} (batch ${batchNumber})`
          );
          console.log(
            `🔧 DEBUG: ACTUAL request body being sent (batch ${batchNumber}):`,
            JSON.stringify(chunkRequestBody, null, 2)
          );

          if (platform.toLowerCase() === "discord") {
            this.finalizeDiscordApifyInput(chunkRequestBody, "discord");
          }

          const response = await fetch(
            `${baseUrl}/acts/${scraper.actor_id}/runs?timeout=${timeoutSecs}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.APIFY_API_TOKEN}`,
              },
              body: JSON.stringify(chunkRequestBody),
            }
          );

          if (!response.ok) {
            const errorData = await response.json();
            console.error(
              `❌ HTTP ${response.status} - Failed to start scraper ${scraperName} (batch ${batchNumber}):`,
              errorData
            );
            throw new Error(
              `Failed to start scraper ${scraperName} (batch ${batchNumber}): ${errorData.error?.message || "Unknown error"}`
            );
          }

          console.log(
            `✅ HTTP ${response.status} - Successfully started scraper ${scraperName} (batch ${batchNumber})`
          );
          const result = await response.json();
          const jobId = result.data.id;
          if (!jobId) {
            throw new Error(
              `No job ID returned from Apify for scraper ${scraperName} (batch ${batchNumber})`
            );
          }
          console.log(
            `🔍 DEBUG: Started ${scraperName} (batch ${batchNumber}) with job ID: ${jobId}`
          );

          return { batchNumber, jobId };
        });

        // Wait for all batches to start (collect job IDs)
        const batchResults = await Promise.allSettled(batchPromises);
        const startedBatches: Array<{ batchNumber: number; jobId: string }> = [];
        const failedBatches: Array<{ batchNumber: number; error: string }> = [];

        batchResults.forEach((result, index) => {
          if (result.status === "fulfilled") {
            startedBatches.push(result.value);
            jobIds.push(result.value.jobId);
          } else {
            const batchNumber = batchConfigs[index]?.batchNumber || index + 1;
            const error = result.reason instanceof Error ? result.reason.message : "Unknown error";
            failedBatches.push({ batchNumber, error });
            console.error(`❌ Failed to start batch ${batchNumber}:`, error);
          }
        });

        console.log(
          `✅ Started ${startedBatches.length}/${batchConfigs.length} batches in parallel for ${scraperName}`
        );
        if (failedBatches.length > 0) {
          console.error(
            `❌ Failed to start ${failedBatches.length} batches:`,
            failedBatches.map((b) => `batch ${b.batchNumber}: ${b.error}`).join(", ")
          );
        }

        // For parallel batches, return jobIds immediately after starting
        // The orchestration executor will wait for completion and process datasets in parallel
        // This avoids double-waiting (once here for status, once in executor for data processing)
        console.log(
          `✅ Started ${startedBatches.length}/${batchConfigs.length} batches in parallel for ${scraperName}. Orchestration executor will process datasets in parallel.`
        );
      } else {
        // Sequential execution for other scrapers
        for (let i = 0; i < allUrls.length; i += chunkSize) {
          if (ApifyService.stopRequested) {
            console.log(
              `🛑 Stop requested - halting before starting batch ${Math.floor(i / chunkSize) + 1} for ${scraperName}`
            );
            break;
          }
          const chunk = allUrls.slice(i, i + chunkSize);
          const chunkConfig = { ...resolvedConfig } as any;

          // Declare Discord channel URL outside the if block for batch logging
          let channelUrl: string | undefined;

          if (isPostReplies) {
            chunkConfig.postUrls = chunk;
          } else if (isProfilePosts) {
            chunkConfig.profileUrls = chunk;
          } else if (isDiscord) {
            // For Discord, we need to run once per channel (Discord scraper expects single URL)
            // This will be handled in the loop - each iteration processes one channel
            channelUrl = chunk[0];
            chunkConfig["scrapeChannelMembers.channelUrl"] = channelUrl;
            chunkConfig["scrapeMessages.channelUrl"] = channelUrl;
            chunkConfig.channelUrl = channelUrl;

            console.log(`\n📋 Discord Channel ${Math.floor(i / chunkSize) + 1} (Batch Mode)`);
            console.log(`   Channel URL: ${channelUrl}`);

            console.log(
              `   ℹ️  Message count (count): ${chunkConfig.count ?? "not set"} (from scraper config_json)`
            );
          } else if (isFacebookPostsSearch) {
            // For Facebook Posts Search, we need to run once per keyword (Facebook scraper expects single keyword)
            // This will be handled in the loop - each iteration processes one keyword
            chunkConfig.query = chunk[0];
            delete chunkConfig.keywords; // Remove the keywords array since we're using single keyword
          }
          // Note: Facebook Comments Scraper should NOT enter this batching block - it uses startUrls, not keywords
          const chunkRequestBody: any = { ...chunkConfig };
          // Remove timeoutSecs from request body - it should only be in URL parameter
          delete chunkRequestBody.timeoutSecs;

          // CRITICAL: Ensure startUrls is an array if it exists (for Facebook Comments Scraper)
          if (chunkRequestBody.startUrls !== undefined) {
            if (!Array.isArray(chunkRequestBody.startUrls)) {
              console.error(
                `[CRITICAL] startUrls is not an array! Type: ${typeof chunkRequestBody.startUrls}, Value:`,
                chunkRequestBody.startUrls
              );
              // Try to fix it - if it's a string, try to parse it, otherwise set to empty array
              if (typeof chunkRequestBody.startUrls === "string") {
                try {
                  const parsed = JSON.parse(chunkRequestBody.startUrls);
                  if (Array.isArray(parsed)) {
                    chunkRequestBody.startUrls = parsed;
                    console.log(`[FIXED] Parsed startUrls from string to array`);
                  } else {
                    console.error(`[ERROR] Parsed string is not an array, setting to empty array`);
                    chunkRequestBody.startUrls = [];
                  }
                } catch {
                  console.error(`[ERROR] Failed to parse startUrls string, setting to empty array`);
                  chunkRequestBody.startUrls = [];
                }
              } else {
                console.error(`[ERROR] startUrls is not string or array, setting to empty array`);
                chunkRequestBody.startUrls = [];
              }
            }
          }

          console.log(`🚀 DEBUG: Calling Apify API with actor ID: ${scraper.actor_id}`);
          console.log(
            `🔧 DEBUG: ACTUAL request body being sent (batch ${Math.floor(i / chunkSize) + 1}):`,
            JSON.stringify(chunkRequestBody, null, 2)
          );
          console.log(
            `🔧 DEBUG: startUrls type check - isArray: ${Array.isArray(chunkRequestBody.startUrls)}, type: ${typeof chunkRequestBody.startUrls}, length: ${Array.isArray(chunkRequestBody.startUrls) ? chunkRequestBody.startUrls.length : "N/A"}`
          );

          // Validate URLs in startUrls array
          // For Facebook Comments Scraper, URLs are objects with { url: "..." } format
          if (Array.isArray(chunkRequestBody.startUrls)) {
            console.log(
              `🔍 DEBUG: Validating ${chunkRequestBody.startUrls.length} URLs in startUrls...`
            );
            const invalidUrls: number[] = [];
            chunkRequestBody.startUrls.forEach((urlItem: any, idx: number) => {
              // Handle both string format and object format { url: "..." }
              const urlString = typeof urlItem === "string" ? urlItem : urlItem?.url || "";
              if (!urlString || typeof urlString !== "string" || !urlString.trim()) {
                invalidUrls.push(idx);
                console.error(
                  `[URL Validation] ❌ Invalid URL at index ${idx}: type=${typeof urlItem}, value="${urlItem}"`
                );
              } else {
                try {
                  const urlObj = new URL(urlString.trim());
                  if (!urlObj.protocol || !urlObj.protocol.startsWith("http")) {
                    invalidUrls.push(idx);
                    console.error(
                      `[URL Validation] ❌ Invalid URL at index ${idx}: missing or invalid protocol, value="${urlString}"`
                    );
                  } else {
                    console.log(
                      `[URL Validation] ✅ Valid URL at index ${idx}: ${urlString.substring(0, 60)}...`
                    );
                  }
                } catch {
                  invalidUrls.push(idx);
                  console.error(
                    `[URL Validation] ❌ Invalid URL at index ${idx}: not a valid URL format, value="${urlString}"`
                  );
                }
              }
            });

            if (invalidUrls.length > 0) {
              console.error(
                `[URL Validation] ⚠️  Found ${invalidUrls.length} invalid URLs at indices: ${invalidUrls.join(", ")}`
              );
              console.error(
                `[URL Validation] Sample invalid URLs:`,
                invalidUrls.slice(0, 3).map((idx) => chunkRequestBody.startUrls[idx])
              );
            } else {
              console.log(
                `[URL Validation] ✅ All ${chunkRequestBody.startUrls.length} URLs are valid`
              );
            }
          }

          // Set timeout in the API call options instead of request body
          const timeoutSecs = await this.getTimeoutForPlatform(platform);
          console.log(
            `⏱️ DEBUG: Orchestration batch timeout - Platform: ${platform}, Timeout: ${timeoutSecs} seconds (${timeoutSecs / 60} minutes)`
          );

          if (isDiscord) {
            this.finalizeDiscordApifyInput(chunkRequestBody, "discord");
          }

          const baseUrl = await this.getBaseUrl();
          const response = await fetch(
            `${baseUrl}/acts/${scraper.actor_id}/runs?timeout=${timeoutSecs}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.APIFY_API_TOKEN}`,
              },
              body: JSON.stringify(chunkRequestBody),
            }
          );

          if (!response.ok) {
            const errorData = await response.json();
            console.error(
              `❌ HTTP ${response.status} - Failed to start scraper ${scraperName} (batch ${Math.floor(i / chunkSize) + 1}):`,
              errorData
            );
            console.error(`❌ Response headers:`, Object.fromEntries(response.headers.entries()));
            throw new Error(
              `Failed to start scraper ${scraperName} (batch ${Math.floor(i / chunkSize) + 1}): ${errorData.error?.message || "Unknown error"}`
            );
          }

          console.log(
            `✅ HTTP ${response.status} - Successfully started scraper ${scraperName} (batch ${Math.floor(i / chunkSize) + 1})`
          );
          const result = await response.json();
          const jobId = result.data.id;
          if (!jobId) {
            throw new Error(
              `No job ID returned from Apify for scraper ${scraperName} (batch ${Math.floor(i / chunkSize) + 1})`
            );
          }
          console.log(
            `🔍 DEBUG: Started ${scraperName} (batch ${Math.floor(i / chunkSize) + 1}) with job ID: ${jobId}`
          );
          console.log(`🔍 DEBUG: Full result from Apify:`, JSON.stringify(result, null, 2));

          // Stagger: wait for this batch to complete before launching next
          try {
            await this.waitForRunCompletion(
              jobId,
              `${scraperName} (batch ${Math.floor(i / chunkSize) + 1})`
            );
          } catch (e) {
            const batchNum = Math.floor(i / chunkSize) + 1;
            console.error(`❌ Batch ${batchNum} failed:`, (e as Error).message);
            console.warn(
              `[ApifyService] Batch ${batchNum} run ${jobId} may still be running on Apify; ` +
                `status polling hit a network/timeout error. Next batch will still start.`
            );
            // Continue to next batch
          }

          jobIds.push(jobId);
        }
      }

      return jobIds;
    }

    // Special iterative execution for Discord scrapers - run one job per channel URL
    if (isDiscord) {
      console.log(`🔍 DEBUG: Checking Discord scraper configuration...`);
      console.log(
        `   scrapeMessages.channelUrl type: ${typeof resolvedConfig["scrapeMessages.channelUrl"]}`
      );
      console.log(
        `   scrapeMessages.channelUrl is array: ${Array.isArray(resolvedConfig["scrapeMessages.channelUrl"])}`
      );
      console.log(
        `   scrapeMessages.channelUrl value:`,
        resolvedConfig["scrapeMessages.channelUrl"]
      );

      if (!Array.isArray(resolvedConfig["scrapeMessages.channelUrl"])) {
        console.error(
          `❌ ERROR: Discord scraper - scrapeMessages.channelUrl is not an array! Type: ${typeof resolvedConfig["scrapeMessages.channelUrl"]}, Value:`,
          resolvedConfig["scrapeMessages.channelUrl"]
        );
        throw new Error(
          `Discord scraper configuration error: scrapeMessages.channelUrl must be an array. Got: ${typeof resolvedConfig["scrapeMessages.channelUrl"]}`
        );
      }

      if (resolvedConfig["scrapeMessages.channelUrl"].length === 0) {
        console.warn(
          `⚠️  WARNING: Discord scraper - No channel URLs found. Skipping Discord scraper.`
        );
        return [];
      }

      const discordUrls = resolvedConfig["scrapeMessages.channelUrl"];

      console.log(
        `✅ DEBUG: Running Discord scraper iteratively for ${discordUrls.length} channel URLs`
      );

      for (let i = 0; i < discordUrls.length; i++) {
        if (ApifyService.stopRequested) {
          console.log(
            `🛑 Stop requested - halting before starting Discord channel ${i + 1}/${discordUrls.length}`
          );
          break;
        }
        const channelUrl = discordUrls[i];

        console.log(`\n📋 Discord Channel ${i + 1}/${discordUrls.length}`);
        console.log(`   Channel URL: ${channelUrl}`);

        // Create a clean config for this single channel
        const discordConfig: any = {};
        // Copy relevant fields from resolvedConfig (but not the array URLs)
        Object.keys(resolvedConfig).forEach((key) => {
          if (!key.includes("channelUrl") && key !== "_discordProfileId") {
            discordConfig[key] = resolvedConfig[key];
          }
        });

        // Set single channel URL (not array)
        discordConfig["scrapeMessages.channelUrl"] = channelUrl;
        discordConfig["scrapeChannelMembers.channelUrl"] = channelUrl;
        discordConfig.channelUrl = channelUrl;

        console.log(
          `   ℹ️  Message count (count): ${discordConfig.count ?? "not set"} (from scraper config_json)`
        );

        const discordRequestBody: any = { ...discordConfig };

        console.log(`   📤 Sending to Apify:`);
        console.log(`      - Actor ID: ${scraper.actor_id}`);
        console.log(
          `      - scrapeMessages.channelUrl: ${discordRequestBody["scrapeMessages.channelUrl"]}`
        );
        console.log(`      - channelUrl (actor): ${discordRequestBody["channelUrl"]}`);
        console.log(`   🔧 Full request body:`, JSON.stringify(discordRequestBody, null, 2));

        this.finalizeDiscordApifyInput(discordRequestBody, "discord");

        // Set timeout for Discord scrapers
        const discordTimeoutSecs = await this.getTimeoutForPlatform("discord");
        console.log(
          `⏱️ DEBUG: Orchestration Discord timeout - Timeout: ${discordTimeoutSecs} seconds (${discordTimeoutSecs / 60} minutes)`
        );

        const baseUrl = await this.getBaseUrl();
        const response = await fetch(
          `${baseUrl}/acts/${scraper.actor_id}/runs?timeout=${discordTimeoutSecs}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.APIFY_API_TOKEN}`,
            },
            body: JSON.stringify(discordRequestBody),
          }
        );

        if (!response.ok) {
          const errorData = await response.json();
          console.error(
            `❌ HTTP ${response.status} - Failed to start Discord scraper ${scraperName} (channel ${i + 1}):`,
            errorData
          );
          console.error(`❌ Response headers:`, Object.fromEntries(response.headers.entries()));
          throw new Error(
            `Failed to start Discord scraper ${scraperName} (channel ${i + 1}): ${errorData.error?.message || "Unknown error"}`
          );
        }

        console.log(
          `✅ HTTP ${response.status} - Successfully started Discord scraper ${scraperName} (channel ${i + 1})`
        );
        const result = await response.json();
        const jobId = result.data.id;
        if (!jobId) {
          throw new Error(
            `No job ID returned from Apify for Discord scraper ${scraperName} (channel ${i + 1})`
          );
        }
        console.log(
          `🔍 DEBUG: Started Discord scraper ${scraperName} (channel ${i + 1}) with job ID: ${jobId}`
        );
        console.log(`🔍 DEBUG: Full result from Apify:`, JSON.stringify(result, null, 2));

        // Wait for this Discord job to complete before starting the next one
        try {
          await this.waitForRunCompletion(jobId, `${scraperName} (channel ${i + 1})`);
        } catch (e) {
          console.error(`❌ Discord channel ${i + 1} failed:`, (e as Error).message);
          // Continue to next channel
        }

        jobIds.push(jobId);
      }

      return jobIds;
    }

    // Start the Apify job (single run)
    // Remove timeoutSecs from request body - it should only be in URL parameter
    delete requestBody.timeoutSecs;

    // Final verification before sending - ensure startUrls is still an array
    if (requestBody.startUrls !== undefined && !Array.isArray(requestBody.startUrls)) {
      console.error(
        `[CRITICAL FINAL CHECK] startUrls is NOT an array right before sending! Type: ${typeof requestBody.startUrls}, Value:`,
        requestBody.startUrls
      );
      // Last chance to fix it
      if (typeof requestBody.startUrls === "string") {
        try {
          const parsed = JSON.parse(requestBody.startUrls);
          if (Array.isArray(parsed)) {
            requestBody.startUrls = parsed;
            console.log(`[FIXED] Parsed startUrls from string to array in final check`);
          } else {
            requestBody.startUrls = [];
          }
        } catch {
          requestBody.startUrls = [];
        }
      } else {
        requestBody.startUrls = [];
      }
    }

    console.log(`🚀 DEBUG: Calling Apify API with actor ID: ${scraper.actor_id}`);
    console.log(`🔧 DEBUG: ACTUAL request body being sent:`, JSON.stringify(requestBody, null, 2));
    console.log(
      `🔧 DEBUG: startUrls final check - isArray: ${Array.isArray(requestBody.startUrls)}, type: ${typeof requestBody.startUrls}, length: ${Array.isArray(requestBody.startUrls) ? requestBody.startUrls.length : "N/A"}`
    );

    // Set timeout based on platform - use URL parameter for all platforms
    const singleTimeoutSecs = await this.getTimeoutForPlatform(platform);
    console.log(
      `⏱️ DEBUG: Orchestration single run timeout - Platform: ${platform}, Timeout: ${singleTimeoutSecs} seconds (${singleTimeoutSecs / 60} minutes)`
    );

    if (platform.toLowerCase() === "discord") {
      this.finalizeDiscordApifyInput(requestBody, platform);
    }

    const baseUrl = await this.getBaseUrl();
    const response = await fetch(
      `${baseUrl}/acts/${scraper.actor_id}/runs?timeout=${singleTimeoutSecs}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.APIFY_API_TOKEN}`,
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      console.error(
        `❌ HTTP ${response.status} - Failed to start scraper ${scraperName}:`,
        errorData
      );
      console.error(`❌ Response headers:`, Object.fromEntries(response.headers.entries()));
      throw new Error(
        `Failed to start scraper ${scraperName}: ${errorData.error?.message || "Unknown error"}`
      );
    }

    console.log(`✅ HTTP ${response.status} - Successfully started scraper ${scraperName}`);
    const result = await response.json();
    const jobId = result.data.id;

    console.log(`🔍 DEBUG: Started orchestration scraper "${scraperName}" with job ID: ${jobId}`);
    console.log(`🔍 DEBUG: Full result from Apify:`, JSON.stringify(result, null, 2));

    if (!jobId) {
      throw new Error(`No job ID returned from Apify for scraper ${scraperName}`);
    }

    return [jobId];
  }

  /**
   * Start one or multiple scraping jobs depending on scraper input configuration.
   * - input_type === "array": one job with all values
   * - input_type === "single" && run_iteratively: one job per value
   * - input_type === "single" && !run_iteratively: one job with the first value
   * - Discord scrapers: handle dynamic URL replacement from project profiles
   */
  async startScrapingJobsForScraper(
    projectId: string,
    scraperId: string,
    values: string[]
  ): Promise<string[]> {
    const scraper = await prisma.scraper.findFirst({
      where: { id: scraperId, deleted_at: null },
    });

    if (!scraper) {
      throw new Error("Scraper not found");
    }

    const platform = (scraper.platform || "").toLowerCase();
    const configJsonString = scraper.config_json ?? "";
    const hasKeywordPlaceholder = configJsonString.includes("{{keyword}}");
    const hasKeywordsPlaceholder = configJsonString.includes("{{keywords}}");
    const isLinkedInSearch = platform === "linkedin" && !scraper.url_input_field_name;

    // Check if this scraper uses URL input from downstream posts
    let urlsFromDownstream: string[] = [];
    if (scraper.url_input_field_name && scraper.url_input_source_scraper) {
      try {
        urlsFromDownstream = await this.fetchUrlsFromDownstreamPosts(
          projectId,
          scraper.url_input_source_scraper
        );
        console.log(
          `Scraper "${scraper.name}" configured to use ${urlsFromDownstream.length} URLs from "${scraper.url_input_source_scraper}"`
        );
      } catch (error) {
        console.error(`Error fetching URLs for scraper "${scraper.name}":`, error);
        // Continue without URLs - the scraper will run with empty URL array
      }
    }

    if (
      scraper.url_input_field_name &&
      scraper.url_input_source_scraper &&
      urlsFromDownstream.length === 0
    ) {
      console.log(
        `⚠️  Skipping scraper "${scraper.name}" because no downstream records were found from "${scraper.url_input_source_scraper}".`
      );
      return [];
    }

    // Normalize values
    const inputsList: { keywords?: string[]; keyword?: string; urls?: string[]; url?: string }[] =
      [];

    let isSingle = (scraper.input_type || "array") === "single";
    const shouldIterate = scraper.run_iteratively ?? true;

    if (isLinkedInSearch || (hasKeywordPlaceholder && !hasKeywordsPlaceholder)) {
      isSingle = true;
    }

    if (!isSingle) {
      // Single job with all values
      const input: { keywords?: string[]; keyword?: string; urls?: string[]; url?: string } = {
        keywords: values,
      };
      if (values.length === 1) {
        input.keyword = values[0];
      }
      if (urlsFromDownstream.length > 0) {
        input.urls = urlsFromDownstream;
        input.url = urlsFromDownstream[0];
      }
      inputsList.push(input);
    } else if (isSingle && shouldIterate) {
      // Multiple jobs, one per value
      for (const val of values) {
        const runInput: { keywords?: string[]; keyword?: string; urls?: string[]; url?: string } = {
          keywords: [val],
          keyword: val,
        };
        if (urlsFromDownstream.length > 0) {
          runInput.urls = urlsFromDownstream;
          runInput.url = urlsFromDownstream[0];
        }
        inputsList.push(runInput);
      }
    } else {
      // Single job with first value only
      const first = values[0];
      if (first) {
        const runInput: { keywords?: string[]; keyword?: string; urls?: string[]; url?: string } = {
          keywords: [first],
          keyword: first,
        };
        if (urlsFromDownstream.length > 0) {
          runInput.urls = urlsFromDownstream;
          runInput.url = urlsFromDownstream[0];
        }
        inputsList.push(runInput);
      } else {
        // No values to run with; do nothing
        return [];
      }
    }

    const createdJobIds: string[] = [];

    // Special handling for Discord scrapers
    if (scraper.platform === "discord") {
      // Fetch Discord URLs from project profiles
      const discordUrls = await this.fetchDiscordUrlsFromProject(projectId);

      if (discordUrls.length === 0) {
        console.log(
          `No Discord URLs found for project ${projectId}. Skipping Discord scraper "${scraper.name}"`
        );
        return [];
      }

      console.log(
        `Found ${discordUrls.length} Discord URLs for scraper "${scraper.name}":`,
        discordUrls
      );

      // Create one job per Discord URL
      for (let i = 0; i < discordUrls.length; i++) {
        const discordProfile = discordUrls[i];
        const discordUrl = discordProfile.url;
        console.log(`\n📋 Discord Channel ${i + 1}/${discordUrls.length} (Manual Scrape Job)`);
        console.log(`   Channel URL: ${discordUrl}`);

        const job = await prisma.scrapeJob.create({
          data: {
            project_id: projectId,
            scraper_id: scraperId,
            status: "PENDING",
            used_urls: JSON.stringify([discordUrl]),
          },
        });

        try {
          const config = JSON.parse(scraper.config_json);
          const apifyInput = this.replaceDiscordUrlPlaceholders(config, discordUrl);

          console.log(`   📤 Starting Discord scraper "${scraper.name}"`);

          const run = await this.startScraper(scraper.actor_id, apifyInput, scraper.platform);

          await prisma.scrapeJob.update({
            where: { id: job.id },
            data: {
              apify_run_id: run.id,
              status: "RUNNING",
              started_at: new Date(),
            },
          });

          createdJobIds.push(job.id);
        } catch (error) {
          await prisma.scrapeJob.update({
            where: { id: job.id },
            data: {
              status: "FAILED",
              error_message: error instanceof Error ? error.message : "Unknown error",
              completed_at: new Date(),
            },
          });
        }
      }

      return createdJobIds;
    }

    // Regular handling for non-Discord scrapers
    for (const runInput of inputsList) {
      // Store used URLs for cleanup later
      const usedUrlsJson =
        urlsFromDownstream.length > 0 ? JSON.stringify(urlsFromDownstream) : null;

      // Create job record
      const job = await prisma.scrapeJob.create({
        data: {
          project_id: projectId,
          scraper_id: scraperId,
          status: "PENDING",
          used_urls: usedUrlsJson,
        },
      });

      try {
        const config = JSON.parse(scraper.config_json);

        // Log scrapeUntil BEFORE platform-specific processing for debugging
        if (config.scrapeUntil) {
          console.log(
            `🔍 DEBUG [orchestration]: scrapeUntil BEFORE resolveLinkedInConfigPlaceholders: ${JSON.stringify(config.scrapeUntil)}`
          );
        }

        let apifyInput;

        // For Reddit scrapers, combine keywords with Reddit URLs
        // For X scrapers, combine keywords with X URLs
        // For LinkedIn scrapers, handle {{keywords}} placeholder properly
        if (scraper.platform === "reddit") {
          const keywords = runInput.keywords || (runInput.keyword ? [runInput.keyword] : []);
          apifyInput = await this.resolveRedditConfigPlaceholders(
            config,
            keywords,
            projectId,
            scraper.actor_id
          );
        } else if (scraper.platform === "x" || scraper.platform === "X") {
          const keywords = runInput.keywords || (runInput.keyword ? [runInput.keyword] : []);
          apifyInput = await this.resolveXConfigPlaceholders(
            config,
            keywords,
            projectId,
            scraper.actor_id,
            undefined
          );
        } else if (scraper.platform === "linkedin") {
          const keywords = runInput.keywords || (runInput.keyword ? [runInput.keyword] : []);
          apifyInput = await this.resolveLinkedInConfigPlaceholders(
            config,
            keywords,
            projectId,
            scraper.actor_id
          );

          // Log scrapeUntil AFTER processing for debugging
          if (apifyInput.scrapeUntil) {
            console.log(
              `🔍 DEBUG [orchestration]: scrapeUntil AFTER resolveLinkedInConfigPlaceholders: ${JSON.stringify(apifyInput.scrapeUntil)}`
            );
          }
        } else if (scraper.platform === "facebook") {
          const keywords = runInput.keywords || (runInput.keyword ? [runInput.keyword] : []);
          const urls = runInput.urls || (runInput.url ? [runInput.url] : []);
          apifyInput = await this.resolveFacebookConfigPlaceholders(
            config,
            keywords,
            urls,
            projectId,
            scraper.actor_id,
            scraper.name
          );
        } else if (scraper.platform === "discord") {
          const keywords = runInput.keywords || (runInput.keyword ? [runInput.keyword] : []);
          apifyInput = await this.resolveDiscordConfigPlaceholders(config, keywords, projectId);
        } else {
          apifyInput = this.resolveConfigPlaceholders(config, runInput);
        }

        // If this scraper has URL input configuration, inject URLs into the specified field
        if (scraper.url_input_field_name && urlsFromDownstream.length > 0) {
          apifyInput = this.injectUrlsIntoConfig(
            apifyInput,
            scraper.url_input_field_name,
            urlsFromDownstream
          );
          console.log(
            `Injected ${urlsFromDownstream.length} URLs into field "${scraper.url_input_field_name}" for scraper "${scraper.name}"`
          );
        }

        const run = await this.startScraper(scraper.actor_id, apifyInput, scraper.platform);

        await prisma.scrapeJob.update({
          where: { id: job.id },
          data: {
            apify_run_id: run.id,
            status: "RUNNING",
            started_at: new Date(),
          },
        });

        createdJobIds.push(job.id);
      } catch (error) {
        await prisma.scrapeJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            error_message: error instanceof Error ? error.message : "Unknown error",
            completed_at: new Date(),
          },
        });
      }
    }

    return createdJobIds;
  }

  /**
   * Fetch Reddit URLs from project profiles
   */
  async fetchRedditUrlsFromProject(projectId: string): Promise<string[]> {
    try {
      const redditProfiles = await prisma.projectProfile.findMany({
        where: {
          project_id: projectId,
          platform: "reddit",
          is_selected: true,
          deleted_at: null,
        },
        select: {
          url: true,
          type: true, // We need to filter by type
        },
      });

      // Only return URLs for Reddit users (person type), not subreddits (channel type)
      return redditProfiles
        .filter((profile) => profile.type === "person" || profile.url.includes("/user/"))
        .map((profile) => profile.url);
    } catch (error) {
      console.error("Error fetching Reddit URLs from project:", error);
      return [];
    }
  }

  /**
   * Resolve placeholders for Reddit (sources-only) scraper.
   * Only passes Reddit URLs from project configuration (profiles + brand directory); no keywords.
   */
  async resolveRedditSourcesOnlyConfigPlaceholders(
    config: any,
    projectId: string,
    scraperName: string
  ): Promise<any> {
    const resolvedConfig = JSON.parse(JSON.stringify(config)); // Deep clone

    const profileUrls = await this.fetchRedditUrlsFromProject(projectId);
    const { redditUrls: brandUrls } = await getBrandDirectoryUrlsForProject(projectId);
    const normalizedSeen = new Set<string>();
    const allRedditUrls: string[] = [];
    for (const url of [...profileUrls, ...brandUrls]) {
      const u = url?.trim();
      if (!u) continue;
      const n = u.toLowerCase().replace(/\/+$/, "");
      if (!normalizedSeen.has(n)) {
        normalizedSeen.add(n);
        allRedditUrls.push(u);
      }
    }

    resolvedConfig.startUrls = allRedditUrls.map((url) => ({ url }));
    if (resolvedConfig.searchTerms !== undefined) resolvedConfig.searchTerms = [];
    if (resolvedConfig.searches !== undefined) resolvedConfig.searches = [];

    console.log(
      `🔍 DEBUG: Reddit (sources) scraper "${scraperName}" - startUrls: ${resolvedConfig.startUrls.length} project Reddit URLs, no keywords`
    );
    return resolvedConfig;
  }

  /**
   * Resolve config placeholders for Reddit scrapers, combining keywords with Reddit URLs
   */
  async resolveRedditConfigPlaceholders(
    config: any,
    keywords: string[],
    projectId: string,
    actorId?: string
  ): Promise<any> {
    // Fetch Reddit URLs from project profiles
    const redditUrls = await this.fetchRedditUrlsFromProject(projectId);

    // Check if this is Mass Reddit Scraper Pro - Fast (needs brand directory Reddit URLs)
    const isMassRedditScraper = actorId === "3XedXIRBcjfKrnsDJ";

    let allRedditUrls = [...redditUrls];

    if (isMassRedditScraper) {
      // Fetch brand directory Reddit URLs and merge with project profile URLs
      const brandDirectoryUrls = await getBrandDirectoryUrlsForProject(projectId);
      allRedditUrls = [...redditUrls, ...brandDirectoryUrls.redditUrls];

      // Deduplicate URLs
      const normalizedUrls = new Set<string>();
      const deduplicatedUrls: string[] = [];
      for (const url of allRedditUrls) {
        const normalized = url.trim().toLowerCase().replace(/\/+$/, "");
        if (!normalizedUrls.has(normalized)) {
          normalizedUrls.add(normalized);
          deduplicatedUrls.push(url.trim());
        }
      }
      allRedditUrls = deduplicatedUrls;

      console.log(`\n🔍 Reddit Scraper (Mass Reddit Scraper Pro) - URL Sources:`);
      console.log(`  - Keywords: ${keywords.length}`);
      console.log(`  - Project Profile Reddit URLs: ${redditUrls.length}`);
      console.log(`  - Brand Directory Reddit URLs: ${brandDirectoryUrls.redditUrls.length}`);
      console.log(`  - Total (deduplicated): ${allRedditUrls.length}`);
      if (redditUrls.length > 0) {
        console.log(
          `  - Project URLs:`,
          redditUrls.slice(0, 5),
          redditUrls.length > 5 ? `... (${redditUrls.length} total)` : ""
        );
      }
      if (brandDirectoryUrls.redditUrls.length > 0) {
        console.log(
          `  - Brand Directory URLs:`,
          brandDirectoryUrls.redditUrls.slice(0, 5),
          brandDirectoryUrls.redditUrls.length > 5
            ? `... (${brandDirectoryUrls.redditUrls.length} total)`
            : ""
        );
      }
    } else {
      console.log(
        `Reddit scraper - Keywords: ${keywords.length}, Reddit URLs: ${redditUrls.length}`
      );
      allRedditUrls = redditUrls;
    }

    const resolvedConfig = JSON.parse(JSON.stringify(config)); // Deep clone

    // Handle searchTerms array (old format) - use keywords only
    if (resolvedConfig.searchTerms && Array.isArray(resolvedConfig.searchTerms)) {
      // Check if the array contains the {{keywords}} placeholder
      if (
        resolvedConfig.searchTerms.length === 1 &&
        resolvedConfig.searchTerms[0] === "{{keywords}}"
      ) {
        // Replace with deduplicated keywords
        const deduped = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))];
        resolvedConfig.searchTerms = deduped.length > 0 ? deduped : ["technology"];
        console.log(`🔍 DEBUG: Replaced Reddit searchTerms with:`, resolvedConfig.searchTerms);
      } else {
        // If it's already been processed, ensure it's flat and deduplicated
        const flat = resolvedConfig.searchTerms.flat();
        resolvedConfig.searchTerms = [
          ...new Set(flat.map((k: string) => k.trim()).filter(Boolean)),
        ];
        console.log(`🔍 DEBUG: Flattened Reddit searchTerms:`, resolvedConfig.searchTerms);
      }
    }

    // Handle searches array (new format) - use keywords only
    if (resolvedConfig.searches && Array.isArray(resolvedConfig.searches)) {
      // Check if the array contains the {{keywords}} placeholder
      if (resolvedConfig.searches.length === 1 && resolvedConfig.searches[0] === "{{keywords}}") {
        // Replace with deduplicated keywords
        const deduped = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))];
        resolvedConfig.searches = deduped.length > 0 ? deduped : ["technology"];
        console.log(`🔍 DEBUG: Replaced Reddit searches with:`, resolvedConfig.searches);
      } else {
        // If it's already been processed, ensure it's flat and deduplicated
        const flat = resolvedConfig.searches.flat();
        resolvedConfig.searches = [...new Set(flat.map((k: string) => k.trim()).filter(Boolean))];
        console.log(`🔍 DEBUG: Flattened Reddit searches:`, resolvedConfig.searches);
      }
    }

    // Handle startUrls - put Reddit profile URLs here as objects with { url: "..." }
    if (allRedditUrls.length > 0) {
      if (!resolvedConfig.startUrls || !Array.isArray(resolvedConfig.startUrls)) {
        resolvedConfig.startUrls = [];
      }

      // Add Reddit URLs as startUrl objects, but don't duplicate existing ones
      const existingUrls = new Set(
        (resolvedConfig.startUrls || [])
          .filter((item: any) => typeof item === "object" && item.url)
          .map((item: any) => item.url)
      );

      for (const url of allRedditUrls) {
        if (!existingUrls.has(url)) {
          resolvedConfig.startUrls.push({ url });
        }
      }

      console.log(`🔍 DEBUG: Added ${allRedditUrls.length} Reddit profile URLs to startUrls`);
    }

    // Note: Timeout is configured at the API level, not in the input configuration

    return resolvedConfig;
  }

  /**
   * Resolve placeholders for YouTube Search (sources-only) scraper.
   * Config has startUrls: ["{{urls}}"]. We set startUrls to project YouTube URLs only; no search terms.
   */
  async resolveYouTubeSourcesOnlyConfigPlaceholders(
    config: any,
    projectId: string,
    scraperName: string
  ): Promise<any> {
    const resolvedConfig = JSON.parse(JSON.stringify(config)); // Deep clone

    const { youtubeUrls } = await getBrandDirectoryUrlsForProject(projectId);
    resolvedConfig.startUrls = youtubeUrls.map((url) => ({ url }));
    if (resolvedConfig.searchQueries !== undefined) delete resolvedConfig.searchQueries;
    if (resolvedConfig.query !== undefined) delete resolvedConfig.query;

    console.log(
      `🔍 DEBUG: YouTube (sources) scraper "${scraperName}" - startUrls: ${resolvedConfig.startUrls.length} project YouTube URLs, no search terms`
    );
    return resolvedConfig;
  }

  /**
   * Resolve placeholders for YouTube Scraper (actor h7sDV53CddomktSi5).
   * - searchQueries: unified array of project keywords + brand names (only input used)
   * - startUrls: not set; scraper uses search only, no URL-based sources
   */
  async resolveYouTubeConfigPlaceholders(
    config: any,
    searchTerms: string[],
    projectId: string,
    scraperName: string
  ): Promise<any> {
    const resolvedConfig = JSON.parse(JSON.stringify(config)); // Deep clone

    // (1) SearchQueries = project keywords + brands (unified) — only input for this scraper
    const searchQueries = searchTerms.length > 0 ? [...searchTerms] : ["technology"];
    resolvedConfig.searchQueries = searchQueries;
    console.log(
      `🔍 DEBUG: YouTube scraper "${scraperName}" - searchQueries: ${searchQueries.length} terms`
    );
    if (resolvedConfig.query !== undefined) {
      delete resolvedConfig.query;
    }

    // (2) Do not pass any URLs — YouTube Search scraper uses only search queries
    resolvedConfig.startUrls = [];
    console.log(`🔍 DEBUG: YouTube scraper "${scraperName}" - startUrls: 0 (search-only, no URLs)`);

    return resolvedConfig;
  }

  /**
   * Fetch X URLs from project profiles
   */
  async fetchXUrlsFromProject(projectId: string): Promise<string[]> {
    try {
      const xProfiles = await prisma.projectProfile.findMany({
        where: {
          project_id: projectId,
          platform: "x",
          is_selected: true,
          deleted_at: null,
        },
        select: {
          url: true,
        },
      });
      return xProfiles.map((profile) => profile.url);
    } catch (error) {
      console.error("Error fetching X URLs from project:", error);
      return [];
    }
  }

  /**
   * Resolve config placeholders for X scrapers, combining keywords with X URLs
   */
  async resolveXConfigPlaceholders(
    config: any,
    keywords: string[],
    projectId: string,
    actorId?: string,
    orchestrationExecutionId?: string | null
  ): Promise<any> {
    // Fetch X URLs from project profiles
    const xUrls = await this.fetchXUrlsFromProject(projectId);

    // Check if this is X Profile Posts Scraper (needs brand directory Twitter URLs)
    const isXProfilePostsScraper = actorId === "Fo9GoU5wC270BgcBr";

    let allXUrls = [...xUrls];

    if (isXProfilePostsScraper) {
      // Fetch brand directory Twitter URLs and merge with project profile URLs
      const brandDirectoryUrls = await getBrandDirectoryUrlsForProject(projectId);
      allXUrls = [...xUrls, ...brandDirectoryUrls.twitterUrls];

      // Deduplicate URLs
      const normalizedUrls = new Set<string>();
      const deduplicatedUrls: string[] = [];
      for (const url of allXUrls) {
        const normalized = url.trim().toLowerCase().replace(/\/+$/, "");
        if (!normalizedUrls.has(normalized)) {
          normalizedUrls.add(normalized);
          deduplicatedUrls.push(url.trim());
        }
      }
      allXUrls = deduplicatedUrls;

      console.log(`\n🔍 X/Twitter Profile Posts Scraper - URL Sources:`);
      console.log(`  - Keywords: ${keywords.length}`);
      console.log(`  - Project Profile X URLs: ${xUrls.length}`);
      console.log(`  - Brand Directory Twitter URLs: ${brandDirectoryUrls.twitterUrls.length}`);
      console.log(`  - Total (deduplicated): ${allXUrls.length}`);
      if (xUrls.length > 0) {
        console.log(
          `  - Project URLs:`,
          xUrls.slice(0, 5),
          xUrls.length > 5 ? `... (${xUrls.length} total)` : ""
        );
      }
      if (brandDirectoryUrls.twitterUrls.length > 0) {
        console.log(
          `  - Brand Directory URLs:`,
          brandDirectoryUrls.twitterUrls.slice(0, 5),
          brandDirectoryUrls.twitterUrls.length > 5
            ? `... (${brandDirectoryUrls.twitterUrls.length} total)`
            : ""
        );
      }
    } else {
      console.log(`X scraper - Keywords: ${keywords.length}, X URLs: ${xUrls.length}`);
    }

    // Handle different types of X scrapers based on their configuration
    let resolvedConfig = JSON.parse(JSON.stringify(config)); // Deep clone

    // Check if this is a search scraper (has searchQueries)
    if (resolvedConfig.searchQueries) {
      // For search scrapers, replace {{keywords}} with deduplicated array of search queries
      const dedupedKeywords = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))];
      const searchQueries = dedupedKeywords.length > 0 ? dedupedKeywords : ["technology"];
      console.log(`🔍 DEBUG: Twitter search scraper - searchQueries:`, searchQueries);

      // Directly assign the search queries array
      resolvedConfig.searchQueries = searchQueries;

      // CRITICAL: Remove the `query` field when using `searchQueries` array
      // The Apify scraper will prioritize `query` over `searchQueries` if both are present,
      // causing it to only search for the first keyword instead of all keywords
      if (resolvedConfig.query !== undefined) {
        console.log(
          `🔍 DEBUG: Removing 'query' field (was: "${resolvedConfig.query}") to ensure all ${searchQueries.length} searchQueries are used`
        );
        delete resolvedConfig.query;
      }
    }

    // Check if this is a profile scraper (has profileUrls)
    if (resolvedConfig.profileUrls) {
      // For profile scrapers, replace {{keywords}} with X profile URLs
      // Apify X Profile Posts Scraper accepts only x.com URLs (not twitter.com) - normalize all to x.com
      const rawUrls = allXUrls.length > 0 ? allXUrls : ["https://x.com/elonmusk"];
      const normalized = rawUrls.map((u) => normalizeXProfileUrl(u));
      resolvedConfig.profileUrls = [...new Set(normalized)];
    }

    // Check if this is a replies scraper (has postUrls)
    if (resolvedConfig.postUrls) {
      // For replies scrapers, fetch URLs from previous Twitter Search Scraper results
      console.log(
        `🔍 DEBUG: Twitter Post Replies Scraper - fetching URLs from DownstreamPost table...`
      );

      try {
        // CRITICAL: Twitter Post Replies scraper needs full URLs (https://x.com/.../status/...), not postIds
        const urlsFromDb = await this.fetchUrlsFromDownstreamPosts(
          projectId,
          "Twitter (X.com) Search Scraper",
          true, // preferUrls: true - we need URLs, not postIds
          orchestrationExecutionId ?? undefined
        );
        console.log(
          `🔍 DEBUG: Found ${urlsFromDb.length} URLs from Twitter Search Scraper in database`
        );

        // Debug: Show first few URLs to check format
        if (urlsFromDb.length > 0) {
          console.log(`🔍 DEBUG: First 3 URLs:`, urlsFromDb.slice(0, 3));
          console.log(`🔍 DEBUG: First URL length:`, urlsFromDb[0].length);
          console.log(
            `🔍 DEBUG: First URL characters:`,
            urlsFromDb[0].split("").map((c) => c.charCodeAt(0))
          );
        }

        // CRITICAL: preferUrls: true returns empty array if no URLs exist in DownstreamPost
        // We need to always convert postIds to URLs for Twitter Post Replies scraper
        // So if we got empty array, fetch postIds and convert them
        if (urlsFromDb.length === 0) {
          console.log(
            `🔍 DEBUG: No URLs found in DownstreamPost (preferUrls: true returned empty), fetching postIds to convert to URLs...`
          );

          // Fetch postIds from DownstreamPost
          const postIds = await this.fetchUrlsFromDownstreamPosts(
            projectId,
            "Twitter (X.com) Search Scraper",
            false, // preferUrls: false - get postIds
            orchestrationExecutionId ?? undefined
          );

          if (postIds.length > 0) {
            console.log(`🔍 DEBUG: Found ${postIds.length} postIds, converting to URLs...`);

            // Fetch URLs from Post table using postIds
            const posts = await prisma.post.findMany({
              where: {
                postId: { in: postIds },
                platform: { in: ["X", "x", "twitter"] },
              },
              select: {
                postId: true,
                url: true,
              },
            });

            // Map postIds to URLs, constructing URLs if missing
            const urlMap = new Map<string, string>();
            posts.forEach((post) => {
              if (post.url) {
                urlMap.set(post.postId, post.url);
              }
            });

            // Build URLs array, using Post table URLs or constructing from postId
            const convertedUrls = postIds
              .map((postId) => {
                // Prefer URL from Post table
                if (urlMap.has(postId)) {
                  return urlMap.get(postId)!;
                }
                // Fallback: construct basic Twitter URL (won't have username but might work)
                // Format: https://x.com/i/status/{postId}
                return `https://x.com/i/status/${postId}`;
              })
              .filter((url): url is string => url !== null && url.length > 0);

            console.log(
              `✅ DEBUG: Converted ${convertedUrls.length} URLs from ${postIds.length} postIds (${urlMap.size} from Post table, ${convertedUrls.length - urlMap.size} constructed)`
            );
            resolvedConfig.postUrls = convertedUrls;
          } else {
            resolvedConfig.postUrls = [];
          }
        } else {
          // We got URLs from DownstreamPost - use them directly
          resolvedConfig.postUrls = urlsFromDb;
        }

        const postUrls = resolvedConfig.postUrls || [];

        console.log(`✅ DEBUG: Updated Twitter Post Replies Scraper with ${postUrls.length} URLs`);
        if (postUrls.length > 0) {
          console.log(`🔍 DEBUG: First postUrl in resolved config:`, postUrls[0]);
        }
        console.log(`🔍 DEBUG: postUrls array length:`, postUrls.length);
      } catch (error) {
        console.log(
          `⚠️ WARNING: Failed to fetch URLs for Twitter Post Replies Scraper: ${error instanceof Error ? error.message : String(error)}`
        );
        // Fallback to empty array
        const configString = JSON.stringify(resolvedConfig);
        const updatedConfigString = configString.replace('"{{urls}}"', JSON.stringify([]));
        resolvedConfig = JSON.parse(updatedConfigString);
      }
    }

    return resolvedConfig;
  }

  /**
   * Resolve Facebook config placeholders
   */
  async resolveFacebookConfigPlaceholders(
    config: any,
    keywords: string[],
    urls: string[],
    projectId?: string,
    actorId?: string,
    scraperName?: string
  ): Promise<any> {
    // Check if this is the Facebook Posts Scraper (uses URLs only, no keywords)
    // Actor ID: KoJrdxJCTtpon81KY
    const isFacebookPostsScraper = actorId === "KoJrdxJCTtpon81KY";

    // For Facebook Posts Scraper, use only URLs (no keywords)
    if (isFacebookPostsScraper && projectId) {
      // Fetch Facebook URLs from project profiles
      const facebookUrls = await this.fetchFacebookUrlsFromProject(projectId);

      // Fetch brand directory Facebook URLs and merge with project profile URLs
      const { getBrandDirectoryUrlsForProject } = await import(
        "@/lib/brand-directory/project-brand-urls-service"
      );
      const brandDirectoryUrls = await getBrandDirectoryUrlsForProject(projectId);
      const allFacebookUrls = [...facebookUrls, ...brandDirectoryUrls.facebookUrls];

      // Deduplicate URLs
      const normalizedUrls = new Set<string>();
      const deduplicatedUrls: string[] = [];
      for (const url of allFacebookUrls) {
        const normalized = url.trim().toLowerCase().replace(/\/+$/, "");
        if (!normalizedUrls.has(normalized)) {
          normalizedUrls.add(normalized);
          deduplicatedUrls.push(url.trim());
        }
      }

      console.log(`\n🔍 Facebook Posts Scraper (${scraperName || actorId}) - URL Sources:`);
      console.log(`  - Project Profile URLs: ${facebookUrls.length}`);
      console.log(`  - Brand Directory URLs: ${brandDirectoryUrls.facebookUrls.length}`);
      console.log(`  - Total (deduplicated): ${deduplicatedUrls.length}`);
      if (facebookUrls.length > 0) {
        console.log(
          `  - Project URLs:`,
          facebookUrls.slice(0, 5),
          facebookUrls.length > 5 ? `... (${facebookUrls.length} total)` : ""
        );
      }
      if (brandDirectoryUrls.facebookUrls.length > 0) {
        console.log(
          `  - Brand Directory URLs:`,
          brandDirectoryUrls.facebookUrls.slice(0, 5),
          brandDirectoryUrls.facebookUrls.length > 5
            ? `... (${brandDirectoryUrls.facebookUrls.length} total)`
            : ""
        );
      }

      // Format URLs as objects for startUrls (Facebook scrapers expect [{ url: "..." }])
      const formattedUrls = deduplicatedUrls.map((url) => ({ url }));

      // Resolve placeholders with URLs only
      const resolvedConfig = this.resolveConfigPlaceholders(config, {
        keywords: [], // No keywords for this scraper
        urls: deduplicatedUrls,
        projectId,
        platform: "facebook",
      });

      // Ensure startUrls field contains Facebook URLs formatted as objects
      resolvedConfig.startUrls = formattedUrls;

      // Remove keyword fields if they exist
      delete resolvedConfig.keywords;
      delete resolvedConfig.query;
      delete resolvedConfig.keyword;

      // Apify Facebook Posts Scraper expects onlyPostsNewerThan to match: number + lowercase unit (e.g. "1 day" not "1 Day")
      if (typeof resolvedConfig.onlyPostsNewerThan === "string") {
        const normalized = normalizeOnlyPostsNewerThan(resolvedConfig.onlyPostsNewerThan);
        if (normalized) {
          resolvedConfig.onlyPostsNewerThan = normalized;
        }
      }

      console.log(
        `Facebook Posts Scraper resolved config (startUrls: ${Array.isArray(resolvedConfig.startUrls) ? resolvedConfig.startUrls.length : 0})`
      );

      return resolvedConfig;
    }

    // For Facebook Posts Search, use keywords as before
    const resolvedConfig = { ...config };

    // For Facebook, we need to batch through multiple keywords
    // The Facebook scraper should iterate through each keyword
    // Store all keywords for batching logic to handle (deduplicated)
    const deduped = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))];
    resolvedConfig.keywords = deduped;
    console.log(`🔍 DEBUG: Facebook scraper - keywords to process: ${deduped.length} keywords`);
    console.log(`🔍 DEBUG: Facebook keywords:`, deduped);

    // Replace {{keyword}} placeholder with first keyword for immediate use
    if (resolvedConfig.query && resolvedConfig.query.includes("{{keyword}}")) {
      resolvedConfig.query = resolvedConfig.query.replace("{{keyword}}", keywords[0] || "");
    }

    // Facebook Posts Search (TMBawM4LZpKN15DZX): inject startDate = yesterday, endDate = today (local calendar, inclusive two-day window)
    if (actorId === "TMBawM4LZpKN15DZX") {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      const fmt = (dt: Date) => {
        const y = dt.getFullYear();
        const m = String(dt.getMonth() + 1).padStart(2, "0");
        const d = String(dt.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
      };
      resolvedConfig.startDate = fmt(yesterday);
      resolvedConfig.endDate = fmt(today);
      console.log(
        `🔍 DEBUG: Facebook Posts Search - injected startDate/endDate: ${resolvedConfig.startDate} → ${resolvedConfig.endDate} (yesterday through today, local)`
      );
    }

    // DO NOT set startUrls for Facebook Posts Search - it uses keywords, not startUrls
    // Only Facebook Comments Scraper needs startUrls, and that's handled separately
    // Setting startUrls here would break the isFacebookPostsSearch detection logic

    return resolvedConfig;
  }

  /**
   * Resolve config placeholders for Discord scrapers
   */
  async resolveDiscordConfigPlaceholders(
    config: any,
    keywords: string[],
    projectIds: string | string[]
  ): Promise<any> {
    const ids = (Array.isArray(projectIds) ? projectIds : [projectIds]).filter(Boolean);
    console.log(
      `🔍 DEBUG: resolveDiscordConfigPlaceholders ENTERED - projectIds: ${ids.join(", ")}`
    );
    try {
      // Fetch Discord channel URLs from project profiles / brand sources
      console.log(`🔍 DEBUG: About to fetch Discord profiles...`);
      const discordProfiles = await this.fetchDiscordUrlsFromProjects(ids);
      console.log(`🔍 DEBUG: Fetched ${discordProfiles.length} Discord profiles successfully`);

      // Deduplicate keywords
      const dedupedKeywords = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))];

      console.log(`\n🔍 Discord Scraper Configuration`);
      console.log(`   Project ID(s): ${ids.join(", ")}`);
      console.log(`   Keywords: ${dedupedKeywords.length}`);
      console.log(`   Discord channels found: ${discordProfiles.length}`);

      // For Discord scrapers, replace {{urls}} with Discord channel URLs
      const resolvedConfig = JSON.parse(JSON.stringify(config)); // Deep clone

      if (discordProfiles.length === 0) {
        console.log(`   ⚠️  No Discord URLs found - skipping Discord scraper`);
        // Empty arrays so isDiscord detection and skip logic stay consistent
        resolvedConfig["scrapeChannelMembers.channelUrl"] = [];
        resolvedConfig["scrapeMessages.channelUrl"] = [];
      } else {
        // For Discord, we need to batch through multiple channels
        // The Discord scraper should iterate through each channel URL
        // Store URLs for batching logic to handle (deduplicated)
        const allUrls = discordProfiles.map((p) => p.url);
        const discordUrls = [...new Set(allUrls.map((u) => u.trim()).filter(Boolean))];
        resolvedConfig["scrapeChannelMembers.channelUrl"] = discordUrls; // Use all URLs for channel members
        resolvedConfig["scrapeMessages.channelUrl"] = discordUrls; // Use all URLs for messages

        console.log(`   📋 Channels loaded:`);
        for (let i = 0; i < discordProfiles.length; i++) {
          const profile = discordProfiles[i];
          console.log(`      ${i + 1}. ${profile.url}`);
        }
      }
      console.log(``); // Empty line for readability
      console.log(`🔍 DEBUG: resolveDiscordConfigPlaceholders COMPLETED - returning config`);
      return resolvedConfig;
    } catch (error) {
      console.error(`❌ ERROR in resolveDiscordConfigPlaceholders:`, error);
      if (error instanceof Error) {
        console.error(`   Error message: ${error.message}`);
        console.error(`   Error stack: ${error.stack}`);
      }
      throw error;
    }
  }

  /**
   * Fetch LinkedIn URLs from project profiles
   */
  async fetchLinkedInUrlsFromProject(projectId: string): Promise<string[]> {
    try {
      // First, verify the project exists
      const project = await prisma.project.findFirst({
        where: { id: projectId, deleted_at: null },
        select: { id: true, name: true },
      });

      if (!project) {
        console.error(`[LinkedIn URLs] Project ${projectId} not found or deleted`);
        return [];
      }

      console.log(`[LinkedIn URLs] Project found: ${project.name} (${project.id})`);

      // Get all profiles for debugging (including soft-deleted ones to see what's there)
      const allProfilesIncludingDeleted = await prisma.projectProfile.findMany({
        where: {
          project_id: projectId,
        },
        select: {
          platform: true,
          url: true,
          name: true,
          type: true,
          is_selected: true,
          deleted_at: true,
        },
      });

      console.log(
        `[LinkedIn URLs] All profiles (including deleted) for project ${projectId}:`,
        allProfilesIncludingDeleted
      );
      console.log(
        `[LinkedIn URLs] Total profiles (including deleted): ${allProfilesIncludingDeleted.length}`
      );

      // Get active profiles only
      const allProfiles = await prisma.projectProfile.findMany({
        where: {
          project_id: projectId,
          deleted_at: null,
        },
        select: {
          platform: true,
          url: true,
          name: true,
          type: true,
          is_selected: true,
        },
      });

      console.log(
        `[LinkedIn URLs] Active profiles (deleted_at: null) for project ${projectId}:`,
        allProfiles
      );
      console.log(`[LinkedIn URLs] Total active profiles: ${allProfiles.length}`);

      // Filter for LinkedIn profiles (case-insensitive)
      const linkedinProfiles = allProfiles.filter(
        (profile) => profile.platform?.toLowerCase() === "linkedin" && profile.is_selected === true
      );

      console.log(
        `[LinkedIn URLs] LinkedIn profiles (selected, case-insensitive):`,
        linkedinProfiles
      );
      console.log(
        `Found ${linkedinProfiles.length} LinkedIn profiles for project:`,
        linkedinProfiles
      );

      if (linkedinProfiles.length === 0 && allProfiles.length > 0) {
        console.warn(
          `[LinkedIn URLs] WARNING: Found ${allProfiles.length} profiles but 0 LinkedIn profiles. Platform values:`,
          allProfiles.map((p) => ({ platform: p.platform, is_selected: p.is_selected }))
        );
      }

      return linkedinProfiles.map((profile) => profile.url);
    } catch (error) {
      console.error("Error fetching LinkedIn URLs from project:", error);
      return [];
    }
  }

  /**
   * Fetch Facebook URLs from project profiles
   */
  async fetchFacebookUrlsFromProject(projectId: string): Promise<string[]> {
    try {
      const profiles = await prisma.projectProfile.findMany({
        where: {
          project_id: projectId,
          platform: "facebook",
          is_selected: true,
          deleted_at: null,
        },
        select: { url: true },
      });
      return profiles.map((p) => p.url);
    } catch (error) {
      console.error("Error fetching Facebook URLs from project:", error);
      return [];
    }
  }

  /**
   * Resolve config placeholders for LinkedIn scrapers.
   * - Keywords should remain pure keyword phrases (no LinkedIn URLs mixed in).
   * - URLs are supplied separately via {{urls}} placeholders when the scraper needs them.
   * - For the new LinkedIn Post Scraper (Wpp1BZ6yGWjySadk3), use only URLs (no keywords).
   */
  async resolveLinkedInConfigPlaceholders(
    config: any,
    keywords: string[],
    projectId: string,
    actorId?: string,
    scraperName?: string
  ): Promise<any> {
    // Fetch LinkedIn URLs from project profiles
    const linkedinUrls = await this.fetchLinkedInUrlsFromProject(projectId);

    // Check if this is the new LinkedIn Post Scraper (uses URLs only, no keywords)
    const isNewLinkedInPostScraper = actorId === "Wpp1BZ6yGWjySadk3";

    // For the LinkedIn Post Scraper, always calculate and override scrapeUntil with "48HOURS" logic
    // This calculates today's date minus 2 days and overrides any value in the config
    if (isNewLinkedInPostScraper) {
      const today = new Date();
      const twoDaysAgo = new Date(today);
      twoDaysAgo.setDate(today.getDate() - 2);
      const dateString = twoDaysAgo.toISOString().split("T")[0]; // Format: YYYY-MM-DD

      const originalScrapeUntil = config.scrapeUntil;
      config.scrapeUntil = dateString;

      console.log(
        `[LinkedIn Post Scraper] Overriding scrapeUntil: ${JSON.stringify(originalScrapeUntil)} -> ${dateString} (today: ${today.toISOString().split("T")[0]}, minus 2 days)`
      );
    } else {
      // For other LinkedIn scrapers, handle scrapeUntil placeholder: replace "48HOURS" with today's date minus 2 days
      // If scrapeUntil is already a valid date string, preserve it
      if (config.scrapeUntil === "48HOURS" || config.scrapeUntil === '"48HOURS"') {
        const today = new Date();
        const twoDaysAgo = new Date(today);
        twoDaysAgo.setDate(today.getDate() - 2);
        const dateString = twoDaysAgo.toISOString().split("T")[0]; // Format: YYYY-MM-DD
        config.scrapeUntil = dateString;
        console.log(
          `[LinkedIn] Replaced scrapeUntil "48HOURS" with ${dateString} (today: ${today.toISOString().split("T")[0]}, minus 2 days)`
        );
      } else if (config.scrapeUntil && typeof config.scrapeUntil === "string") {
        // Validate that it's a valid date string format (YYYY-MM-DD)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (dateRegex.test(config.scrapeUntil.trim())) {
          // It's already a valid date - preserve it
          config.scrapeUntil = config.scrapeUntil.trim();
          console.log(`[LinkedIn] Preserving scrapeUntil date from config: ${config.scrapeUntil}`);
        } else {
          // Invalid format - log warning but keep it (might be a valid format we don't recognize)
          console.warn(
            `[LinkedIn] scrapeUntil has unexpected format: "${config.scrapeUntil}". Keeping as-is.`
          );
        }
      } else if (config.scrapeUntil) {
        // scrapeUntil exists but is not a string - log and keep it
        console.log(
          `[LinkedIn] scrapeUntil is set to non-string value: ${JSON.stringify(config.scrapeUntil)}. Keeping as-is.`
        );
      }
    }

    // For the new LinkedIn Post Scraper, use only URLs (no keywords)
    if (isNewLinkedInPostScraper) {
      // Fetch brand directory LinkedIn URLs and merge with project profile URLs
      const brandDirectoryUrls = await getBrandDirectoryUrlsForProject(projectId);
      const allLinkedInUrls = [...linkedinUrls, ...brandDirectoryUrls.linkedinUrls];

      // Deduplicate URLs
      const normalizedUrls = new Set<string>();
      const deduplicatedUrls: string[] = [];
      for (const url of allLinkedInUrls) {
        const normalized = url.trim().toLowerCase().replace(/\/+$/, "");
        if (!normalizedUrls.has(normalized)) {
          normalizedUrls.add(normalized);
          deduplicatedUrls.push(url.trim());
        }
      }

      // Normalize and process LinkedIn URLs for the scraper
      // 1. Normalize all LinkedIn URLs to use www.linkedin.com consistently
      // 2. Ensure company pages have /posts suffix
      // 3. Keep person profiles as-is (no /posts suffix)
      const processedUrls: string[] = [];
      let companyUrlsModified = 0;
      let urlsNormalized = 0;
      let invalidUrlsSkipped = 0;

      for (const url of deduplicatedUrls) {
        let trimmedUrl = url.trim();

        // Skip empty or invalid URLs
        if (!trimmedUrl || trimmedUrl.length === 0) {
          invalidUrlsSkipped++;
          continue;
        }

        // Ensure URL starts with http:// or https://
        if (!trimmedUrl.match(/^https?:\/\//i)) {
          // If it doesn't start with protocol, assume https://
          trimmedUrl = `https://${trimmedUrl}`;
        }

        // Normalize LinkedIn domain to www.linkedin.com for consistency
        // This ensures all URLs use the same format that the scraper expects
        if (trimmedUrl.toLowerCase().includes("linkedin.com")) {
          const originalUrl = trimmedUrl;
          // Convert any linkedin.com variant to https://www.linkedin.com
          // Handles: linkedin.com, www.linkedin.com, uk.linkedin.com, ca.linkedin.com, etc.
          // Pattern: https?://(optional-country-code-or-www.)linkedin.com -> https://www.linkedin.com
          trimmedUrl = trimmedUrl.replace(
            /^https?:\/\/([a-z]{2}\.|www\.)?linkedin\.com/i,
            "https://www.linkedin.com"
          );
          // Ensure it uses https:// (not http://) - catch any remaining http://
          trimmedUrl = trimmedUrl.replace(/^http:\/\//i, "https://");
          if (originalUrl !== trimmedUrl) {
            urlsNormalized++;
          }
        }

        const isCompanyPage = trimmedUrl.toLowerCase().includes("/company/");

        if (isCompanyPage) {
          // Remove trailing slashes and check if it ends with /posts
          const urlWithoutTrailingSlash = trimmedUrl.replace(/\/+$/, "");
          if (urlWithoutTrailingSlash.toLowerCase().endsWith("/posts")) {
            // Already has /posts suffix
            processedUrls.push(urlWithoutTrailingSlash);
          } else {
            // Append /posts suffix for company pages
            processedUrls.push(`${urlWithoutTrailingSlash}/posts`);
            companyUrlsModified++;
          }
        } else {
          // Person profiles or other URLs - keep normalized format
          processedUrls.push(trimmedUrl);
        }
      }

      if (invalidUrlsSkipped > 0) {
        console.log(`[LinkedIn Post Scraper] Skipped ${invalidUrlsSkipped} invalid/empty URLs`);
      }

      if (urlsNormalized > 0) {
        console.log(
          `[LinkedIn Post Scraper] Normalized ${urlsNormalized} LinkedIn URLs to use www.linkedin.com format`
        );
      }

      if (companyUrlsModified > 0) {
        console.log(
          `[LinkedIn Post Scraper] Modified ${companyUrlsModified} company LinkedIn URLs to include /posts suffix`
        );
      }

      // Log breakdown of URL types for debugging
      const companyCount = processedUrls.filter((u) =>
        u.toLowerCase().includes("/company/")
      ).length;
      const personCount = processedUrls.filter((u) => u.toLowerCase().includes("/in/")).length;
      console.log(
        `[LinkedIn Post Scraper] URL breakdown: ${companyCount} company pages, ${personCount} person profiles`
      );

      // Validate all URLs are properly formatted before sending
      const invalidUrls = processedUrls.filter((u) => {
        try {
          new URL(u);
          return false;
        } catch {
          return true;
        }
      });
      if (invalidUrls.length > 0) {
        console.error(
          `[LinkedIn Post Scraper] WARNING: Found ${invalidUrls.length} invalid URLs that will be skipped:`,
          invalidUrls
        );
        // Remove invalid URLs
        const validUrls = processedUrls.filter((u) => {
          try {
            new URL(u);
            return true;
          } catch {
            return false;
          }
        });
        processedUrls.length = 0;
        processedUrls.push(...validUrls);
      }

      console.log(`\n🔍 LinkedIn Post Scraper (${scraperName || actorId}) - URL Sources:`);
      console.log(`  - Project Profile URLs: ${linkedinUrls.length}`);
      console.log(
        `  - Brand Directory URLs: ${brandDirectoryUrls.linkedinUrls.length} (includes brand LinkedIn URLs from basic information + additional sources)`
      );
      console.log(`  - Total (deduplicated): ${deduplicatedUrls.length}`);
      console.log(`  - Total (after /posts processing): ${processedUrls.length}`);
      if (linkedinUrls.length > 0) {
        console.log(
          `  - Project URLs:`,
          linkedinUrls.slice(0, 5),
          linkedinUrls.length > 5 ? `... (${linkedinUrls.length} total)` : ""
        );
      }
      if (brandDirectoryUrls.linkedinUrls.length > 0) {
        console.log(
          `  - Brand Directory URLs:`,
          brandDirectoryUrls.linkedinUrls.slice(0, 5),
          brandDirectoryUrls.linkedinUrls.length > 5
            ? `... (${brandDirectoryUrls.linkedinUrls.length} total)`
            : ""
        );
      }

      // Resolve placeholders with URLs only (use processed URLs with /posts suffix for company pages)
      const resolvedConfig = this.resolveConfigPlaceholders(config, {
        keywords: [], // No keywords for this scraper
        urls: processedUrls,
        projectId,
        platform: "linkedin",
      });

      // Ensure scrapeUntil is preserved (resolveConfigPlaceholders doesn't modify it, but we want to be explicit)
      // The scrapeUntil was already processed above (48HOURS replacement or preservation)
      if (config.scrapeUntil) {
        resolvedConfig.scrapeUntil = config.scrapeUntil;
      }

      // Ensure urls field contains LinkedIn URLs (with /posts suffix for company pages)
      if (resolvedConfig.urls && Array.isArray(resolvedConfig.urls)) {
        resolvedConfig.urls = processedUrls;
      } else if (!resolvedConfig.urls) {
        resolvedConfig.urls = processedUrls;
      }

      // Remove keyword fields if they exist
      delete resolvedConfig.keyword;
      delete resolvedConfig.keywords;

      console.log(
        `LinkedIn Post Scraper resolved config (urls: ${Array.isArray(resolvedConfig.urls) ? resolvedConfig.urls.length : 0}, scrapeUntil: ${resolvedConfig.scrapeUntil || "not set"})`
      );
      console.log(
        `[LinkedIn] Final scrapeUntil value being sent to scraper: ${JSON.stringify(resolvedConfig.scrapeUntil)}`
      );
      if (processedUrls.length > 0 && processedUrls.length <= 10) {
        console.log(`  - Final URLs sent to scraper:`, processedUrls);
      } else if (processedUrls.length > 10) {
        console.log(
          `  - Sample URLs sent to scraper:`,
          processedUrls.slice(0, 5),
          `... (${processedUrls.length} total)`
        );
      }

      return resolvedConfig;
    }

    // For other LinkedIn scrapers, use keywords as before (deduplicated)
    const dedupedKeywords = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))];
    console.log(
      `LinkedIn scraper - Keywords: ${dedupedKeywords.length}, LinkedIn URLs: ${linkedinUrls.length}`
    );

    // For LinkedIn scrapers, we need to replace urls with the actual URLs
    // First, resolve other placeholders
    const resolvedConfig = this.resolveConfigPlaceholders(config, {
      keywords: dedupedKeywords,
      urls: linkedinUrls,
      projectId,
      platform: "linkedin",
    });

    const primaryKeyword = keywords[0] ?? "";

    // LinkedIn scraper expects a single keyword string per run
    if (Array.isArray(resolvedConfig.keyword)) {
      resolvedConfig.keyword = primaryKeyword;
    } else if (
      typeof resolvedConfig.keyword === "string" &&
      resolvedConfig.keyword.includes("{{")
    ) {
      resolvedConfig.keyword = primaryKeyword;
    } else if (!resolvedConfig.keyword) {
      resolvedConfig.keyword = primaryKeyword;
    }

    // Normalize keywords array to only the current keyword to avoid batching all terms together
    if (Array.isArray(resolvedConfig.keywords)) {
      resolvedConfig.keywords = [primaryKeyword];
    } else if (resolvedConfig.keywords === "{{keywords}}") {
      resolvedConfig.keywords = [primaryKeyword];
    }

    // Ensure urls field only contains LinkedIn URLs (if the config expects them)
    if (resolvedConfig.urls && Array.isArray(resolvedConfig.urls)) {
      resolvedConfig.urls = linkedinUrls;
    }

    console.log(
      `LinkedIn scraper resolved config (keyword: ${resolvedConfig.keyword}, urls: ${Array.isArray(resolvedConfig.urls) ? resolvedConfig.urls.length : 0})`
    );

    return resolvedConfig;
  }

  /**
   * Replace known placeholders in the config with provided values.
   * Supported placeholders (string equality):
   *  - "{{keywords}}" -> string[] (for Reddit: combines keywords + Reddit URLs)
   *  - "{{keyword}}" -> string
   *  - "{{urls}}" -> string[]
   *  - "{{url}}" -> string
   */
  resolveConfigPlaceholders(
    config: any,
    params: {
      keywords?: string[];
      keyword?: string;
      urls?: string[];
      url?: string;
      projectId?: string;
      platform?: string;
    }
  ): any {
    const clone = (value: any): any => {
      if (Array.isArray(value)) {
        // Check if this array contains placeholder values and replace them
        if (value.length === 2 && value[0] === "placeholder1" && value[1] === "placeholder2") {
          // This is likely a keywords placeholder that was replaced for JSON parsing
          if (Array.isArray(params.keywords)) {
            return params.keywords;
          }
          return [];
        }
        // Check if this is a nested array that might be a placeholder (for test cases)
        if (
          value.length === 1 &&
          Array.isArray(value[0]) &&
          value[0].length === 2 &&
          value[0][0] === "placeholder1" &&
          value[0][1] === "placeholder2"
        ) {
          // This is a nested placeholder array - flatten it and replace
          if (Array.isArray(params.keywords)) {
            return params.keywords;
          }
          return [];
        }
        return value.map(clone);
      }
      if (value && typeof value === "object") {
        const result: any = {};
        for (const key of Object.keys(value)) {
          result[key] = clone(value[key]);
        }
        return result;
      }
      if (typeof value === "string") {
        if (value === "{{keywords}}") {
          // For Reddit scrapers, combine keywords with Reddit URLs
          if (params.platform === "reddit" && params.projectId) {
            // This is a Reddit scraper - we need to combine keywords and Reddit URLs
            // Note: This is a synchronous method, so we'll need to handle this differently
            // For now, return deduplicated keywords and let the calling code handle URL combination
            if (Array.isArray(params.keywords)) {
              return [...new Set(params.keywords.map((k) => k.trim()).filter(Boolean))];
            } else if (typeof params.keywords === "string") {
              return params.keywords;
            }
            return [];
          } else {
            // For other platforms, use deduplicated keywords
            if (Array.isArray(params.keywords)) {
              return [...new Set(params.keywords.map((k) => k.trim()).filter(Boolean))];
            } else if (typeof params.keywords === "string") {
              return params.keywords;
            }
            return [];
          }
        }
        if (value === "{{keyword}}") return params.keyword ?? "";
        if (value === "{{urls}}") {
          // Deduplicate URLs
          const urls = params.urls ?? [];
          return [...new Set(urls.map((u) => u.trim()).filter(Boolean))];
        }
        if (value === "{{url}}") return params.url ?? "";
      }
      return value;
    };

    return clone(config);
  }

  /**
   * Clean up used URLs from DownstreamPost table after successful job completion
   */
  async cleanupUsedUrls(
    projectId: string,
    usedUrls: string[],
    sourceScraperName: string
  ): Promise<void> {
    if (!usedUrls || usedUrls.length === 0) {
      return; // Nothing to clean up
    }

    try {
      const normalizedProjectId =
        typeof projectId === "string" && projectId.trim() !== "" ? projectId : null;
      const result = await prisma.downstreamPost.deleteMany({
        where: {
          project_id: normalizedProjectId ?? undefined,
          origScraper: sourceScraperName,
          OR: [{ postId: { in: usedUrls } }, { url: { in: usedUrls } }],
        },
      });

      console.log(
        `Deleted ${result.count} downstream posts for scraper "${sourceScraperName}" after processing`
      );
    } catch (error) {
      console.error("Error cleaning up used URLs:", error);
      // Don't throw - this shouldn't fail the job completion
    }
  }

  /**
   * Check and update job status
   */
  async updateJobStatus(jobId: string): Promise<{
    newCount: number;
    updatedCount: number;
    savedCount: number;
    discardedCount: number;
  } | null> {
    console.log(`🔍 DEBUG: updateJobStatus called for jobId: ${jobId}`);

    const job = await prisma.scrapeJob.findFirst({
      where: { id: jobId, deleted_at: null },
      include: { scraper: true },
    });

    if (!job || !job.apify_run_id) {
      console.log(`🔍 DEBUG: No job found or missing apify_run_id for jobId: ${jobId}`);
      return null;
    }

    // Already processed: avoid duplicate processAndSavePosts (e.g. step executor + reconciliation both calling).
    // If counts are still 0, another process may still be saving; wait so we return real counts and
    // analysis doesn't run before posts are in the DB. Check by job id or by apify_run_id (in case another row for same run was processed).
    if (job.status === "COMPLETED") {
      let saved = job.posts_count ?? 0;
      let discarded = job.discarded_count ?? 0;
      const completedAt = job.completed_at;
      const recentlyCompleted =
        completedAt && Date.now() - new Date(completedAt).getTime() < 120_000;
      if (saved === 0 && discarded === 0 && recentlyCompleted) {
        const deadline = Date.now() + 90_000;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 2000));
          const row = await prisma.scrapeJob.findFirst({
            where: job.apify_run_id ? { apify_run_id: job.apify_run_id } : { id: jobId },
            select: { posts_count: true, discarded_count: true },
          });
          saved = row?.posts_count ?? 0;
          discarded = row?.discarded_count ?? 0;
          if (saved > 0 || discarded > 0) break;
        }
      }
      console.log(
        `🔍 DEBUG: Job ${jobId} already COMPLETED, skipping duplicate processing (saved=${saved}, discarded=${discarded})`
      );
      return { newCount: 0, updatedCount: 0, savedCount: saved, discardedCount: discarded };
    }

    console.log(
      `🔍 DEBUG: Found job ${jobId} with apify_run_id: ${job.apify_run_id}, scraper: ${job.scraper.name}`
    );

    try {
      const runStatus = await this.getRunStatus(job.apify_run_id);
      console.log(
        `🔍 DEBUG: Run status for ${job.apify_run_id}: ${runStatus.status}, datasetId: ${runStatus.defaultDatasetId}`
      );

      // CRITICAL: Process dataset items for SUCCEEDED, TIMED-OUT, and ABORTED jobs
      // ABORTED jobs may have collected data before being aborted (similar to timeouts)
      if (
        (runStatus.status === "SUCCEEDED" ||
          runStatus.status === "TIMED-OUT" ||
          runStatus.status === "ABORTED") &&
        runStatus.defaultDatasetId
      ) {
        // Claim by apify_run_id so only one caller runs processAndSavePosts per run (step executor + reconciliation
        // may both call; multiple ScrapeJob rows can share the same run). First caller marks all rows for this run COMPLETED.
        const claimed = await prisma.scrapeJob.updateMany({
          where: { apify_run_id: job.apify_run_id, status: "RUNNING" },
          data: { status: "COMPLETED", completed_at: new Date() },
        });
        if (claimed.count === 0) {
          console.log(
            `🔍 DEBUG: Job ${jobId} (run ${job.apify_run_id}) already claimed by another process, waiting for them to finish before returning`
          );
          // Wait for the other process to finish processAndSavePosts so we return real counts and
          // the step executor doesn't complete the orchestration before posts are in the DB (which
          // would trigger analysis with no new posts).
          const deadline = Date.now() + 120_000; // 2 min max
          let current: { posts_count: number; discarded_count: number } | null = null;
          const waitWhere = job.apify_run_id ? { apify_run_id: job.apify_run_id } : { id: job.id };
          while (Date.now() < deadline) {
            current = await prisma.scrapeJob.findFirst({
              where: waitWhere,
              select: { posts_count: true, discarded_count: true },
            });
            const saved = current?.posts_count ?? 0;
            const discarded = current?.discarded_count ?? 0;
            if (saved > 0 || discarded > 0) break;
            await new Promise((r) => setTimeout(r, 2000));
          }
          current =
            current ??
            (await prisma.scrapeJob.findFirst({
              where: waitWhere,
              select: { posts_count: true, discarded_count: true },
            }));
          return {
            newCount: 0,
            updatedCount: 0,
            savedCount: current?.posts_count ?? 0,
            discardedCount: current?.discarded_count ?? 0,
          };
        }

        console.log(
          `🔍 DEBUG: Processing ${runStatus.status} job with ${runStatus.defaultDatasetId} items`
        );

        // Get dataset items and save to database (even for timed-out or aborted jobs)
        const items = await this.getDatasetItems(runStatus.defaultDatasetId);
        console.log(`🔍 DEBUG: Retrieved ${items.length} items from dataset`);

        // Prefer execution id stamped on the job (orchestration-created); else resolve from step / run.
        let orchestrationExecutionId: string | undefined =
          job.orchestration_execution_id ?? undefined;
        if (orchestrationExecutionId) {
          console.log(
            `🔍 DEBUG: Using ScrapeJob.orchestration_execution_id ${orchestrationExecutionId} for job ${job.id}`
          );
        }
        try {
          if (!orchestrationExecutionId) {
            const stepExecution = await prisma.orchestrationStepExecution.findFirst({
              where: {
                scrape_job_id: job.id,
                deleted_at: null,
              },
              include: {
                thread_execution: {
                  include: {
                    execution: {
                      select: { id: true },
                    },
                  },
                },
              },
            });

            if (stepExecution?.thread_execution?.execution) {
              orchestrationExecutionId = stepExecution.thread_execution.execution.id;
              console.log(
                `🔍 DEBUG: Found orchestration execution ID ${orchestrationExecutionId} for job ${job.id}`
              );
            } else if (stepExecution?.thread_execution) {
              const te = stepExecution.thread_execution as { execution_id?: string };
              if (te.execution_id) {
                orchestrationExecutionId = te.execution_id;
                console.log(
                  `🔍 DEBUG: Found orchestration execution ID ${orchestrationExecutionId} for job ${job.id} (thread_execution.execution_id)`
                );
              }
            }
            if (!orchestrationExecutionId && job.orchestration_run_id) {
              const orchRun = await prisma.orchestrationRun.findFirst({
                where: { id: job.orchestration_run_id, deleted_at: null },
                select: { orchestration_execution_id: true },
              });
              if (orchRun?.orchestration_execution_id) {
                orchestrationExecutionId = orchRun.orchestration_execution_id;
                console.log(
                  `🔍 DEBUG: Resolved orchestration execution ID ${orchestrationExecutionId} from OrchestrationRun ${job.orchestration_run_id} (fallback for job ${job.id})`
                );
              }
            }
          }
        } catch (lookupError) {
          console.error(
            `⚠️  Error looking up orchestration execution for job ${job.id}:`,
            lookupError
          );
        }

        console.log(
          `🔍 DEBUG: About to call processAndSavePosts for job ${job.id} with ${items.length} items`
        );
        let scraperConfigParsed: { oldestPostDate?: string } | undefined;
        try {
          scraperConfigParsed = JSON.parse(job.scraper.config_json || "{}");
        } catch {
          scraperConfigParsed = undefined;
        }
        let sourceVideoUrls: string[] | undefined;
        if (
          job.used_urls &&
          job.scraper.url_input_source_scraper &&
          (job.scraper.platform?.toLowerCase() === "youtube" ||
            job.scraper.name?.toLowerCase().includes("comment") ||
            job.scraper.actor_id === "p7UMdpQnjKmmpR21D")
        ) {
          try {
            sourceVideoUrls = JSON.parse(job.used_urls) as string[];
          } catch {
            sourceVideoUrls = undefined;
          }
        }
        const { savedCount, discardedCount, newCount, updatedCount } =
          await this.processAndSavePosts(
            job.project_id,
            job.id,
            items,
            false, // isTest = false for regular scraping jobs
            job.scraper.platform, // platform from scraper
            job.scraper.name, // scraper name
            job.scraper.save_to_db, // save_to_db setting from scraper
            orchestrationExecutionId, // orchestration execution ID
            scraperConfigParsed, // for oldestPostDate (YouTube) filtering
            job.scraper.url_input_source_scraper ?? undefined, // skip YouTube validation when consuming from prior scraper (e.g. Comments)
            sourceVideoUrls ?? undefined, // single-video fallback for thread_ref_id when actor doesn't include videoId per comment
            job.orchestration_run_id ?? undefined // for task-based analysis stamping
          );

        console.log(
          `🔍 DEBUG: processAndSavePosts returned savedCount: ${savedCount}, discardedCount: ${discardedCount}, newCount: ${newCount}, updatedCount: ${updatedCount}`
        );

        // Mark used downstream URLs as processed
        if (job.used_urls && job.scraper.url_input_source_scraper) {
          try {
            const usedUrls = JSON.parse(job.used_urls) as string[];
            await this.cleanupUsedUrls(
              job.project_id,
              usedUrls,
              job.scraper.url_input_source_scraper
            );
          } catch (error) {
            console.error("Error parsing used URLs for cleanup:", error);
          }
        }

        // Unified cleanup for all downstream-dependent scrapers (X Post Replies, Facebook/LinkedIn/YouTube Comments):
        // After the job completes, delete DownstreamPost records from the source scraper for THIS orchestration
        // execution only (orchestration_execution_id). This prevents reuse and table growth while avoiding
        // deleting records from other runs.
        const isTwitterPostReplies =
          runStatus.status === "SUCCEEDED" &&
          job.scraper.name === "X (Twitter) Post Replies Scraper";
        const isCommentsScraper =
          (job.scraper.platform?.toLowerCase() === "facebook" &&
            job.scraper.name?.toLowerCase().includes("comments")) ||
          (job.scraper.platform?.toLowerCase() === "linkedin" &&
            job.scraper.name?.toLowerCase().includes("comment")) ||
          (job.scraper.platform?.toLowerCase() === "youtube" &&
            (job.scraper.name?.toLowerCase().includes("comment") ||
              job.scraper.actor_id === "p7UMdpQnjKmmpR21D"));

        // Twitter Post Replies: do NOT delete search seeds here. Multi-batch runs finish one Apify job at a time;
        // deleting by execution after batch 1 removes rows Profile Posts (step 3) still needs. Cleanup runs when
        // the orchestration execution completes successfully (see completeOrchestrationExecution).
        const shouldCleanupDownstream =
          runStatus.status === "SUCCEEDED" &&
          !isTwitterPostReplies &&
          isCommentsScraper &&
          job.scraper.url_input_source_scraper;

        if (shouldCleanupDownstream) {
          const platformLabel =
            job.scraper.platform?.toLowerCase() === "facebook"
              ? "Facebook Comments"
              : job.scraper.platform?.toLowerCase() === "youtube"
                ? "YouTube Comments"
                : "LinkedIn Comments";

          try {
            // Source scraper name(s) to delete: only records that fed this job
            const sourceScraperNames: string[] = isTwitterPostReplies
              ? ["Twitter (X.com) Search Scraper"]
              : (() => {
                  const source = (job.scraper.url_input_source_scraper as string) || "";
                  if (platformLabel === "YouTube Comments") {
                    return [
                      source,
                      source.trim().toLowerCase() === "youtube search"
                        ? "YouTube Scraper"
                        : "YouTube Search",
                    ].filter(Boolean);
                  }
                  return [source].filter(Boolean);
                })();

            if (sourceScraperNames.length === 0) {
              console.log(
                `[DownstreamPost] ${platformLabel}: no source scraper to clean up, skipping`
              );
            } else {
              console.log(
                `[DownstreamPost] ${platformLabel}: cleaning up source records from ${sourceScraperNames.join(", ")}`
              );

              const normalizedProjectId =
                typeof job.project_id === "string" && job.project_id.trim() !== ""
                  ? job.project_id
                  : null;

              let orchestrationExecutionId: string | null = job.orchestration_execution_id ?? null;
              if (orchestrationExecutionId) {
                console.log(
                  `[DownstreamPost] ${platformLabel}: orchestration_execution_id=${orchestrationExecutionId} (from ScrapeJob)`
                );
              }
              try {
                if (!orchestrationExecutionId) {
                  const stepExecution = await prisma.orchestrationStepExecution.findFirst({
                    where: { scrape_job_id: job.id, deleted_at: null },
                    include: {
                      thread_execution: {
                        include: { execution: { select: { id: true } } },
                      },
                    },
                  });
                  if (stepExecution?.thread_execution?.execution) {
                    orchestrationExecutionId = stepExecution.thread_execution.execution.id;
                    console.log(
                      `[DownstreamPost] ${platformLabel}: orchestration_execution_id=${orchestrationExecutionId} (from step)`
                    );
                  } else {
                    console.log(
                      `[DownstreamPost] ${platformLabel}: ⚠️  No orchestration execution for job ${job.id}, using fallback scope`
                    );
                  }
                }
              } catch (lookupError) {
                console.error(
                  `[DownstreamPost] ${platformLabel}: Error looking up orchestration execution:`,
                  lookupError
                );
              }

              const deleteWhere: any = {
                origScraper:
                  sourceScraperNames.length > 1
                    ? { in: sourceScraperNames }
                    : sourceScraperNames[0],
              };

              if (orchestrationExecutionId) {
                deleteWhere.orchestration_execution_id = orchestrationExecutionId;
                console.log(
                  `[DownstreamPost] ${platformLabel}: 🛡️  Deleting only records for this execution`
                );
              } else if (normalizedProjectId) {
                const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
                deleteWhere.OR = [
                  { project_id: normalizedProjectId },
                  { project_id: null, createdAt: { gte: twoHoursAgo } },
                ];
              } else {
                const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
                deleteWhere.project_id = null;
                deleteWhere.createdAt = { gte: twoHoursAgo };
              }

              const deleteResult = await prisma.downstreamPost.deleteMany({
                where: deleteWhere,
              });

              console.log(
                `[DownstreamPost] ${platformLabel}: Deleted ${deleteResult.count} records (execution_id: ${orchestrationExecutionId ?? "none"})`
              );
            }
          } catch (error) {
            console.error(
              `[DownstreamPost] ${platformLabel}: Error cleaning up source records:`,
              error
            );
          }
        }

        // Update all job rows for this run with final counts (so any waiter for another row with same apify_run_id sees them)
        await prisma.scrapeJob.updateMany({
          where: { apify_run_id: job.apify_run_id },
          data: {
            posts_count: savedCount,
            discarded_count: discardedCount,
          },
        });

        console.log(
          `🔍 DEBUG: Updated job(s) for run ${job.apify_run_id} with ${savedCount} posts (${newCount} new, ${updatedCount} updated)`
        );

        return { newCount, updatedCount, savedCount, discardedCount };
      } else if (runStatus.status === "FAILED" || runStatus.status === "ABORTED") {
        console.log(`🔍 DEBUG: Job ${job.id} has ${runStatus.status} status - marking as FAILED`);
        // Update job as failed
        await prisma.scrapeJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            completed_at: new Date(),
            error_message: `Run failed with status: ${runStatus.status}`,
          },
        });

        return null; // Failed jobs don't have counts
      } else {
        console.log(`🔍 DEBUG: Job ${job.id} has unexpected status: ${runStatus.status}`);
        return null; // Unexpected status
      }
    } catch (error) {
      console.error(`🔍 DEBUG: Error updating job status for ${jobId}:`, error);
      // Update job as failed with error message
      await prisma.scrapeJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          completed_at: new Date(),
          error_message: `Error processing job: ${error instanceof Error ? error.message : String(error)}`,
        },
      });

      return null; // Error case
    }
  }
}

// Export singleton instance
export const apifyService = new ApifyService();
