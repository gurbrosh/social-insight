import { prisma } from "@/lib/prisma";
import { resetAnalysisProgress } from "@/lib/analysis-progress";

export type ProjectPurgeAction = "none" | "analysis" | "records";

export interface AnalysisPurgeSummary {
  chatter: number;
  network: number;
  themes: number;
  news: number;
  brand: number;
}

export interface RecordsPurgeSummary extends AnalysisPurgeSummary {
  downstream: number;
  posts: number;
}

export async function purgeProjectAnalysis(projectId: string): Promise<AnalysisPurgeSummary> {
  const deletedCounts = await prisma.$transaction(async (tx) => {
    const chatterDeleted = await tx.chatterAnalysis.deleteMany({
      where: { project_id: projectId },
    });
    const networkDeleted = await tx.networkAnalysis.deleteMany({
      where: { project_id: projectId },
    });
    const themesDeleted = await tx.themesAnalysis.deleteMany({
      where: { project_id: projectId },
    });
    await tx.responseObjective.deleteMany({
      where: { project_id: projectId },
    });
    const newsDeleted = await tx.postNews.deleteMany({
      where: { project_id: projectId },
    });
    const brandDeleted = await tx.brandAnalysis.deleteMany({
      where: { project_id: projectId },
    });

    // CRITICAL: Clear sentiment and AI-processed fields from posts
    // This ensures that after reset, comprehensive analysis will find posts to analyze
    // Without this, posts still have sentiment set and are skipped, causing downstream analyses to be skipped
    const postsUpdated = await tx.post.updateMany({
      where: { project_id: projectId },
      data: {
        sentiment: null,
        summary: null,
        ai_processed_at: null,
      },
    });
    console.log(
      `[purgeProjectAnalysis] Cleared sentiment from ${postsUpdated.count} posts for project ${projectId}`
    );

    await resetAnalysisProgress(projectId, { resetSentiment: true }, tx);

    return {
      chatter: chatterDeleted.count,
      network: networkDeleted.count,
      themes: themesDeleted.count,
      news: newsDeleted.count,
      brand: brandDeleted.count,
    } satisfies AnalysisPurgeSummary;
  });

  return deletedCounts;
}

export async function purgeProjectRecords(projectId: string): Promise<RecordsPurgeSummary> {
  // Log before deletion to see what's in the database
  const beforeCounts = {
    downstream: await prisma.downstreamPost.count({ where: { project_id: projectId } }),
    posts: await prisma.post.count({ where: { project_id: projectId } }),
  };
  console.log(
    `[purgeProjectRecords] Before deletion - Project ${projectId}: ${beforeCounts.downstream} DownstreamPost records, ${beforeCounts.posts} Post records`
  );

  const deletedCounts = await prisma.$transaction(async (tx) => {
    const chatterDeleted = await tx.chatterAnalysis.deleteMany({
      where: { project_id: projectId },
    });
    const networkDeleted = await tx.networkAnalysis.deleteMany({
      where: { project_id: projectId },
    });
    const themesDeleted = await tx.themesAnalysis.deleteMany({
      where: { project_id: projectId },
    });
    await tx.responseObjective.deleteMany({
      where: { project_id: projectId },
    });
    const newsDeleted = await tx.postNews.deleteMany({
      where: { project_id: projectId },
    });
    const brandDeleted = await tx.brandAnalysis.deleteMany({
      where: { project_id: projectId },
    });

    // Delete DownstreamPost records for this project
    const downstreamDeleted = await tx.downstreamPost.deleteMany({
      where: { project_id: projectId },
    });
    const postsDeleted = await tx.post.deleteMany({
      where: { project_id: projectId },
    });

    console.log(
      `[purgeProjectRecords] Deleted - Project ${projectId}: ${downstreamDeleted.count} DownstreamPost records, ${postsDeleted.count} Post records`
    );

    await resetAnalysisProgress(projectId, { resetSentiment: true }, tx);

    return {
      chatter: chatterDeleted.count,
      network: networkDeleted.count,
      themes: themesDeleted.count,
      news: newsDeleted.count,
      brand: brandDeleted.count,
      downstream: downstreamDeleted.count,
      posts: postsDeleted.count,
    } satisfies RecordsPurgeSummary;
  });

  return deletedCounts;
}
