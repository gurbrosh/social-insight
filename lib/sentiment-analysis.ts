/**
 * Sentiment Analysis Service using OpenAI API
 * Analyzes post content and returns sentiment classification
 */

import { prisma } from "@/lib/prisma";
import { configService } from "@/lib/config-service";
import { isGithubPlatform } from "@/lib/utils/platform";

export type SentimentType = "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "MIXED";

export interface SentimentAnalysisResult {
  sentiment: SentimentType;
  confidence?: number;
  reasoning?: string;
}

/**
 * Analyze sentiment of a single post using OpenAI API
 */
export async function analyzePostSentiment(content: string): Promise<SentimentAnalysisResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }

  if (!content || content.trim().length === 0) {
    return {
      sentiment: "NEUTRAL",
      reasoning: "No content to analyze",
    };
  }

  const postContent = content;

  try {
    const openaiBaseUrl =
      (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";
    const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // Using the more cost-effective model
        messages: [
          {
            role: "system",
            content: `You are a sentiment analysis expert. Analyze the sentiment of social media posts and classify them into one of these categories:
- POSITIVE: Expresses positive emotions, satisfaction, happiness, excitement, praise, or optimism
- NEGATIVE: Expresses negative emotions, dissatisfaction, anger, frustration, criticism, or pessimism  
- NEUTRAL: Factual, informational, or balanced content without strong emotional tone
- MIXED: Contains both positive and negative elements or conflicting emotions

Respond with ONLY a JSON object in this exact format:
{
  "sentiment": "POSITIVE|NEGATIVE|NEUTRAL|MIXED",
  "confidence": 0.95,
  "reasoning": "Brief explanation of why this sentiment was chosen"
}

Do not include any other text or formatting.`,
          },
          {
            role: "user",
            content: `Analyze the sentiment of this social media post:\n\n"${postContent}"`,
          },
        ],
        temperature: 0.3, // Lower temperature for more consistent results
        max_tokens: 150,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        console.warn(
          `[OpenAI] Throttled (429) operation=sentiment_single retryAfter=${retryAfter ?? "none"}`
        );
      }
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("No content returned from OpenAI API");
    }

    // Parse the JSON response
    const result = JSON.parse(content);

    // Validate the sentiment value
    const validSentiments: SentimentType[] = ["POSITIVE", "NEGATIVE", "NEUTRAL", "MIXED"];
    if (!validSentiments.includes(result.sentiment)) {
      throw new Error(`Invalid sentiment value: ${result.sentiment}`);
    }

    return {
      sentiment: result.sentiment,
      confidence: result.confidence,
      reasoning: result.reasoning,
    };
  } catch (error) {
    console.error("Error analyzing sentiment:", error);

    // Fallback to neutral sentiment if API fails
    return {
      sentiment: "NEUTRAL",
      reasoning: `Analysis failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Analyze sentiment for multiple posts and update database
 */
export async function analyzePostsSentiment(postIds: string[]): Promise<{
  processed: number;
  skipped: number;
  errors: number;
  duration: number;
  results: Array<{
    postId: string;
    sentiment: SentimentType | null;
    error?: string;
  }>;
}> {
  const startTime = Date.now();

  const results: Array<{
    postId: string;
    sentiment: SentimentType | null;
    error?: string;
  }> = [];

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  // Process posts in batches to avoid rate limits
  const batchSize = (await configService.getConfig("performance", "sentiment_batch_size")) || 5;
  const batches = [];
  for (let i = 0; i < postIds.length; i += batchSize) {
    batches.push(postIds.slice(i, i + batchSize));
  }

  for (const batch of batches) {
    // Process batch concurrently
    const batchPromises = batch.map(async (postId) => {
      try {
        // Get the post
        const post = await prisma.post.findUnique({
          where: { id: parseInt(postId) },
          select: { id: true, content: true, sentiment: true, platform: true },
        });

        if (!post) {
          return {
            postId,
            sentiment: null,
            error: "Post not found",
          };
        }

        if (isGithubPlatform(post.platform)) {
          return {
            postId,
            sentiment: null,
            error: "GitHub repo ingest: sentiment LLM skipped",
          };
        }

        // Skip if sentiment already exists
        if (post.sentiment !== null) {
          return {
            postId,
            sentiment: post.sentiment as SentimentType,
            error: "Sentiment already exists",
          };
        }

        // Skip if no content
        if (!post.content || post.content.trim().length === 0) {
          return {
            postId,
            sentiment: null,
            error: "No content to analyze",
          };
        }

        // Analyze sentiment
        const analysis = await analyzePostSentiment(post.content);

        // Update the post with sentiment
        await prisma.post.update({
          where: { id: parseInt(postId) },
          data: {
            sentiment: analysis.sentiment,
            ai_processed_at: new Date(),
          },
        });

        return {
          postId,
          sentiment: analysis.sentiment,
        };
      } catch (error) {
        return {
          postId,
          sentiment: null,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    // Add small delay between batches to respect rate limits
    if (batches.indexOf(batch) < batches.length - 1) {
      const delay = (await configService.getConfig("performance", "sentiment_batch_delay")) || 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Count results
  results.forEach((result) => {
    if (result.error) {
      if (
        result.error === "Sentiment already exists" ||
        result.error === "GitHub repo ingest: sentiment LLM skipped"
      ) {
        skipped++;
      } else {
        errors++;
      }
    } else {
      processed++;
    }
  });

  const endTime = Date.now();
  const duration = (endTime - startTime) / 1000; // Convert to seconds

  return {
    processed,
    skipped,
    errors,
    duration,
    results,
  };
}

/**
 * Analyze sentiment for all posts in a project that don't have sentiment yet
 */
export async function analyzeProjectSentiment(projectId: string): Promise<{
  processed: number;
  skipped: number;
  errors: number;
  duration: number;
  results: Array<{
    postId: string;
    sentiment: SentimentType | null;
    error?: string;
  }>;
}> {
  // Get all posts in the project that don't have sentiment
  const posts = await prisma.post.findMany({
    where: {
      project_id: projectId,
      sentiment: null,
      AND: [{ content: { not: null } }, { content: { not: "" } }],
    },
    select: { id: true },
  });

  const postIds = posts.map((post) => post.id.toString());

  if (postIds.length === 0) {
    return {
      processed: 0,
      skipped: 0,
      errors: 0,
      duration: 0,
      results: [],
    };
  }

  return analyzePostsSentiment(postIds);
}
