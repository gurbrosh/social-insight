import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { analyzeProjectNews, getProjectNews } from "@/lib/news-analysis";

export const dynamic = "force-dynamic";

/**
 * POST - Run news analysis on project posts
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const {
      projectId,
      dateRangeStart,
      dateRangeEnd,
      platforms,
      requireSentiment = true,
    } = await request.json();

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

    // Check if OpenAI API key is configured
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        {
          error: "OpenAI API key not configured. Please set OPENAI_API_KEY environment variable.",
        },
        { status: 500 }
      );
    }

    // Run news analysis
    const results = await analyzeProjectNews(projectId, {
      dateRangeStart: dateRangeStart ? new Date(dateRangeStart) : undefined,
      dateRangeEnd: dateRangeEnd ? new Date(dateRangeEnd) : undefined,
      platforms: platforms || undefined,
      requireSentiment, // Only analyze posts with sentiment (default: true)
    });

    return NextResponse.json({
      success: true,
      message: `Analyzed ${results.processed} posts and extracted ${results.newsItems} news items in ${results.duration.toFixed(1)} seconds`,
      results,
    });
  } catch (error) {
    console.error("Error running news analysis:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

/**
 * GET - Retrieve news items for a project
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");
    // Default to 60 to match the stricter news filtering threshold
    const minImportance = parseInt(searchParams.get("minImportance") || "60");
    const language = searchParams.get("language") || "all";
    const sourcesParam = searchParams.get("sources");
    /** Omitted = no source narrowing; present (including empty) = explicit list from client. */
    const sourceFilter: string[] | undefined =
      sourcesParam === null
        ? undefined
        : sourcesParam
            .split(",")
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean);

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

    // Get news items (pass sourceFilter so server returns only matching sources when filter is active)
    const results = await getProjectNews(projectId, {
      limit,
      offset,
      minImportance,
      language,
      sourceFilter,
    });

    if (sourceFilter !== undefined && sourceFilter.length > 0) {
      console.log(
        `[News API] project=${projectId} sources=${sourceFilter.join(",")} returned ${results.newsItems?.length ?? 0} items (total=${results.total})`
      );
    }

    return NextResponse.json(results);
  } catch (error) {
    console.error("Error getting news items:", error);
    if (error instanceof Error) {
      console.error("Error stack:", error.stack);
    }
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
