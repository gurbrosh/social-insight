/**
 * CLI: run Hacker News story analysis for a project.
 * Usage: npx tsx scripts/run-hn-story-analysis.ts <projectId> [limit]
 * Optional env: HN_STORY_IDS=comma,separated (processes these ids with forceStoryIds)
 */

import { runHnStoryAnalysis } from "../lib/hn-story-analysis-pipeline";

async function main() {
  const projectId = process.argv[2];
  const limitArg = process.argv[3];
  if (!projectId) {
    console.error("Usage: npx tsx scripts/run-hn-story-analysis.ts <projectId> [limit]");
    process.exit(1);
  }
  const limit = limitArg ? Math.max(1, parseInt(limitArg, 10) || 15) : 15;
  const idsEnv = process.env.HN_STORY_IDS?.trim();
  const storyIds = idsEnv
    ? idsEnv
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  const result = await runHnStoryAnalysis(projectId, {
    limit,
    storyIds,
    forceStoryIds: Boolean(storyIds && storyIds.length > 0),
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
