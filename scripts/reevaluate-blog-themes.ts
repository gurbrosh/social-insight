/**
 * Re-run theme matching for existing qualified blog analyses (no new fetch or analysis).
 * Soft-deletes existing blog theme rows for each article and creates new ones from the LLM.
 *
 * Usage:
 *   npx tsx scripts/reevaluate-blog-themes.ts [--project-id <projectId>]
 *
 * Without --project-id: re-evaluates all projects that have qualified BlogNewsAnalysis.
 * With --project-id: re-evaluates only that project.
 */

import { prisma } from "../lib/prisma";
import { ContentArchetype } from "@prisma/client";
import { getProjectContextForRelevance } from "../lib/comprehensive-analysis";
import { matchBlogSummariesToThemesWithLLM } from "../lib/blog-post-analysis-pipeline";
import { generateId } from "../lib/utils/ulid";
import { sanitizeTextForDbStorage } from "../lib/sanitize-text-for-db-storage";

const BATCH_SIZE = 12;

function parseArgs(): { projectId?: string } {
  const i = process.argv.indexOf("--project-id");
  const projectId = i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
  return { projectId };
}

async function main() {
  const { projectId } = parseArgs();

  const whereClause = {
    deleted_at: null,
    summary: { not: null },
    NOT: { summary: "" },
    ...(projectId ? { project_id: projectId } : {}),
    OR: [
      { signal_strength_score: { gte: 3 } },
      {
        content_archetype: {
          in: [
            ContentArchetype.ANNOUNCEMENT,
            ContentArchetype.PROOF_POINT,
            ContentArchetype.NARRATIVE_SHAPING,
          ],
        },
      },
    ],
  };

  const analyses = await prisma.blogNewsAnalysis.findMany({
    where: whereClause,
    select: {
      id: true,
      project_id: true,
      summary: true,
      article_url: true,
      article_date: true,
    },
    orderBy: { created_at: "asc" },
  });

  if (analyses.length === 0) {
    console.log("No qualified blog analyses found. Nothing to re-evaluate.");
    process.exit(0);
  }

  const projectIds = [...new Set(analyses.map((a) => a.project_id))];
  console.log(
    `Re-evaluating themes for ${analyses.length} qualified blog analyses across ${projectIds.length} project(s).`
  );

  let totalReplaced = 0;
  let totalCreated = 0;

  for (const pid of projectIds) {
    const projectAnalyses = analyses.filter((a) => a.project_id === pid);
    const themes = await prisma.projectTheme.findMany({
      where: { project_id: pid, deleted_at: null },
      select: { id: true, theme_name: true, description: true },
    });
    if (themes.length === 0) {
      console.log(`Project ${pid}: no themes, skipping ${projectAnalyses.length} analyses.`);
      continue;
    }

    const projectScopeForRelevance = await getProjectContextForRelevance(pid);

    // Resolve blog name from Brand.blog_news_url and ProjectBrandSource (BLOG)
    const blogBaseToName: Array<{ baseUrl: string; name: string }> = [];
    const seenBases = new Set<string>();
    const projectBrandsWithBlog = await prisma.projectBrand.findMany({
      where: { project_id: pid, deleted_at: null },
      include: { brand: true },
    });
    for (const pb of projectBrandsWithBlog) {
      const url = pb.brand?.blog_news_url?.trim();
      if (!url || !url.startsWith("http")) continue;
      try {
        const parsed = new URL(url);
        const path = parsed.pathname.replace(/\/+$/, "") || "/";
        const baseUrl = `${parsed.origin}${path}`.toLowerCase();
        if (seenBases.has(baseUrl)) continue;
        seenBases.add(baseUrl);
        blogBaseToName.push({ baseUrl, name: pb.brand?.brand_name ?? pb.brand_name ?? "Blog" });
      } catch {
        // skip
      }
    }
    const projectBlogSources = await prisma.projectBrandSource.findMany({
      where: {
        project_id: pid,
        deleted_at: null,
        link_type: "OTHER_SOURCE",
        source_category: "BLOG",
      },
      include: { brand: { select: { brand_name: true } } },
    });
    for (const src of projectBlogSources) {
      const url = src.url?.trim();
      if (!url || !url.startsWith("http")) continue;
      try {
        const parsed = new URL(url);
        const path = parsed.pathname.replace(/\/+$/, "") || "/";
        const baseUrl = `${parsed.origin}${path}`.toLowerCase();
        if (seenBases.has(baseUrl)) continue;
        seenBases.add(baseUrl);
        blogBaseToName.push({
          baseUrl,
          name: (src.channel_name?.trim() || src.brand?.brand_name || "Blog").trim() || "Blog",
        });
      } catch {
        // skip
      }
    }
    const brandIdsForBlog = projectBrandsWithBlog
      .map((pb) => pb.brand_id)
      .filter((id): id is string => id != null);
    if (brandIdsForBlog.length > 0) {
      const brandBlogLinks = await prisma.brandAdditionalLink.findMany({
        where: {
          brand_id: { in: brandIdsForBlog },
          deleted_at: null,
          link_type: "OTHER_SOURCE",
          source_category: "BLOG",
        },
        include: { brand: { select: { brand_name: true } } },
      });
      for (const link of brandBlogLinks) {
        const url = link.url?.trim();
        if (!url || !url.startsWith("http")) continue;
        try {
          const parsed = new URL(url);
          const path = parsed.pathname.replace(/\/+$/, "") || "/";
          const baseUrl = `${parsed.origin}${path}`.toLowerCase();
          if (seenBases.has(baseUrl)) continue;
          seenBases.add(baseUrl);
          blogBaseToName.push({
            baseUrl,
            name: (link.channel_name?.trim() || link.brand?.brand_name || "Blog").trim() || "Blog",
          });
        } catch {
          // skip
        }
      }
    }
    const resolveBlogName = (articleUrl: string | null): string | null => {
      const u = (articleUrl || "").trim().toLowerCase().replace(/\/+$/, "");
      if (!u) return null;
      for (const { baseUrl, name } of blogBaseToName) {
        const base = baseUrl.replace(/\/+$/, "");
        if (u === base || u.startsWith(base + "/") || u.startsWith(base + "?")) return name;
      }
      return null;
    };

    for (let offset = 0; offset < projectAnalyses.length; offset += BATCH_SIZE) {
      const batch = projectAnalyses.slice(offset, offset + BATCH_SIZE);
      try {
        const matches = await matchBlogSummariesToThemesWithLLM(
          projectScopeForRelevance,
          themes,
          batch.map((r) => ({
            id: r.id,
            summary: r.summary ?? "",
            article_url: r.article_url,
            article_date: r.article_date,
          }))
        );

        console.log(
          `Batch ${offset / BATCH_SIZE + 1}: LLM returned ${matches.length} summary match(es) (${batch.length} summaries sent)`
        );
        const totalThemes = matches.reduce((sum, m) => sum + m.themes.length, 0);
        if (totalThemes > 0) {
          console.log(`  → ${totalThemes} theme match(es) found across summaries`);
        }

        for (const m of matches) {
          const item = batch[m.summary_index - 1];
          if (!item) continue;

          const articleUrl = item.article_url ?? null;
          const summarySlice =
            sanitizeTextForDbStorage(item.summary ?? null, 4000) ?? null;

          const toSoftDelete =
            articleUrl !== null
              ? await prisma.themesAnalysis.findMany({
                  where: {
                    project_id: pid,
                    platform: "blog",
                    post_url: articleUrl,
                    deleted_at: null,
                  },
                  select: { id: true },
                })
              : await prisma.themesAnalysis.findMany({
                  where: {
                    project_id: pid,
                    platform: "blog",
                    post_url: null,
                    post_content: summarySlice,
                    deleted_at: null,
                  },
                  select: { id: true },
                });

          if (toSoftDelete.length > 0) {
            await prisma.themesAnalysis.updateMany({
              where: { id: { in: toSoftDelete.map((r) => r.id) } },
              data: { deleted_at: new Date() },
            });
            totalReplaced += toSoftDelete.length;
          }

          const blogAuthorName = resolveBlogName(articleUrl);

          for (const t of m.themes) {
            const theme = themes[t.theme_index - 1];
            if (!theme) {
              console.warn(
                `  ⚠️  Theme index ${t.theme_index} not found (themes.length=${themes.length})`
              );
              continue;
            }
            try {
              await prisma.themesAnalysis.create({
                data: {
                  id: generateId(),
                  project_id: pid,
                  theme_id: theme.id,
                  theme_name: sanitizeTextForDbStorage(theme.theme_name ?? null, 400) ?? "—",
                  post_id: 0,
                  platform: "blog",
                  post_content: summarySlice,
                  post_url: sanitizeTextForDbStorage(articleUrl, 4000),
                  ...(blogAuthorName && {
                    author_name: sanitizeTextForDbStorage(blogAuthorName, 200) ?? undefined,
                  }),
                  posted_at: item.article_date ?? new Date(),
                  relevance_score: t.relevance,
                  analyzed_at: new Date(),
                },
              });
              totalCreated++;
            } catch (createErr) {
              console.error(
                `  ❌ Failed to create ThemesAnalysis for summary ${m.summary_index}, theme ${theme.theme_name}:`,
                createErr
              );
            }
          }
        }
      } catch (err) {
        console.error(`Batch failed (project ${pid}, offset ${offset}):`, err);
      }
    }

    console.log(`Project ${pid}: re-evaluated ${projectAnalyses.length} blog analyses.`);
  }

  console.log(
    `Done. Replaced ${totalReplaced} old theme row(s), created ${totalCreated} new theme match(es).`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
