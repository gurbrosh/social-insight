import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const page = Math.max(parseInt(searchParams.get("page") || "1", 10), 1);
    const limit = Math.max(parseInt(searchParams.get("limit") || "4", 10), 1);

    if (!projectId) {
      return NextResponse.json({ error: "Project ID is required" }, { status: 400 });
    }

    // Verify user owns the project
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        user_id: session.user.id,
        deleted_at: null,
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Fetch recent posts with sliding window diversity algorithm
    // Filter out posts without content at database level
    const requestedRequired = (page - 1) * limit + limit;
    const fetchLimit = Math.max(requestedRequired, 100);
    const allPosts = await prisma.post.findMany({
      where: {
        project_id: projectId,
        content: { not: null },
        NOT: { content: "" },
      },
      orderBy: { createdAt: "desc" },
      take: fetchLimit,
      include: {
        job: {
          include: {
            scraper: true,
          },
        },
      },
    });

    // Smart diversity: Pick posts while avoiding too many consecutive duplicates
    // Allow up to 2 consecutive posts from same platform, then require diversity
    const diversePosts: typeof allPosts = [];
    const skippedPosts: typeof allPosts = [];
    let lastPlatform: string | null = null;
    let consecutiveCount = 0;

    for (const post of allPosts) {
      const platform = (post.platform || "").toLowerCase();

      // Allow post if:
      // 1. It's from a different platform than the last one, OR
      // 2. It's from the same platform but we haven't shown 2 in a row yet
      if (platform !== lastPlatform) {
        // Different platform - reset counter and include it
        diversePosts.push(post);
        lastPlatform = platform;
        consecutiveCount = 1;
      } else if (consecutiveCount < 2) {
        // Same platform but haven't shown 2 yet - include it
        diversePosts.push(post);
        consecutiveCount++;
      } else {
        skippedPosts.push(post);
      }
    }

    const addMissingPosts = (source: typeof allPosts) => {
      for (const post of source) {
        if (!diversePosts.some((existing) => existing.id === post.id)) {
          diversePosts.push(post);
        }
      }
    };

    if (diversePosts.length < requestedRequired) {
      addMissingPosts(skippedPosts);
    }

    if (diversePosts.length < requestedRequired) {
      addMissingPosts(allPosts);
    }

    const availablePosts = diversePosts.length;
    const totalPagesRaw = availablePosts === 0 ? 1 : Math.ceil(availablePosts / limit);
    const totalPages = Math.max(totalPagesRaw, 1);
    const safePage = Math.min(page, totalPages);
    const safeSkip = (safePage - 1) * limit;
    const sortedPosts = diversePosts.slice(safeSkip, safeSkip + limit);

    const totalPostsForDisplay = availablePosts;

    return NextResponse.json({
      posts: sortedPosts,
      pagination: {
        page: safePage,
        limit,
        totalPosts: totalPostsForDisplay,
        totalPages,
        hasNextPage: safePage < totalPages,
        hasPrevPage: safePage > 1,
      },
    });
  } catch (error) {
    console.error("Error fetching recent posts:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
