import { prisma } from "@/lib/prisma";
import {
  envTruthy,
  expandVariants,
  loadKeywordVariants,
  parseCanonicalKeywords,
} from "@/lib/hackernews/config";
import { ingestGithubKeyword, type GithubIngestMode } from "./ingest-github-keyword";

export function parseGithubModes(raw: string | undefined): GithubIngestMode[] {
  if (!raw?.trim()) return ["repo", "code"];
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const out: GithubIngestMode[] = [];
  for (const p of parts) {
    if (p === "repo" || p === "code" || p === "activity") out.push(p);
  }
  return out.length ? out : ["repo", "code"];
}

function maxIso(a: string, b: string): string {
  const at = a.trim() ? new Date(a).getTime() : 0;
  const bt = b.trim() ? new Date(b).getTime() : 0;
  if (!a.trim()) return b;
  if (!b.trim()) return a;
  return at >= bt ? a : b;
}

export type RunGithubIngestionOptions = {
  canonicalKeywords: string[];
  variantsMap: Record<string, string[]>;
  modes: GithubIngestMode[];
  enrichRepos: boolean;
  codeLookbackDays: number;
};

export type RunGithubIngestionSummary = {
  canonicalKeywords: string[];
  results: {
    canonical: string;
    mode: GithubIngestMode;
    variants: string[];
    floor: string;
    newCursor: string;
  }[];
};

export function loadGithubRunOptionsFromEnv(): RunGithubIngestionOptions {
  return {
    canonicalKeywords: parseCanonicalKeywords(process.env.GH_INGEST_KEYWORDS),
    variantsMap: loadKeywordVariants(process.env.GH_KEYWORD_VARIANTS_JSON),
    modes: parseGithubModes(process.env.GH_INGEST_MODES),
    enrichRepos: envTruthy(process.env.GH_ENRICH_REPOS),
    codeLookbackDays: parseInt(process.env.GH_CODE_LOOKBACK_DAYS || "7", 10) || 7,
  };
}

export async function runGithubIngestion(
  options: RunGithubIngestionOptions
): Promise<RunGithubIngestionSummary> {
  const results: RunGithubIngestionSummary["results"] = [];
  const seenGithubRepoIdsInRun = new Set<string>();

  for (const canonical of options.canonicalKeywords) {
    const variants = expandVariants(canonical, options.variantsMap);

    for (const mode of options.modes) {
      const cursorRow = await prisma.githubIngestCursor.findFirst({
        where: { keyword: canonical, mode, deleted_at: null },
      });
      const floor = cursorRow?.cursor_value ?? "";
      let mergedCursor = floor;

      for (const variant of variants) {
        const { newCursor } = await ingestGithubKeyword({
          keyword: variant,
          mode,
          cursor: floor,
          enrichRepos: options.enrichRepos,
          codeLookbackDays: options.codeLookbackDays,
          seenGithubRepoIdsInRun,
        });
        mergedCursor = maxIso(mergedCursor, newCursor);
      }

      await prisma.githubIngestCursor.upsert({
        where: {
          keyword_mode: {
            keyword: canonical,
            mode,
          },
        },
        create: {
          keyword: canonical,
          mode,
          cursor_value: mergedCursor,
        },
        update: {
          cursor_value: mergedCursor,
          deleted_at: null,
        },
      });

      results.push({
        canonical,
        mode,
        variants,
        floor,
        newCursor: mergedCursor,
      });
    }
  }

  return {
    canonicalKeywords: options.canonicalKeywords,
    results,
  };
}
