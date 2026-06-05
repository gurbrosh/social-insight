/**
 * Delete YouTube records and rewind analysis counters so the next run only analyzes
 * (re-scraped) YouTube — no full project re-analysis.
 *
 * Usage:
 *   npx tsx scripts/delete-youtube-for-retest.ts [--project-id <projectId>] [--reset-cursors]
 *
 * Without --project-id: deletes YouTube records for all projects.
 * With --project-id: deletes only for that project.
 *
 * Default (no --reset-cursors): After deleting YouTube, sets all analysis counters to the
 * max Post.id of the remaining posts (i.e. pre–YouTube state). Next comprehensive analysis
 * will only process posts with id > that value = only new YouTube when you re-scrape.
 * Reddit/X/LinkedIn are not re-analyzed.
 *
 * With --reset-cursors: resets all counters to 0 so the next run re-analyzes the entire
 * project (use only when you want a full re-run).
 *
 * Order of operations:
 * 1. Delete BrandAnalysis and ThemesAnalysis that reference YouTube posts.
 * 2. Delete Post where platform is YouTube.
 * 3. Delete DownstreamPost where platform is YouTube.
 * 4. For each affected project: rewind all analysis counters to max remaining Post.id.
 * 5. If --reset-cursors: reset analysis progress to 0 (full re-analyze).
 */

import { prisma } from "../lib/prisma";
import { resetAnalysisProgress, rewindAnalysisProgressToPostId } from "../lib/analysis-progress";

const YOUTUBE_PLATFORMS = ["youtube", "YouTube"] as const;

async function main() {
  const projectIdArg = process.argv.indexOf("--project-id");
  const projectIdFilter: string | undefined =
    projectIdArg !== -1 && process.argv[projectIdArg + 1]
      ? process.argv[projectIdArg + 1]
      : undefined;
  const resetCursors = process.argv.includes("--reset-cursors");

  console.log("Delete YouTube records for retest\n");
  console.log("=".repeat(60));
  if (projectIdFilter) {
    console.log(`Scope: project ${projectIdFilter}`);
  } else {
    console.log("Scope: all projects");
  }
  if (resetCursors) {
    console.log("Reset cursors: yes (next analysis will re-process ALL posts)");
  } else {
    console.log("Rewind only: yes (next analysis will process ONLY new YouTube after re-scrape)");
  }
  console.log("=".repeat(60));

  // 1) Get YouTube Post ids (for this project or all)
  const wherePost = {
    platform: { in: [...YOUTUBE_PLATFORMS] as string[] },
    ...(projectIdFilter && { project_id: projectIdFilter }),
  };

  const youtubePosts = await prisma.post.findMany({
    where: wherePost,
    select: { id: true, project_id: true },
  });
  const youtubePostIds = youtubePosts.map((p) => p.id);
  const affectedProjectIds = Array.from(
    new Set(youtubePosts.map((p) => p.project_id).filter(Boolean) as string[])
  );

  if (youtubePostIds.length === 0) {
    console.log("\nNo YouTube posts found. Checking DownstreamPost...");
  } else {
    console.log(
      `\nFound ${youtubePostIds.length} YouTube Post(s) in ${affectedProjectIds.length} project(s).`
    );
  }

  const whereDownstream = {
    platform: { in: [...YOUTUBE_PLATFORMS] as string[] },
    ...(projectIdFilter && { project_id: projectIdFilter }),
  };

  const youtubeDownstreamCount = await prisma.downstreamPost.count({
    where: whereDownstream,
  });
  console.log(`Found ${youtubeDownstreamCount} YouTube DownstreamPost record(s).`);

  const projectFilter: string[] = projectIdFilter
    ? [projectIdFilter]
    : affectedProjectIds.length > 0
      ? affectedProjectIds
      : [];

  if (youtubePostIds.length === 0 && youtubeDownstreamCount === 0) {
    // Still delete YouTube rows in chatter/influencers/news/themes if project specified
    if (projectFilter.length > 0) {
      const networkDeleted = await prisma.networkAnalysis.deleteMany({
        where: {
          project_id: { in: projectFilter },
          platform: { in: [...YOUTUBE_PLATFORMS] },
        },
      });
      console.log(`Deleted ${networkDeleted.count} NetworkAnalysis row(s) (YouTube influencers).`);
    }
    console.log("\nNo YouTube Post or DownstreamPost records. Exiting.");
    await prisma.$disconnect();
    return;
  }

  // 2) Delete dependent records that reference Post (FK or logical) or are YouTube-specific
  if (youtubePostIds.length > 0) {
    const brandDeleted = await prisma.brandAnalysis.deleteMany({
      where: { post_id: { in: youtubePostIds } },
    });
    console.log(`\nDeleted ${brandDeleted.count} BrandAnalysis row(s) referencing YouTube posts.`);

    const themesDeleted = await prisma.themesAnalysis.deleteMany({
      where: { post_id: { in: youtubePostIds } },
    });
    console.log(`Deleted ${themesDeleted.count} ThemesAnalysis row(s) referencing YouTube posts.`);

    const youtubePostIdSet = new Set(youtubePostIds);

    // ChatterAnalysis: post_ids is JSON array of Post ids; delete if any id in the thread is a YouTube post we're removing
    if (projectFilter.length > 0) {
      const chatterRows = await prisma.chatterAnalysis.findMany({
        where: { project_id: { in: projectFilter }, deleted_at: null },
        select: { id: true, post_ids: true },
      });
      const chatterIdsToDelete: string[] = [];
      for (const row of chatterRows) {
        if (!row.post_ids) continue;
        try {
          const ids = JSON.parse(row.post_ids) as number[];
          if (Array.isArray(ids) && ids.some((id) => youtubePostIdSet.has(id))) {
            chatterIdsToDelete.push(row.id);
          }
        } catch {
          // ignore malformed JSON
        }
      }
      if (chatterIdsToDelete.length > 0) {
        const chatterDeleted = await prisma.chatterAnalysis.deleteMany({
          where: { id: { in: chatterIdsToDelete } },
        });
        console.log(
          `Deleted ${chatterDeleted.count} ChatterAnalysis row(s) (threads referencing YouTube posts).`
        );
      }
    }

    // NetworkAnalysis (influencers): delete by platform = youtube for affected projects
    if (projectFilter.length > 0) {
      const networkDeleted = await prisma.networkAnalysis.deleteMany({
        where: {
          project_id: { in: projectFilter },
          platform: { in: [...YOUTUBE_PLATFORMS] },
        },
      });
      console.log(`Deleted ${networkDeleted.count} NetworkAnalysis row(s) (YouTube influencers).`);
    }

    // PostNews: post_ids is JSON array of Post ids; delete if any id references a YouTube post we're removing
    if (projectFilter.length > 0) {
      const newsRows = await prisma.postNews.findMany({
        where: { project_id: { in: projectFilter }, deleted_at: null },
        select: { id: true, post_ids: true },
      });
      const newsIdsToDelete: string[] = [];
      for (const row of newsRows) {
        if (!row.post_ids) continue;
        try {
          const ids = JSON.parse(row.post_ids) as number[];
          if (Array.isArray(ids) && ids.some((id) => youtubePostIdSet.has(id))) {
            newsIdsToDelete.push(row.id);
          }
        } catch {
          // ignore malformed JSON
        }
      }
      if (newsIdsToDelete.length > 0) {
        const newsDeleted = await prisma.postNews.deleteMany({
          where: { id: { in: newsIdsToDelete } },
        });
        console.log(
          `Deleted ${newsDeleted.count} PostNews row(s) (news items referencing YouTube posts).`
        );
      }
    }
  }

  // 3) Delete YouTube posts
  const postDeleted = await prisma.post.deleteMany({
    where: wherePost,
  });
  console.log(`Deleted ${postDeleted.count} Post row(s) (YouTube).`);

  // 4) Delete YouTube DownstreamPost
  const downstreamDeleted = await prisma.downstreamPost.deleteMany({
    where: whereDownstream,
  });
  console.log(`Deleted ${downstreamDeleted.count} DownstreamPost row(s) (YouTube).`);

  // 5) Rewind analysis counters to max remaining Post.id (pre–YouTube state) so next run only analyzes new YouTube
  const projectsToFix: string[] = projectFilter.length > 0 ? projectFilter : affectedProjectIds;
  if (projectIdFilter && !projectsToFix.includes(projectIdFilter)) {
    projectsToFix.push(projectIdFilter);
  }

  if (!resetCursors) {
    for (const pid of projectsToFix) {
      const maxPost = await prisma.post.findFirst({
        where: { project_id: pid },
        orderBy: { id: "desc" },
        select: { id: true },
      });
      const maxPostId = maxPost?.id ?? 0;
      await rewindAnalysisProgressToPostId(pid, maxPostId);
      console.log(
        `\n[${pid}] Rewound all analysis counters to ${maxPostId} (max remaining Post.id). Next run will only analyze posts with id > ${maxPostId} (i.e. re-scraped YouTube).`
      );
    }
  }

  // 6) Optional: reset all analysis cursors so next run re-analyzes all remaining posts (repopulate sentiment, etc.)
  if (resetCursors && projectsToFix.length > 0) {
    console.log("\n" + "=".repeat(60));
    console.log("Resetting analysis cursors to 0 for affected project(s)...");
    for (const pid of projectsToFix) {
      await resetAnalysisProgress(pid, { resetSentiment: true });
    }
    console.log("Done. Next comprehensive analysis will re-process all remaining posts.");
  }

  console.log("\n" + "=".repeat(60));
  console.log(
    resetCursors
      ? "Done. Re-run YouTube scraping if needed; then run comprehensive analysis to repopulate sentiment/themes."
      : "Done. You can re-run YouTube scraping; analysis will resume from the updated checkpoints."
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
