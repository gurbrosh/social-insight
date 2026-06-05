/**
 * Run blog post table analysis with stopAfterKeyIdeas: only pre-check (title-only) + create rows + key-ideas extraction.
 * Skips dedupe, Post creation, theme matching, mention count, sentiment. Use to test idea extraction quality and cost.
 *
 * Usage:
 *   npx tsx scripts/run-blog-analysis-ideas-only.ts [projectId]
 *   npx tsx scripts/run-blog-analysis-ideas-only.ts [projectId] --reset
 *
 * With --reset: deletes BlogNewsAnalysis for the project and resets the blog cursor so all BlogPost rows are re-processed.
 * Without --reset: processes only posts after the current cursor (next batch).
 */

import { prisma } from "../lib/prisma";
import { runBlogPostTableAnalysis } from "../lib/blog-post-analysis-pipeline";
import { getBlogAnalysisCursor } from "../lib/analysis-progress";
import { generateId } from "../lib/utils/ulid";

async function main() {
  const args = process.argv.slice(2);
  const resetIdx = args.indexOf("--reset");
  const reset = resetIdx !== -1;
  if (reset) args.splice(resetIdx, 1);
  const projectIdArg = args[0];

  let projectId: string;
  if (projectIdArg) {
    projectId = projectIdArg;
    const p = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!p) {
      console.error("Project not found:", projectId);
      process.exit(1);
    }
  } else {
    const first = await prisma.project.findFirst({
      where: { deleted_at: null },
      select: { id: true },
    });
    if (!first) {
      console.error("No project found.");
      process.exit(1);
    }
    projectId = first.id;
    console.log("Using first project:", projectId);
  }

  if (reset) {
    const cursor = await getBlogAnalysisCursor(projectId);
    const deleted = await prisma.blogNewsAnalysis.deleteMany({ where: { project_id: projectId } });
    await prisma.analysisProgress.upsert({
      where: { project_id: projectId },
      update: { last_blog_analysis_post_id: null },
      create: {
        id: generateId(),
        project_id: projectId,
        last_blog_analysis_post_id: null,
      },
    });
    console.log(
      `Reset: deleted ${deleted.count} BlogNewsAnalysis, cleared cursor${cursor ? ` (was ${cursor})` : ""}.`
    );
  }

  console.log("Running blog analysis (title-only pre-check + key-ideas only)...\n");
  const result = await runBlogPostTableAnalysis(projectId, { stopAfterKeyIdeas: true });

  console.log("\nResult:", {
    postsProcessed: result.postsProcessed,
    analysesCreated: result.analysesCreated,
    ideasExtracted: result.ideasExtracted,
    errorMessage: result.errorMessage ?? undefined,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
