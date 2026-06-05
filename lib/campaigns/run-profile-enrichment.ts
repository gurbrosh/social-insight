import { apifyService } from "@/lib/apify-service";
import { normalizePublicProfileUrl } from "@/lib/linkedin-prospects-csv/normalize-url";
import {
  APIFY_LINKEDIN_FULL_PROFILE_ACTOR_ID,
  APIFY_PROFILE_ENRICHMENT_NOT_CONFIGURED_MESSAGE,
} from "./constants";

export type ProfileEnrichmentApifyInput = {
  profileUrls: string[];
};

export function isApifyProfileEnrichmentNotConfiguredError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("APIFY_API_TOKEN") ||
    msg.includes("Apify API token") ||
    msg.includes("API token")
  );
}

export type RunProfileEnrichmentBatchResult =
  | {
      ok: true;
      itemsByNormalizedUrl: Map<string, Record<string, unknown>>;
      rawCount: number;
      warnings: string[];
    }
  | { ok: false; error: string; apifyNotConfigured?: boolean };

function indexKey(url: string): string {
  return normalizePublicProfileUrl(url) ?? url.trim().toLowerCase().replace(/\/$/, "");
}

function readItemUrl(item: Record<string, unknown>): string | null {
  const candidates = [item.linkedinUrl, item.linkedin_url, item.profileUrl, item.url];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

/**
 * Run Apify full LinkedIn profile actor synchronously for a batch of profile URLs.
 */
export async function runProfileEnrichmentBatch(args: {
  profileUrls: string[];
  fetchItems?: (input: ProfileEnrichmentApifyInput) => Promise<Record<string, unknown>[]>;
}): Promise<RunProfileEnrichmentBatchResult> {
  const uniqueUrls = [...new Set(args.profileUrls.map((u) => u.trim()).filter(Boolean))];
  if (uniqueUrls.length === 0) {
    return { ok: true, itemsByNormalizedUrl: new Map(), rawCount: 0, warnings: [] };
  }

  const input: ProfileEnrichmentApifyInput = { profileUrls: uniqueUrls };
  const warnings: string[] = [];

  let rawItems: Record<string, unknown>[];

  try {
    if (args.fetchItems) {
      rawItems = await args.fetchItems(input);
    } else {
      const run = await apifyService.runScraperSync(
        APIFY_LINKEDIN_FULL_PROFILE_ACTOR_ID,
        input,
        "linkedin"
      );
      const datasetId = run.defaultDatasetId;
      if (!datasetId) {
        return { ok: false, error: "Apify run completed without a dataset ID." };
      }
      rawItems = (await apifyService.getDatasetItems(datasetId)) as Record<string, unknown>[];
    }
  } catch (e) {
    if (isApifyProfileEnrichmentNotConfiguredError(e)) {
      return {
        ok: false,
        error: APIFY_PROFILE_ENRICHMENT_NOT_CONFIGURED_MESSAGE,
        apifyNotConfigured: true,
      };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg || "Profile enrichment failed." };
  }

  const itemsByNormalizedUrl = new Map<string, Record<string, unknown>>();
  for (const item of rawItems) {
    if (!item || typeof item !== "object") continue;
    const url = readItemUrl(item as Record<string, unknown>);
    if (!url) continue;
    itemsByNormalizedUrl.set(indexKey(url), item as Record<string, unknown>);
  }

  if (itemsByNormalizedUrl.size < uniqueUrls.length) {
    warnings.push(
      `${uniqueUrls.length - itemsByNormalizedUrl.size} profile URL(s) had no actor result.`
    );
  }

  return {
    ok: true,
    itemsByNormalizedUrl,
    rawCount: rawItems.length,
    warnings,
  };
}
