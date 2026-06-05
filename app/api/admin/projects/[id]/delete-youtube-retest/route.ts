import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { rewindAnalysisProgressToPostId } from "@/lib/analysis-progress";

export const dynamic = "force-dynamic";

const YOUTUBE_PLATFORMS = ["youtube", "YouTube"] as const;

/**
 * POST /api/admin/projects/[id]/delete-youtube-retest
 *
 * Deletes all YouTube posts (and related BrandAnalysis, ThemesAnalysis, DownstreamPost)
 * for the project, then rewinds all analysis counters to the max Post.id of the
 * remaining posts. Next comprehensive analysis will only process posts with id > that
 * value — i.e. only re-scraped YouTube. No full project re-analysis.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userIsAdmin = await isAdmin(session.user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id: projectId } = await params;

    const project = await prisma.project.findFirst({
      where: { id: projectId, deleted_at: null },
      select: { id: true, name: true },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const wherePost = {
      project_id: projectId,
      platform: { in: [...YOUTUBE_PLATFORMS] },
    };
    const whereDownstream = {
      project_id: projectId,
      platform: { in: [...YOUTUBE_PLATFORMS] },
    };

    const youtubePosts = await prisma.post.findMany({
      where: wherePost,
      select: { id: true },
    });
    const youtubePostIds = youtubePosts.map((p) => p.id);

    if (youtubePostIds.length === 0) {
      const downstreamCount = await prisma.downstreamPost.count({ where: whereDownstream });
      if (downstreamCount === 0) {
        return NextResponse.json({
          success: true,
          projectId,
          deleted: { posts: 0, downstream: 0, brandAnalysis: 0, themesAnalysis: 0 },
          rewindToPostId: null,
          message: "No YouTube records found for this project",
        });
      }
    }

    const brandDeleted = await prisma.brandAnalysis.deleteMany({
      where: { post_id: { in: youtubePostIds } },
    });
    const themesDeleted = await prisma.themesAnalysis.deleteMany({
      where: { post_id: { in: youtubePostIds } },
    });
    const postDeleted = await prisma.post.deleteMany({ where: wherePost });
    const downstreamDeleted = await prisma.downstreamPost.deleteMany({
      where: whereDownstream,
    });

    const maxPost = await prisma.post.findFirst({
      where: { project_id: projectId },
      orderBy: { id: "desc" },
      select: { id: true },
    });
    const rewindToPostId = maxPost?.id ?? 0;
    await rewindAnalysisProgressToPostId(projectId, rewindToPostId);

    return NextResponse.json({
      success: true,
      projectId,
      projectName: project.name,
      deleted: {
        posts: postDeleted.count,
        downstream: downstreamDeleted.count,
        brandAnalysis: brandDeleted.count,
        themesAnalysis: themesDeleted.count,
      },
      rewindToPostId,
      message:
        "YouTube records deleted. Analysis counters rewound so the next run will only analyze new (re-scraped) YouTube posts.",
    });
  } catch (error) {
    console.error("Error in delete-youtube-retest:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to delete YouTube records and rewind",
      },
      { status: 500 }
    );
  }
}
