/**
 * Delete all Discord Post rows and related data for a project (or all projects) so you can re-run
 * the orchestration and re-scrape Discord without fighting FKs or stale analysis tasks.
 *
 * Does NOT delete ProjectProfile (channel/source URLs) or ScrapeJob history — only ingested posts,
 * conversations, downstream copies, and analysis rows tied to Discord. Re-add sources only if you
 * remove them yourself.
 *
 * Usage:
 *   npx tsx scripts/delete-discord-for-retest.ts --project-id <projectId> [--reset-cursors] [--dry-run]
 *   npx tsx scripts/delete-discord-for-retest.ts --all [--reset-cursors] [--dry-run]
 *
 * --all: every project that has Discord posts.
 * --dry-run: print counts only, no deletes.
 *
 * Default (no --reset-cursors): rewinds analysis counters to max remaining Post.id per project.
 *
 * With --reset-cursors: resets sentiment/themes/chatter/network/news/brand cursors to 0 for each
 * affected project.
 */

import { prisma } from "../lib/prisma";
import { resetAnalysisProgress, rewindAnalysisProgressToPostId } from "../lib/analysis-progress";

const DISCORD_PLATFORM = "discord";

async function deleteDiscordForProject(
  projectId: string,
  dryRun: boolean,
  resetCursors: boolean
): Promise<boolean> {
  const discordPosts = await prisma.post.findMany({
    where: { project_id: projectId, platform: DISCORD_PLATFORM },
    select: { id: true },
  });
  const discordPostIds = discordPosts.map((p) => p.id);
  const idStrs = discordPostIds.map(String);
  const idSet = new Set(discordPostIds);

  if (discordPostIds.length === 0) {
    return false;
  }

  console.log(`\n--- Project ${projectId} ---`);
  console.log(`Found ${discordPostIds.length} Discord post(s).`);

  const convs = await prisma.conversation.findMany({
    where: { project_id: projectId, root_post_id: { in: discordPostIds } },
    select: { id: true },
  });
  const convIds = convs.map((c) => c.id);
  console.log(`Conversations rooted on Discord posts: ${convIds.length}`);

  if (dryRun) {
    const downstream = await prisma.downstreamPost.count({
      where: { project_id: projectId, platform: DISCORD_PLATFORM },
    });
    console.log(`DownstreamPost (discord): ${downstream}`);
    console.log("Dry run — no changes for this project.");
    return true;
  }

  await prisma.$transaction(async (tx) => {
    if (convIds.length > 0) {
      await tx.conversationNode.deleteMany({
        where: {
          OR: [{ post_id: { in: discordPostIds } }, { conversation_id: { in: convIds } }],
        },
      });
    } else {
      await tx.conversationNode.deleteMany({
        where: { post_id: { in: discordPostIds } },
      });
    }

    await tx.post.updateMany({
      where: {
        project_id: projectId,
        OR: [{ id: { in: discordPostIds } }, { conversation_id: { in: convIds } }],
      },
      data: { conversation_id: null, post_conversation_role: null },
    });

    if (convIds.length > 0) {
      await tx.conversation.deleteMany({
        where: { id: { in: convIds } },
      });
    }

    await tx.brandAnalysis.deleteMany({
      where: { post_id: { in: discordPostIds } },
    });

    await tx.themesAnalysis.deleteMany({
      where: { post_id: { in: discordPostIds } },
    });

    const chatterRows = await tx.chatterAnalysis.findMany({
      where: { project_id: projectId, deleted_at: null },
      select: { id: true, post_ids: true },
    });
    const chatterIdsToDelete: string[] = [];
    for (const row of chatterRows) {
      if (!row.post_ids) continue;
      try {
        const ids = JSON.parse(row.post_ids) as number[];
        if (Array.isArray(ids) && ids.some((id) => idSet.has(id))) {
          chatterIdsToDelete.push(row.id);
        }
      } catch {
        /* ignore */
      }
    }
    if (chatterIdsToDelete.length > 0) {
      await tx.chatterAnalysis.deleteMany({
        where: { id: { in: chatterIdsToDelete } },
      });
    }

    await tx.networkAnalysis.deleteMany({
      where: { project_id: projectId, platform: DISCORD_PLATFORM },
    });

    const newsRows = await tx.postNews.findMany({
      where: { project_id: projectId, deleted_at: null },
      select: { id: true, post_ids: true },
    });
    const newsIdsToDelete: string[] = [];
    for (const row of newsRows) {
      if (!row.post_ids) continue;
      try {
        const ids = JSON.parse(row.post_ids) as number[];
        if (Array.isArray(ids) && ids.some((id) => idSet.has(id))) {
          newsIdsToDelete.push(row.id);
        }
      } catch {
        /* ignore */
      }
    }
    if (newsIdsToDelete.length > 0) {
      await tx.postNews.deleteMany({
        where: { id: { in: newsIdsToDelete } },
      });
    }

    await tx.analysisTask.deleteMany({
      where: {
        project_id: projectId,
        record_type: "POST",
        record_key: { in: idStrs },
      },
    });

    await tx.runRecord.deleteMany({
      where: {
        project_id: projectId,
        record_type: "POST",
        record_key: { in: idStrs },
      },
    });

    await tx.post.deleteMany({
      where: { project_id: projectId, platform: DISCORD_PLATFORM },
    });

    await tx.downstreamPost.deleteMany({
      where: { project_id: projectId, platform: DISCORD_PLATFORM },
    });
  });

  console.log(`Deleted Discord data for project ${projectId}.`);

  if (!resetCursors) {
    const maxPost = await prisma.post.findFirst({
      where: { project_id: projectId },
      orderBy: { id: "desc" },
      select: { id: true },
    });
    const maxPostId = maxPost?.id ?? 0;
    await rewindAnalysisProgressToPostId(projectId, maxPostId);
    console.log(
      `Rewound analysis counters to ${maxPostId} (max remaining Post.id) for this project.`
    );
  } else {
    await resetAnalysisProgress(projectId, { resetSentiment: true });
    console.log("Reset analysis cursors to 0 for this project.");
  }

  return true;
}

async function main() {
  const allFlag = process.argv.includes("--all");
  const projectIdx = process.argv.indexOf("--project-id");
  const projectIdArg =
    projectIdx !== -1 && process.argv[projectIdx + 1] ? process.argv[projectIdx + 1].trim() : "";
  const resetCursors = process.argv.includes("--reset-cursors");
  const dryRun = process.argv.includes("--dry-run");

  if (!allFlag && !projectIdArg) {
    console.error("Required: --project-id <id> OR --all");
    process.exit(1);
  }
  if (allFlag && projectIdArg) {
    console.error("Use either --all or --project-id, not both.");
    process.exit(1);
  }

  console.log("Delete Discord records\n");
  console.log("=".repeat(60));
  console.log(allFlag ? "Scope: ALL projects with Discord posts" : `Project: ${projectIdArg}`);
  console.log(`Dry run: ${dryRun ? "yes" : "no"}`);
  console.log(
    resetCursors
      ? "Cursors: reset to 0 (re-analyze all remaining posts)"
      : "Cursors: rewind to max remaining Post.id after delete"
  );
  console.log("=".repeat(60));

  let projectIds: string[];
  if (allFlag) {
    const grouped = await prisma.post.groupBy({
      by: ["project_id"],
      where: { platform: DISCORD_PLATFORM, project_id: { not: null } },
      _count: { _all: true },
    });
    projectIds = grouped.map((g) => g.project_id!).filter(Boolean);
    if (projectIds.length === 0) {
      console.log("\nNo Discord posts in any project. Nothing to delete.");
      await prisma.$disconnect();
      return;
    }
    console.log(`\nProjects with Discord posts: ${projectIds.length} — ${projectIds.join(", ")}`);
  } else {
    projectIds = [projectIdArg];
  }

  let any = false;
  for (const pid of projectIds) {
    const did = await deleteDiscordForProject(pid, dryRun, resetCursors);
    if (did) any = true;
  }

  if (!any && !allFlag) {
    console.log("\nNo Discord posts for this project. Nothing to delete.");
  }

  console.log("\n" + "=".repeat(60));
  console.log(
    dryRun
      ? "Dry run finished."
      : "Done. Run orchestration again from the UI to re-scrape Discord where needed."
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
