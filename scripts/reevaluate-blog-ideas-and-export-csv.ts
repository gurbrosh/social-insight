#!/usr/bin/env tsx

/**
 * Reevaluate key ideas for each blog analysis using the current extraction + gate + rewrite logic,
 * update the database, and export a CSV with article link, title, and idea_1..idea_7.
 *
 * Skips (same as app pipeline): advertorial titles (isLikelyAdvertorialTitle) and out-of-scope
 * analyses (relevance_score < 2). Only runs key-ideas extraction for relevance_score >= 2 (or null).
 *
 * Usage:
 *   npx tsx scripts/reevaluate-blog-ideas-and-export-csv.ts [output-path]
 *   npx tsx scripts/reevaluate-blog-ideas-and-export-csv.ts [output-path] --project-id <projectId>
 *   npx tsx scripts/reevaluate-blog-ideas-and-export-csv.ts [output-path] --rescore-relevance
 *
 * --rescore-relevance: Re-score relevance using semantic project scope ("what is this user curious about?")
 *   and update stored relevance_score/is_ad. Then skip or include rows by the new score. Use to re-evaluate
 *   previously skipped posts against the project's semantic scope.
 *
 * Requires: OPENAI_API_KEY. Article text is read from BlogPost.content (full transcript/body); matching is by project_id + article_url (normalized).
 * Default output: blog-ideas-reevaluated-YYYY-MM-DDTHH-MM-SS.csv in project root (date-time suffix to avoid overwriting).
 */

import { prisma } from "../lib/prisma";
import {
  analyzeArticlePreCheckTitleOnly,
  extractKeyIdeasFromArticle,
} from "../lib/blog-news-analysis-service";
import { getProjectContextForRelevance } from "../lib/comprehensive-analysis";
import { isLikelyAdvertorialTitle } from "../lib/blog-advertorial-patterns";
import * as fs from "fs";
import * as path from "path";

function escapeCsvValue(value: unknown): string {
  if (value == null) return "";
  const s = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Normalize article URL for matching (trim, drop search/hash, strip trailing slash). */
function normalizeArticleUrl(url: string): string {
  const u = url.trim();
  if (!u) return u;
  try {
    const parsed = new URL(u);
    parsed.search = "";
    parsed.hash = "";
    let out = parsed.toString();
    if (out.endsWith("/")) out = out.slice(0, -1);
    return out;
  } catch {
    return u.replace(/\/+$/, "");
  }
}

function parseArgs(): { outputPath: string; projectId?: string; rescoreRelevance: boolean } {
  const args = process.argv.slice(2);
  const projectIdx = args.indexOf("--project-id");
  let projectId: string | undefined;
  if (projectIdx !== -1 && args[projectIdx + 1]) {
    projectId = args[projectIdx + 1];
    args.splice(projectIdx, 2);
  }
  const rescoreRelevance = args.includes("--rescore-relevance");
  if (rescoreRelevance) args.splice(args.indexOf("--rescore-relevance"), 1);
  const defaultName =
    "blog-ideas-reevaluated-" +
    new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) +
    ".csv";
  const outputPath = args[0] ?? path.join(process.cwd(), defaultName);
  return { outputPath, projectId, rescoreRelevance };
}

async function main() {
  const { outputPath, projectId, rescoreRelevance } = parseArgs();

  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is not set. Exiting.");
    process.exit(1);
  }

  const where = { deleted_at: null, ...(projectId ? { project_id: projectId } : {}) };

  const analyses = await prisma.blogNewsAnalysis.findMany({
    where,
    orderBy: [{ project_id: "asc" }, { article_date: "desc" }, { created_at: "asc" }],
    select: {
      id: true,
      project_id: true,
      article_url: true,
      article_title: true,
      relevance_score: true,
    },
  });

  if (analyses.length === 0) {
    console.log("No BlogNewsAnalysis records found.");
    fs.writeFileSync(
      outputPath,
      "article_url,article_title,idea_1,idea_2,idea_3,idea_4,idea_5,idea_6,idea_7\n"
    );
    console.log(`Wrote empty CSV to ${outputPath}`);
    return;
  }

  const projectIds = [...new Set(analyses.map((a) => a.project_id))];
  const semanticScopeByProject = new Map<string, string>();
  if (rescoreRelevance) {
    console.log("Building project context for relevance per project (for --rescore-relevance)...");
    for (const pid of projectIds) {
      const scope = await getProjectContextForRelevance(pid);
      semanticScopeByProject.set(pid, scope);
      if (scope) console.log(`  Project ${pid}: context length ${scope.length}`);
    }
  }
  const postsByProjectUrl = new Map<string, { content: string }>();
  const blogPosts = await prisma.blogPost.findMany({
    where: { deleted_at: null, project_id: { in: projectIds } },
    select: { project_id: true, article_url: true, content: true },
  });
  for (const p of blogPosts) {
    const key = `${p.project_id}\t${normalizeArticleUrl(p.article_url)}`;
    const text = (p.content ?? "").trim();
    if (text) postsByProjectUrl.set(key, { content: text });
  }

  let processed = 0;
  let skipped = 0;
  const csvRows: Array<{ article_url: string; article_title: string | null; ideas: string[] }> = [];

  for (let i = 0; i < analyses.length; i++) {
    const a = analyses[i];
    if (isLikelyAdvertorialTitle(a.article_title)) {
      await prisma.blogNewsAnalysis.update({
        where: { id: a.id },
        data: {
          is_ad: true,
          idea_1: null,
          idea_2: null,
          idea_3: null,
          idea_4: null,
          idea_5: null,
          idea_6: null,
          idea_7: null,
        },
      });
      csvRows.push({
        article_url: a.article_url ?? "",
        article_title: a.article_title ?? null,
        ideas: [],
      });
      skipped++;
      console.log(
        `[${i + 1}/${analyses.length}] ${a.article_title?.slice(0, 50) ?? a.article_url}... filtered (advertorial title)`
      );
      continue;
    }
    let relevanceScore = a.relevance_score;
    let isAd = false;
    if (rescoreRelevance) {
      const scope = semanticScopeByProject.get(a.project_id) ?? "";
      const preCheck = await analyzeArticlePreCheckTitleOnly({
        articleTitle: a.article_title,
        semanticScope: scope || undefined,
      });
      relevanceScore = preCheck.relevance_score;
      isAd = preCheck.is_ad;
      await prisma.blogNewsAnalysis.update({
        where: { id: a.id },
        data: { relevance_score: relevanceScore, is_ad: isAd },
      });
    }
    if (isAd) {
      csvRows.push({
        article_url: a.article_url ?? "",
        article_title: a.article_title ?? null,
        ideas: [],
      });
      skipped++;
      console.log(
        `[${i + 1}/${analyses.length}] ${a.article_title?.slice(0, 50) ?? a.article_url}... filtered (ad)`
      );
      continue;
    }
    if (relevanceScore != null && relevanceScore < 2) {
      csvRows.push({
        article_url: a.article_url ?? "",
        article_title: a.article_title ?? null,
        ideas: [],
      });
      skipped++;
      console.log(
        `[${i + 1}/${analyses.length}] ${a.article_title?.slice(0, 50) ?? a.article_url}... skipped (relevance < 2, out of scope)`
      );
      continue;
    }
    const key = `${a.project_id}\t${normalizeArticleUrl(a.article_url ?? "")}`;
    const post =
      postsByProjectUrl.get(key) ??
      postsByProjectUrl.get(`${a.project_id}\t${(a.article_url ?? "").trim()}`);
    if (!post?.content?.trim()) {
      console.log(`Skipping ${a.article_url}: no content in BlogPost.`);
      skipped++;
      csvRows.push({
        article_url: a.article_url ?? "",
        article_title: a.article_title ?? null,
        ideas: [],
      });
      continue;
    }
    process.stdout.write(
      `[${i + 1}/${analyses.length}] ${a.article_title?.slice(0, 50) ?? a.article_url}... `
    );
    try {
      const ideas = await extractKeyIdeasFromArticle(post.content);
      await prisma.blogNewsAnalysis.update({
        where: { id: a.id },
        data: {
          idea_1: ideas[0] ?? null,
          idea_2: ideas[1] ?? null,
          idea_3: ideas[2] ?? null,
          idea_4: ideas[3] ?? null,
          idea_5: ideas[4] ?? null,
          idea_6: ideas[5] ?? null,
          idea_7: ideas[6] ?? null,
        },
      });
      csvRows.push({
        article_url: a.article_url ?? "",
        article_title: a.article_title ?? null,
        ideas,
      });
      processed++;
      console.log(`ok (${ideas.length} ideas)`);
    } catch (err) {
      console.error("error:", err);
      csvRows.push({
        article_url: a.article_url ?? "",
        article_title: a.article_title ?? null,
        ideas: [],
      });
    }
  }

  const headers = [
    "article_url",
    "article_title",
    "idea_1",
    "idea_2",
    "idea_3",
    "idea_4",
    "idea_5",
    "idea_6",
    "idea_7",
  ];
  const lines: string[] = [headers.join(",")];
  for (const r of csvRows) {
    const cells = [
      escapeCsvValue(r.article_url),
      escapeCsvValue(r.article_title),
      escapeCsvValue(r.ideas[0]),
      escapeCsvValue(r.ideas[1]),
      escapeCsvValue(r.ideas[2]),
      escapeCsvValue(r.ideas[3]),
      escapeCsvValue(r.ideas[4]),
      escapeCsvValue(r.ideas[5]),
      escapeCsvValue(r.ideas[6]),
    ];
    lines.push(cells.join(","));
  }

  fs.writeFileSync(outputPath, lines.join("\n"), "utf8");
  console.log(
    `\nReevaluated ${processed} analyses, skipped ${skipped}. CSV written to ${outputPath}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
