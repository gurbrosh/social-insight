import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDateRangeFilter } from "@/lib/utils/date-formatter";

export const dynamic = "force-dynamic";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { projectId, question, conversationHistory = [], filters = {} } = body;

    if (!projectId || !question) {
      return NextResponse.json({ error: "Project ID and question are required" }, { status: 400 });
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

    // Check for OpenAI API key
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });
    }

    // Build where clauses for filtering
    const dateFilter =
      filters.dateRange && filters.dateRange !== "all"
        ? getDateRangeFilter(filters.dateRange)
        : undefined;

    const platformFilter =
      filters.sources && filters.sources.length > 0 && filters.sources.length < 5
        ? { in: filters.sources }
        : undefined;

    // Query aggregated data first (prioritize these over raw posts)
    const [networkData, chatterData, themesData, newsData] = await Promise.all([
      // Network/Influencers Analysis
      prisma.networkAnalysis.findMany({
        where: {
          project_id: projectId,
          deleted_at: null,
          ...(dateFilter && { latest_post_at: dateFilter }),
          ...(platformFilter && { platform: platformFilter }),
        },
        select: {
          author_name: true,
          platform: true,
          total_reactions: true,
          total_likes: true,
          total_comments: true,
          total_shares: true,
          post_count: true,
          ideas_json: true,
        },
        orderBy: { total_reactions: "desc" },
        take: 20,
      }),

      // Chatter/Conversations Analysis
      prisma.chatterAnalysis.findMany({
        where: {
          project_id: projectId,
          deleted_at: null,
          ...(dateFilter && { last_post_at: dateFilter }),
        },
        select: {
          discussion_title: true,
          topic_category: true,
          summary: true,
          sentiment: true,
          platforms_json: true,
          participant_count: true,
          total_messages: true,
          total_engagement: true,
          importance_score: true,
        },
        orderBy: { importance_score: "desc" },
        take: 15,
      }),

      // Themes Analysis
      prisma.themesAnalysis.findMany({
        where: {
          project_id: projectId,
          deleted_at: null,
          ...(dateFilter && { posted_at: dateFilter }),
          ...(platformFilter && { platform: platformFilter }),
        },
        select: {
          theme_name: true,
          post_content: true,
          platform: true,
          sentiment: true,
          relevance_score: true,
          total_reactions: true,
        },
        orderBy: { relevance_score: "desc" },
        take: 20,
      }),

      // News Analysis
      prisma.postNews.findMany({
        where: {
          project_id: projectId,
          deleted_at: null,
        },
        select: {
          title: true,
          summary: true,
          sentiment: true,
          importance_score: true,
          tags: true,
          sources: true,
        },
        orderBy: { importance_score: "desc" },
        take: 15,
      }),
    ]);

    // Build context from aggregated data
    let context = `You are an AI assistant analyzing social media data for project "${project.name}".

`;

    // Add active filters context
    if (filters.dateRange && filters.dateRange !== "all") {
      context += `Active filters: Date range = ${filters.dateRange}`;
      if (filters.language && filters.language !== "all") {
        context += `, Language = ${filters.language}`;
      }
      if (filters.sources && filters.sources.length > 0 && filters.sources.length < 5) {
        context += `, Platforms = ${filters.sources.join(", ")}`;
      }
      context += `\n\n`;
    }

    // Add Influencers data if available
    if (networkData.length > 0) {
      context += `## Top Influencers (${networkData.length}):\n`;
      networkData.forEach((person, i) => {
        context += `${i + 1}. ${person.author_name} (${person.platform}): ${person.total_reactions} total engagement (${person.post_count} posts)\n`;
        if (person.ideas_json) {
          try {
            const ideas = JSON.parse(person.ideas_json);
            context += `   Key ideas: ${ideas.slice(0, 3).join("; ")}\n`;
          } catch {
            // Skip if JSON parse fails
          }
        }
      });
      context += `\n`;
    }

    // Add News data if available
    if (newsData.length > 0) {
      context += `## News & Trends (${newsData.length}):\n`;
      newsData.forEach((news, i) => {
        context += `${i + 1}. ${news.title} (Importance: ${news.importance_score}, Sentiment: ${news.sentiment})\n`;
        if (news.summary) {
          context += `   ${news.summary.substring(0, 150)}...\n`;
        }
        if (news.tags) {
          try {
            const tags = JSON.parse(news.tags);
            context += `   Tags: ${tags.join(", ")}\n`;
          } catch {
            // Skip if JSON parse fails
          }
        }
      });
      context += `\n`;
    }

    // Add Chatter data if available
    if (chatterData.length > 0) {
      context += `## Active Conversations (${chatterData.length}):\n`;
      chatterData.forEach((conv, i) => {
        context += `${i + 1}. "${conv.discussion_title}" (${conv.participant_count} participants, ${conv.total_messages} messages)\n`;
        if (conv.summary) {
          context += `   ${conv.summary.substring(0, 150)}...\n`;
        }
        context += `   Sentiment: ${conv.sentiment}, Engagement: ${conv.total_engagement}\n`;
      });
      context += `\n`;
    }

    // Add Themes data if available
    if (themesData.length > 0) {
      context += `## Theme Matches (${themesData.length}):\n`;
      const themeGroups = themesData.reduce(
        (acc, theme) => {
          if (!acc[theme.theme_name]) {
            acc[theme.theme_name] = [];
          }
          acc[theme.theme_name].push(theme);
          return acc;
        },
        {} as Record<string, typeof themesData>
      );

      Object.entries(themeGroups).forEach(([themeName, matches]) => {
        context += `- ${themeName}: ${matches.length} matches\n`;
        const avgRelevance =
          matches.reduce((sum, m) => sum + (m.relevance_score || 0), 0) / matches.length;
        context += `  Average relevance: ${avgRelevance.toFixed(0)}%\n`;
      });
      context += `\n`;
    }

    // If no aggregated data available, query raw posts
    if (
      networkData.length === 0 &&
      chatterData.length === 0 &&
      themesData.length === 0 &&
      newsData.length === 0
    ) {
      const postWhere: any = {
        project_id: projectId,
        content: { not: null },
      };

      if (dateFilter) {
        postWhere.createdAt = dateFilter;
      }

      if (platformFilter) {
        postWhere.platform = platformFilter;
      }

      if (filters.language && filters.language !== "all") {
        postWhere.language = filters.language;
      }

      const posts = await prisma.post.findMany({
        where: postWhere,
        select: {
          platform: true,
          authorName: true,
          content: true,
          sentiment: true,
          metricsLikes: true,
          metricsComments: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      });

      if (posts.length > 0) {
        context += `## Recent Posts (${posts.length}):\n`;
        posts.slice(0, 10).forEach((post, i) => {
          context += `${i + 1}. [${post.platform}] ${post.authorName}: "${post.content?.substring(0, 100)}..."\n`;
          context += `   Engagement: ${(post.metricsLikes || 0) + (post.metricsComments || 0)} reactions, Sentiment: ${post.sentiment}\n`;
        });
        context += `\n`;
      } else {
        context += `No posts available with the current filters.\n\n`;
      }
    }

    context += `Please answer the user's question based on this data. Be specific, insightful, and cite data points when relevant.`;

    // Build messages for OpenAI
    const openaiMessages = [
      {
        role: "system" as const,
        content: context,
      },
      ...conversationHistory.map((msg: Message) => ({
        role: msg.role,
        content: msg.content,
      })),
      {
        role: "user" as const,
        content: question,
      },
    ];

    // Call OpenAI
    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: openaiMessages,
        temperature: 0.7,
        max_tokens: 1000,
      }),
    });

    if (!openaiResponse.ok) {
      const error = await openaiResponse.text();
      console.error("OpenAI API error:", error);
      throw new Error("Failed to get AI response");
    }

    const openaiData = await openaiResponse.json();
    const aiResponse = openaiData.choices[0]?.message?.content || "I couldn't generate a response.";

    return NextResponse.json({ response: aiResponse });
  } catch (error) {
    console.error("Error in AI chat:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
