import type { SearchSourceTask } from "@prisma/client";
import { ingestKeyword } from "@/lib/hackernews/ingest-keyword";
import { syncCommentThemesForStories } from "@/lib/hackernews/story-comment-themes-sync";
import { runHnStoryAnalysis } from "@/lib/hn-story-analysis-pipeline";
import { prisma } from "@/lib/prisma";
import { getSinceDate } from "@/lib/search-source-task-runner";
import type {
  CustomTask,
  CustomTaskRunOptions,
  CustomTaskRunTestOptions,
  CustomTaskTestResult,
} from "./types";
import { findProjectIdByName } from "./project-resolution";
import { loadProjectListeningTerms } from "./project-listening-terms";
import { isTaskTestCancelledError, throwIfAborted } from "./task-test-abort";

export const TARGET_HACKER_NEWS = "HackerNews";

/** Max keywords per test run to limit Algolia traffic. */
const HN_TEST_MAX_TERMS = 20;

/** Sample posts per keyword in test output (titles + URLs from DB after ingest). */
const HN_TEST_PREVIEW_SAMPLE = 8;

const HN_SOURCE = "hackernews";

function truncatePreviewLine(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

async function formatKeywordSamplePreview(
  keyword: string,
  floorUnix: number
): Promise<{ lines: string[]; totalInWindow: number }> {
  const baseWhere = {
    source: HN_SOURCE,
    keyword,
    deleted_at: null,
    published_at_unix: { gte: floorUnix },
  };

  const total = await prisma.sourceMention.count({ where: baseWhere });
  const rows = await prisma.sourceMention.findMany({
    where: baseWhere,
    orderBy: { published_at_unix: "desc" },
    take: HN_TEST_PREVIEW_SAMPLE,
    select: {
      title: true,
      url: true,
      item_type: true,
      story_score: true,
    },
  });

  const header =
    total === 0
      ? "  No items in this lookback window (search returned nothing new to store, or all were duplicates)."
      : `  ${total} item(s) in window — showing up to ${Math.min(HN_TEST_PREVIEW_SAMPLE, total)} newest:`;

  const lines: string[] = [header];
  if (rows.length === 0) {
    return { lines, totalInWindow: total };
  }

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const title = truncatePreviewLine(r.title ?? "(no title)", 140);
    const url = (r.url ?? "").trim();
    const bits = [r.item_type, r.story_score != null ? `${r.story_score} pts` : null].filter(
      Boolean
    );
    const meta = bits.length ? ` (${bits.join(" · ")})` : "";
    lines.push(`  ${i + 1}. ${title}${meta}`);
    if (url) {
      lines.push(`     ${url}`);
    }
  }
  return { lines, totalInWindow: total };
}

export function parseHnKeywordCsv(csv: string): string[] {
  return [
    ...new Set(
      csv
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  ];
}

/** Saved default terms from `SearchSourceTask.config_json` (set via admin Update). */
export function getHnKeywordCsvFromTaskConfig(task: SearchSourceTask): string | null {
  const raw = task.config_json?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { hnKeywordCsv?: string };
    const v = typeof parsed.hnKeywordCsv === "string" ? parsed.hnKeywordCsv.trim() : "";
    return v || null;
  } catch {
    return null;
  }
}

async function resolveTermsForTest(
  projectId: string,
  task: SearchSourceTask,
  testOptions?: CustomTaskRunTestOptions
): Promise<{ terms: string[]; error?: string }> {
  const explicit = testOptions?.hnKeywordCsv?.trim();
  const saved = getHnKeywordCsvFromTaskConfig(task);
  const csv = (explicit || saved || "").trim();
  if (csv) {
    const terms = parseHnKeywordCsv(csv);
    if (terms.length === 0) {
      return { terms: [], error: "No terms found in keyword list." };
    }
    return { terms: terms.slice(0, HN_TEST_MAX_TERMS) };
  }
  const terms = await loadProjectListeningTerms(projectId);
  if (terms.length === 0) {
    return {
      terms: [],
      error:
        "This project has no keywords or brand names. Add them on the project, or provide a CSV override.",
    };
  }
  return { terms: terms.slice(0, HN_TEST_MAX_TERMS) };
}

async function runIngestForTerms(
  terms: string[],
  task: SearchSourceTask,
  projectId: string,
  testOptions?: CustomTaskRunTestOptions,
  /** Orchestration run id: stamp Posts and defer sentiment/themes/sanitize to task-based analysis. */
  ingestedRunId?: string | null
): Promise<CustomTaskTestResult> {
  const signal = testOptions?.signal;
  const since = getSinceDate(task);
  const floor = Math.floor(since.getTime() / 1000);
  const lines: string[] = [];
  let mentionRowsTotal = 0;
  const allStoryIds = new Set<string>();
  let analysisFooter = "";

  try {
    throwIfAborted(signal);

    for (const kw of terms) {
      throwIfAborted(signal);
      try {
        const { newestTimestamp, distinctStoryIds } = await ingestKeyword({
          keyword: kw,
          createdAfterUnix: floor,
          enrich: false,
          maxCommentThemeSyncStories: 0,
          signal,
        });
        for (const sid of distinctStoryIds) {
          allStoryIds.add(sid);
        }
        lines.push(`"${kw}": done (newest item unix ts ${newestTimestamp})`);
        const { lines: sample, totalInWindow } = await formatKeywordSamplePreview(kw, floor);
        mentionRowsTotal += totalInWindow;
        lines.push(...sample);
        lines.push("");
      } catch (e) {
        if (isTaskTestCancelledError(e)) {
          throw e;
        }
        const msg = e instanceof Error ? e.message : String(e);
        lines.push(`"${kw}": error — ${msg}`);
        lines.push("");
      }
    }

    throwIfAborted(signal);

    try {
      if (allStoryIds.size > 0) {
        const result = await runHnStoryAnalysis(projectId, {
          storyIds: [...allStoryIds],
          forceStoryIds: true,
          limit: allStoryIds.size,
          signal,
          ...(ingestedRunId != null ? { ingestedRunId } : {}),
        });
        analysisFooter = [
          "",
          `HN story analysis (project-scoped): seen=${result.candidatesSeen} created=${result.analysesCreated} skippedAlready=${result.skippedAlreadyAnalyzed} skippedNotFound=${result.skippedNotFound} skippedLowRelOrAd=${result.skippedLowRelevanceOrAd} posts=${result.postsCreated}`,
          ingestedRunId
            ? `Orchestration run ${ingestedRunId}: sentiment/themes/sanitize run via task-based analysis after orchestration completes.`
            : "",
          result.errorMessage ? `Note: ${result.errorMessage}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      }
    } catch (e) {
      if (isTaskTestCancelledError(e)) {
        throw e;
      }
      const msg = e instanceof Error ? e.message : String(e);
      analysisFooter = `\n\nHN story analysis failed: ${msg}`;
    }

    throwIfAborted(signal);

    if (allStoryIds.size > 0) {
      try {
        await syncCommentThemesForStories([...allStoryIds], undefined, signal);
      } catch (e) {
        if (isTaskTestCancelledError(e)) {
          throw e;
        }
        const msg = e instanceof Error ? e.message : String(e);
        analysisFooter = `${analysisFooter}\n\nComment theme sync failed: ${msg}`;
      }
    }

    const preview = [
      `Lookback: items newer than ${since.toISOString()} (UTC).`,
      `Terms run: ${terms.length}.`,
      `Total stored mentions in window (all terms): ${mentionRowsTotal}.`,
      `Distinct HN stories this run: ${allStoryIds.size}. Order: HnStoryAnalysis first, then HnStoryCommentTheme (slow).`,
      "",
      ...lines,
      analysisFooter,
    ].join("\n");
    return {
      success: true,
      resultPreview: preview,
      errorMessage: null,
      rowCount: mentionRowsTotal,
    };
  } catch (e) {
    if (isTaskTestCancelledError(e)) {
      const preview = [
        `Lookback: items newer than ${since.toISOString()} (UTC).`,
        `Terms run: ${terms.length}.`,
        `Total stored mentions in window (all terms): ${mentionRowsTotal}.`,
        `Distinct HN stories collected: ${allStoryIds.size}.`,
        "",
        ...lines,
        analysisFooter,
        "",
        "---",
        "Test stopped (cancelled). Partial results above.",
      ].join("\n");
      return {
        success: false,
        resultPreview: preview,
        errorMessage: "Test stopped.",
        rowCount: mentionRowsTotal,
      };
    }
    throw e;
  }
}

export class HackerNewsCustomTask implements CustomTask {
  readonly id: string;

  constructor(private readonly task: SearchSourceTask) {
    this.id = task.id;
  }

  get name(): string {
    return this.task.name;
  }

  get description(): string | null {
    return this.task.description;
  }

  get targetKey(): string | null {
    return TARGET_HACKER_NEWS;
  }

  async run(projectId: string, options: CustomTaskRunOptions): Promise<CustomTaskTestResult> {
    const ingestedRunId = options.ingestedRunId ?? null;
    const saved = getHnKeywordCsvFromTaskConfig(this.task);
    if (saved) {
      const terms = parseHnKeywordCsv(saved);
      if (terms.length === 0) {
        return {
          success: false,
          resultPreview: null,
          errorMessage: "Saved keyword list is empty or invalid.",
          rowCount: 0,
        };
      }
      return runIngestForTerms(
        terms.slice(0, HN_TEST_MAX_TERMS),
        this.task,
        projectId,
        undefined,
        ingestedRunId
      );
    }
    const terms = await loadProjectListeningTerms(projectId);
    if (terms.length === 0) {
      return {
        success: false,
        resultPreview: null,
        errorMessage:
          "No saved CSV keywords and no keywords or brand names on this project. Add terms on the project or save a CSV on the task.",
        rowCount: 0,
      };
    }
    const limited = terms.slice(0, HN_TEST_MAX_TERMS);
    return runIngestForTerms(limited, this.task, projectId, undefined, ingestedRunId);
  }

  async runTest(
    projectName: string,
    testOptions?: CustomTaskRunTestOptions
  ): Promise<CustomTaskTestResult> {
    const projectId = await findProjectIdByName(projectName);
    if (!projectId) {
      return {
        success: false,
        resultPreview: null,
        errorMessage: `No active project found with name "${projectName.trim()}".`,
        rowCount: 0,
      };
    }
    const { terms, error } = await resolveTermsForTest(projectId, this.task, testOptions);
    if (error || terms.length === 0) {
      return {
        success: false,
        resultPreview: null,
        errorMessage: error ?? "No terms to search.",
        rowCount: 0,
      };
    }
    return runIngestForTerms(terms, this.task, projectId, testOptions);
  }
}

export function createHackerNewsCustomTask(task: SearchSourceTask): HackerNewsCustomTask {
  return new HackerNewsCustomTask(task);
}
