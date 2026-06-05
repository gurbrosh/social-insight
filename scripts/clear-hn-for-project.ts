/**
 * Remove all Hacker News data for one project: Posts (platform hackernews),
 * HnStoryAnalysis, HnStoryCommentTheme for those stories, SourceMention rows
 * for this project's keywords, and dependent rows (themes, brand analysis, tasks, etc.).
 *
 * Usage:
 *   npx tsx scripts/clear-hn-for-project.ts --project-id <ULID>
 */

import { prisma } from "../lib/prisma";

const HN_PLATFORM = "hackernews";
const HN_SOURCE = "hackernews";

async function main() {
  const idx = process.argv.indexOf("--project-id");
  const projectId =
    idx !== -1 && process.argv[idx + 1] ? String(process.argv[idx + 1]).trim() : null;

  if (!projectId) {
    console.error("Usage: npx tsx scripts/clear-hn-for-project.ts --project-id <projectUlid>");
    process.exit(1);
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, deleted_at: null },
    include: {
      keywords: { where: { deleted_at: null }, select: { keyword: true } },
    },
  });

  if (!project) {
    console.error(`No active project with id ${projectId}`);
    process.exit(1);
  }

  const keywordList = project.keywords.map((k) => k.keyword.trim()).filter(Boolean);

  const stats = await prisma.$transaction(async (tx) => {
    const hnPosts = await tx.post.findMany({
      where: { project_id: projectId, platform: HN_PLATFORM },
      select: { id: true },
    });
    const postIds = hnPosts.map((p) => p.id);
    const recordKeys = postIds.map(String);

    let tasks = 0;
    let runRecords = 0;
    let brand = 0;
    let themes = 0;
    let engagement = 0;
    let nodes = 0;
    let conversations = 0;
    let posts = 0;
    let analyses = 0;
    let commentThemes = 0;
    let mentions = 0;

    if (postIds.length > 0) {
      const t = await tx.analysisTask.deleteMany({
        where: {
          project_id: projectId,
          record_type: "POST",
          record_key: { in: recordKeys },
        },
      });
      tasks = t.count;

      const rr = await tx.runRecord.deleteMany({
        where: {
          project_id: projectId,
          record_type: "POST",
          record_key: { in: recordKeys },
        },
      });
      runRecords = rr.count;

      const b = await tx.brandAnalysis.deleteMany({
        where: { project_id: projectId, post_id: { in: postIds } },
      });
      brand = b.count;

      const th = await tx.themesAnalysis.deleteMany({
        where: { project_id: projectId, post_id: { in: postIds } },
      });
      themes = th.count;

      const eng = await tx.engagementSession.deleteMany({
        where: { project_id: projectId, post_id: { in: postIds } },
      });
      engagement = eng.count;

      const cn = await tx.conversationNode.deleteMany({
        where: { post_id: { in: postIds } },
      });
      nodes = cn.count;

      await tx.post.updateMany({
        where: { id: { in: postIds } },
        data: {
          conversation_id: null,
          hn_story_analysis_id: null,
        },
      });

      const conv = await tx.conversation.deleteMany({
        where: { project_id: projectId, root_post_id: { in: postIds } },
      });
      conversations = conv.count;

      const p = await tx.post.deleteMany({
        where: { project_id: projectId, platform: HN_PLATFORM },
      });
      posts = p.count;
    }

    const storyRows = await tx.hnStoryAnalysis.findMany({
      where: { project_id: projectId },
      select: { hn_story_id: true },
    });
    const storyIds = [...new Set(storyRows.map((s) => s.hn_story_id))];

    const a = await tx.hnStoryAnalysis.deleteMany({
      where: { project_id: projectId },
    });
    analyses = a.count;

    if (storyIds.length > 0) {
      const ct = await tx.hnStoryCommentTheme.deleteMany({
        where: { hn_story_id: { in: storyIds } },
      });
      commentThemes = ct.count;
    }

    if (keywordList.length > 0) {
      const sm = await tx.sourceMention.deleteMany({
        where: {
          source: HN_SOURCE,
          keyword: { in: keywordList },
        },
      });
      mentions = sm.count;
    }

    return {
      tasks,
      runRecords,
      brand,
      themes,
      engagement,
      nodes,
      conversations,
      posts,
      analyses,
      commentThemes,
      mentions,
    };
  });

  console.log(
    `HN cleanup for project ${projectId} (${project.name}):\n` +
      `  Post (hackernews): ${stats.posts}\n` +
      `  AnalysisTask (POST): ${stats.tasks}\n` +
      `  RunRecord (POST): ${stats.runRecords}\n` +
      `  BrandAnalysis: ${stats.brand}\n` +
      `  ThemesAnalysis: ${stats.themes}\n` +
      `  EngagementSession: ${stats.engagement}\n` +
      `  ConversationNode: ${stats.nodes}\n` +
      `  Conversation (root was HN post): ${stats.conversations}\n` +
      `  HnStoryAnalysis: ${stats.analyses}\n` +
      `  HnStoryCommentTheme: ${stats.commentThemes}\n` +
      `  SourceMention (HN, project keywords): ${stats.mentions}`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
