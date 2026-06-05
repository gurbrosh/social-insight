/**
 * Diagnose why some News items have no source link.
 * Run: npx tsx scripts/diagnose-news-links.ts <projectId>
 * Prints a few blog-sourced PostNews, their post_ids, primary Post row, and URL resolution.
 */

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
import crypto from "crypto";

const projectId = process.argv[2];
if (!projectId) {
  console.error("Usage: npx tsx scripts/diagnose-news-links.ts <projectId>");
  process.exit(1);
}

async function main() {
  const limit = 5;
  const rows = await prisma.postNews.findMany({
    where: {
      project_id: projectId,
      deleted_at: null,
    },
    orderBy: { date_range_start: "desc" },
    take: limit * 3,
  });

  const blogRows = rows
    .filter((r) => {
      try {
        const s = r.sources ? JSON.parse(r.sources) : [];
        return s.some((x: string) => String(x).toLowerCase() === "blog");
      } catch {
        return false;
      }
    })
    .slice(0, limit);

  if (blogRows.length === 0) {
    console.log("No blog-sourced PostNews found for this project.");
    return;
  }

  const postIds = new Set<number>();
  for (const r of blogRows) {
    try {
      const ids = r.post_ids ? JSON.parse(r.post_ids) : [];
      ids.forEach((id: number) => postIds.add(Number(id)));
    } catch {}
  }
  const posts = await prisma.post.findMany({
    where: { id: { in: Array.from(postIds) } },
    select: { id: true, platform: true, postId: true, url: true, content: true },
  });
  const postMap = new Map(posts.map((p) => [p.id, p]));

  const analyses = await prisma.blogNewsAnalysis.findMany({
    where: { project_id: projectId, deleted_at: null },
    select: { id: true, article_url: true, source_url: true, article_title: true },
  });
  const blogPosts = await prisma.blogPost.findMany({
    where: { project_id: projectId, deleted_at: null },
    select: { article_url: true, article_title: true },
  });

  const hashMap = new Map<string, string>();
  const idPrefixMap = new Map<string, string>();
  for (const a of analyses) {
    const u = (a.article_url ?? a.source_url ?? "").trim();
    if (u) {
      hashMap.set(crypto.createHash("sha256").update(u).digest("hex").slice(0, 24), u);
      idPrefixMap.set((a.id ?? "").slice(0, 24), u);
    }
  }

  console.log("--- Blog PostNews (sample) ---\n");
  for (const r of blogRows) {
    const title = (r.title ?? "").slice(0, 70);
    const ids: number[] = r.post_ids ? JSON.parse(r.post_ids) : [];
    const firstId = ids[0];
    const post = firstId != null ? postMap.get(firstId) : null;
    const prefix = post?.postId ? String(post.postId).split("--idea-")[0]?.trim() : null;
    const fromHash = prefix ? hashMap.get(prefix) : null;
    const fromId = prefix ? idPrefixMap.get(prefix) : null;
    const blogTitleMatch = blogPosts.find((bp) =>
      (bp.article_title ?? "").toLowerCase().includes((r.title ?? "").toLowerCase().slice(0, 50))
    );
    const analysisTitleMatch = analyses.find((a) =>
      (a.article_title ?? "").toLowerCase().includes((r.title ?? "").toLowerCase().slice(0, 50))
    );

    console.log(`Title: ${title}...`);
    console.log(`  source_url (stored): ${r.source_url ?? "(null)"}`);
    console.log(`  post_ids: ${JSON.stringify(ids)}`);
    if (post) {
      console.log(
        `  primary Post: id=${post.id} platform=${post.platform} postId=${post.postId?.slice(0, 40)}... url=${post.url ?? "(null)"}`
      );
      console.log(
        `  prefix lookup: ${prefix ?? "n/a"} -> hash=${fromHash ?? "no"} idPrefix=${fromId ?? "no"}`
      );
    } else {
      console.log(`  primary Post: (not found for id ${firstId})`);
    }
    console.log(`  BlogPost title match: ${blogTitleMatch ? blogTitleMatch.article_url : "no"}`);
    console.log(
      `  BlogNewsAnalysis title match: ${analysisTitleMatch ? (analysisTitleMatch.article_url ?? analysisTitleMatch.source_url) : "no"}`
    );
    console.log("");
  }
  console.log(`BlogNewsAnalysis count: ${analyses.length}, BlogPost count: ${blogPosts.length}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
