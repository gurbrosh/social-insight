/**
 * Check if the post(s) for a given blog article URL were processed in orchestration
 * (ingested_run_id, RunRecord, SENTIMENT/THEMES tasks, ThemesAnalysis).
 *
 * Run: npx tsx scripts/diagnose-post-run-and-themes.ts <projectId> <articleUrl>
 *   Or: npx tsx scripts/diagnose-post-run-and-themes.ts <articleUrl>
 *       (finds any project that has this URL and runs the check)
 * Example: npx tsx scripts/diagnose-post-run-and-themes.ts "https://liveandletsfly.com/delta-hawaii-flights/"
 */

import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient();

let projectId: string | null = process.argv[2] ?? null;
let articleUrl: string | null = process.argv[3] ?? null;
if (!articleUrl) {
  articleUrl = projectId;
  projectId = null;
}
if (!articleUrl) {
  console.error("Usage: npx tsx scripts/diagnose-post-run-and-themes.ts [projectId] <articleUrl>");
  process.exit(1);
}

function urlToHash(u: string): string {
  return crypto.createHash("sha256").update(u.trim()).digest("hex").slice(0, 24);
}

async function main() {
  const urlNorm = articleUrl!.trim();
  const urlNormNoTrailing = urlNorm.replace(/\/+$/, "") || urlNorm;
  const hashWithSlash = urlToHash(urlNorm);
  const hashNoSlash = urlToHash(urlNormNoTrailing);

  let resolvedProjectId = projectId;
  if (!resolvedProjectId) {
    const byAnalysis = await prisma.blogNewsAnalysis.findFirst({
      where: {
        deleted_at: null,
        OR: [
          { article_url: { contains: urlNorm } },
          { article_url: { contains: urlNormNoTrailing } },
        ],
      },
      select: { project_id: true },
    });
    const byPost = await prisma.post.findFirst({
      where: {
        platform: "blogs",
        OR: [
          { url: { contains: urlNorm } },
          { url: { contains: urlNormNoTrailing } },
          { postId: { startsWith: hashWithSlash } },
          { postId: { startsWith: hashNoSlash } },
        ],
      },
      select: { project_id: true },
    });
    resolvedProjectId = byAnalysis?.project_id ?? byPost?.project_id ?? null;
    if (!resolvedProjectId) {
      console.log("Article URL:", urlNorm);
      console.log("No BlogNewsAnalysis or Post found for this URL in any project.");
      return;
    }
    console.log("Project not specified; using project id:", resolvedProjectId, "\n");
  }

  console.log("Article URL:", urlNorm);
  console.log("Hash (with trailing slash):", hashWithSlash);
  console.log("Hash (no trailing slash):", hashNoSlash);
  console.log("");

  const analyses = await prisma.blogNewsAnalysis.findMany({
    where: {
      project_id: resolvedProjectId,
      deleted_at: null,
      OR: [
        { article_url: { contains: urlNorm } },
        { article_url: { contains: urlNormNoTrailing } },
        { source_url: { contains: urlNorm } },
        { source_url: { contains: urlNormNoTrailing } },
      ],
    },
    select: { id: true, article_url: true, source_url: true, article_title: true },
  });

  const blogPosts = await prisma.blogPost.findMany({
    where: {
      project_id: resolvedProjectId,
      deleted_at: null,
      OR: [
        { article_url: { contains: urlNorm } },
        { article_url: { contains: urlNormNoTrailing } },
      ],
    },
    select: { id: true, article_url: true, article_title: true, ingested_run_id: true },
  });

  console.log("--- BlogNewsAnalysis ---");
  if (analyses.length === 0) {
    console.log("None found for this URL in this project.");
  } else {
    analyses.forEach((a) => {
      console.log(
        `  id=${a.id.slice(0, 12)}... article_url=${a.article_url ?? a.source_url ?? ""}`
      );
    });
  }

  console.log("\n--- BlogPost ---");
  if (blogPosts.length === 0) {
    console.log("None found for this URL in this project.");
  } else {
    blogPosts.forEach((bp) => {
      console.log(
        `  id=${bp.id.slice(0, 12)}... article_url=${bp.article_url} ingested_run_id=${bp.ingested_run_id ?? "(null)"}`
      );
    });
  }

  const posts = await prisma.post.findMany({
    where: {
      project_id: resolvedProjectId,
      platform: "blogs",
      OR: [
        { url: { contains: urlNorm } },
        { url: { contains: urlNormNoTrailing } },
        { postId: { startsWith: hashWithSlash } },
        { postId: { startsWith: hashNoSlash } },
      ],
    },
    select: {
      id: true,
      postId: true,
      url: true,
      content: true,
      ingested_run_id: true,
      sentiment: true,
      createdAt: true,
    },
  });

  console.log("\n--- Post(s) (platform=blogs) ---");
  if (posts.length === 0) {
    console.log("None found. PostId for this URL would look like: " + hashWithSlash + "--idea-1");
    return;
  }

  for (const post of posts) {
    console.log(
      "\nPost id=" + post.id + " postId=" + post.postId + " url=" + (post.url ?? "(null)")
    );
    console.log("  ingested_run_id:", post.ingested_run_id ?? "(null)");
    console.log("  sentiment:", post.sentiment ?? "(null)");
    console.log("  createdAt:", post.createdAt);

    if (!post.ingested_run_id) {
      console.log(
        "  => Not in a run: no RunRecord or THEMES task; theme matching would not run for this post."
      );
      const themes = await prisma.themesAnalysis.findMany({
        where: { post_id: post.id, deleted_at: null },
        select: { id: true, theme_name: true, relevance_score: true },
      });
      console.log("  ThemesAnalysis rows for this post_id:", themes.length);
      themes.forEach((t) => console.log("    -", t.theme_name, "relevance=" + t.relevance_score));
      continue;
    }

    const runId = post.ingested_run_id;
    const runRecord = await prisma.runRecord.findFirst({
      where: {
        run_id: runId,
        record_type: "POST",
        record_key: String(post.id),
        deleted_at: null,
      },
      select: { id: true },
    });
    console.log("  RunRecord (POST," + post.id + "):", runRecord ? "exists" : "MISSING");

    const tasks = await prisma.analysisTask.findMany({
      where: {
        project_id: resolvedProjectId,
        record_type: "POST",
        record_key: String(post.id),
        deleted_at: null,
      },
      select: { step: true, state: true, result_version: true },
    });
    console.log("  AnalysisTask(s):", tasks.length);
    tasks.forEach((t) => console.log("    -", t.step, t.state, "v" + t.result_version));

    const themes = await prisma.themesAnalysis.findMany({
      where: { post_id: post.id, deleted_at: null },
      select: { id: true, theme_name: true, relevance_score: true },
    });
    console.log("  ThemesAnalysis:", themes.length);
    themes.forEach((t) => console.log("    -", t.theme_name, "relevance=" + t.relevance_score));
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
