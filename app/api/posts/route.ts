import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PROJECT_SOURCE_FILTER_ALL_KEYS } from "@/lib/utils/platform";
import { getDateRangeFilter } from "@/lib/utils/date-formatter";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const search = searchParams.get("search") || "";
    const dateRange = searchParams.get("dateRange") || "";
    const sentiment = searchParams.get("sentiment") || "";
    const author = searchParams.get("author") || "";
    const language = searchParams.get("language") || "all";
    const sortBy = searchParams.get("sortBy") || "recent";
    const page = parseInt(searchParams.get("page") || "1");
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "10", 10) || 10, 1), 100);

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

    // Build where clause
    // CRITICAL: Only return posts with content (matches client-side filtering in ProjectResults)
    const baseWhere: any = {
      project_id: projectId,
      content: { not: null },
      NOT: { content: "" },
    };

    // Search filter (SQLite-compatible case-insensitive search with multi-phrase support)
    let where: any = { ...baseWhere };

    if (search) {
      // Split by comma and trim each phrase
      const searchPhrases = search
        .split(",")
        .map((phrase) => phrase.trim())
        .filter((phrase) => phrase.length > 0);

      if (searchPhrases.length === 1) {
        // Single phrase search - combine with content filter using AND
        where = {
          ...baseWhere,
          AND: [
            { content: { not: null } },
            { content: { contains: searchPhrases[0] } },
            { NOT: { content: "" } },
          ],
        };
      } else if (searchPhrases.length > 1) {
        // Multiple phrases - post must contain ALL of them (AND logic)
        where = {
          ...baseWhere,
          AND: [
            { content: { not: null } },
            { NOT: { content: "" } },
            ...searchPhrases.map((phrase) => ({
              content: { contains: phrase },
            })),
          ],
        };
      }
    }

    // Date range filter (aligned with getDateRangeFilter: days:N, today, week, month, quarter)
    if (dateRange && dateRange !== "all") {
      const filter = getDateRangeFilter(dateRange);
      if (filter) {
        where.createdAt = { gte: filter.gte };
      }
    }

    // Sentiment filter
    if (sentiment) {
      const sentiments = sentiment.split(",").filter((s) => s);
      const allSentiments = ["POSITIVE", "NEGATIVE", "NEUTRAL", "MIXED"];

      // Only apply filter if not all sentiments are selected
      const isAllSentimentsSelected = allSentiments.every((s) => sentiments.includes(s));

      if (sentiments.length > 0 && !isAllSentimentsSelected) {
        where.sentiment = { in: sentiments };
      }
      // If all sentiments selected, don't apply filter (show all posts including null sentiment)
    }

    // Author filter (SQLite-compatible case-insensitive search)
    if (author) {
      // SQLite doesn't support Prisma's mode: "insensitive"
      where.OR = [{ authorName: { contains: author } }, { authorId: { contains: author } }];
    }

    // Source filter (platform filtering). `sources` omitted = no platform filter; `sources=` present
    // (including empty) = explicit selection — empty list means no posts match.
    const sourcesParam = searchParams.get("sources");
    if (sourcesParam !== null) {
      const sourceList = sourcesParam.split(",").filter((s) => s.trim());
      const allSources = [...PROJECT_SOURCE_FILTER_ALL_KEYS];

      if (sourceList.length === 0) {
        where.platform = { in: [] };
      } else {
        const isAllSourcesSelected = allSources.every((source) => sourceList.includes(source));

        if (!isAllSourcesSelected) {
          // Map source keys to platform values (Post table: platform = "blogs" for blog-origin posts)
          const platformMap: { [key: string]: string[] } = {
            facebook: ["facebook"],
            linkedin: ["linkedin"],
            x: ["X", "x"], // Handle both "X" and "x" in database
            twitter: ["X", "x"], // Support both x and twitter for backward compatibility
            reddit: ["reddit"],
            discord: ["discord"],
            youtube: ["youtube"],
            blog: ["blogs"],
            hackernews: ["hackernews"],
            hacker_news: ["hackernews"],
            hn: ["hackernews"],
            github: ["github"],
          };

          const platforms = sourceList
            .flatMap((source) => platformMap[source.toLowerCase()] || [])
            .filter(Boolean);
          where.platform = platforms.length > 0 ? { in: platforms } : { in: [] };
        }
        // If all sources are selected, don't apply any platform filter (show all posts)
      }
    }

    // Language filter
    if (language && language !== "all") {
      where.language = language;
    }

    // Build orderBy clause
    let orderBy: any = {};
    switch (sortBy) {
      case "recent":
        orderBy = { createdAt: "desc" };
        break;
      case "oldest":
        orderBy = { createdAt: "asc" };
        break;
      case "sentiment":
        orderBy = { sentiment: "asc" };
        break;
      default:
        orderBy = { createdAt: "desc" };
    }

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Get total count for pagination
    const totalPosts = await prisma.post.count({
      where,
    });

    // Get posts with pagination
    const posts = await prisma.post.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      include: {
        job: {
          include: {
            scraper: true,
          },
        },
      },
    });

    const totalPages = Math.ceil(totalPosts / limit);

    return NextResponse.json({
      posts,
      pagination: {
        page,
        limit,
        totalPosts,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    console.error("Error fetching posts:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
