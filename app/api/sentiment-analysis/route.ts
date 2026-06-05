import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { analyzeProjectSentiment } from "@/lib/sentiment-analysis";
import { analyzeProjectNews } from "@/lib/news-analysis";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { projectId, runNewsAnalysis = true } = await request.json();

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

    // Run sentiment analysis
    const sentimentResults = await analyzeProjectSentiment(projectId);

    let newsResults = null;

    // Run news analysis if requested and sentiment analysis was successful
    if (runNewsAnalysis && sentimentResults.processed > 0) {
      try {
        console.log("Running news analysis after sentiment analysis...");
        newsResults = await analyzeProjectNews(projectId, {
          requireSentiment: true, // Only analyze posts with sentiment
        });
      } catch (newsError) {
        console.error("Error running news analysis:", newsError);
        // Don't fail the whole request if news analysis fails
      }
    }

    const message = newsResults
      ? `Sentiment: ${sentimentResults.processed} records analyzed in ${sentimentResults.duration.toFixed(1)}s (Skipped: ${sentimentResults.skipped}, Errors: ${sentimentResults.errors}). News: ${newsResults.newsItems} news items extracted from ${newsResults.processed} posts in ${newsResults.duration.toFixed(1)}s.`
      : `${sentimentResults.processed} records analyzed in ${sentimentResults.duration.toFixed(1)} seconds. Skipped: ${sentimentResults.skipped}, Errors: ${sentimentResults.errors}`;

    return NextResponse.json({
      success: true,
      message,
      sentimentResults,
      newsResults,
    });
  } catch (error) {
    console.error("Error running sentiment analysis:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");

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

    // Get sentiment analysis statistics
    const stats = await prisma.post.groupBy({
      by: ["sentiment"],
      where: {
        project_id: projectId,
      },
      _count: {
        sentiment: true,
      },
    });

    const totalPosts = await prisma.post.count({
      where: {
        project_id: projectId,
      },
    });

    const postsWithoutSentiment = await prisma.post.count({
      where: {
        project_id: projectId,
        sentiment: null,
        content: {
          not: null,
        },
      },
    });

    return NextResponse.json({
      totalPosts,
      postsWithoutSentiment,
      sentimentBreakdown: stats.reduce(
        (acc, stat) => {
          acc[stat.sentiment || "NULL"] = stat._count.sentiment;
          return acc;
        },
        {} as Record<string, number>
      ),
    });
  } catch (error) {
    console.error("Error getting sentiment stats:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
      },
      { status: 500 }
    );
  }
}
