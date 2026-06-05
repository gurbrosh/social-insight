#!/usr/bin/env npx tsx
/**
 * Diagnostic script to check why Facebook posts aren't making it to chatter/themes
 *
 * Usage:
 *   npx tsx scripts/diagnose-facebook-analysis.ts <projectId>
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const projectId = process.argv[2];

  if (!projectId) {
    console.error("Usage: npx tsx scripts/diagnose-facebook-analysis.ts <projectId>");
    process.exit(1);
  }

  console.log(`\n🔍 Diagnosing Facebook posts analysis for project: ${projectId}\n`);

  // Get Facebook posts directly (SQLite is case-sensitive, use exact match)
  const facebookPosts = await prisma.post.findMany({
    where: {
      project_id: projectId,
      platform: "facebook", // Exact match for SQLite
    },
    select: {
      id: true,
      postId: true,
      threadRefId: true,
      authorName: true,
      content: true,
      sentiment: true,
      metricsLikes: true,
      metricsComments: true,
      metricsShares: true,
      url: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  console.log(`📊 Facebook Posts Summary:`);
  console.log(`   Total Facebook posts: ${facebookPosts.length}`);

  const rootPosts = facebookPosts.filter((p) => !p.threadRefId);
  const replies = facebookPosts.filter((p) => p.threadRefId);
  const withSentiment = facebookPosts.filter((p) => p.sentiment);
  const withoutSentiment = facebookPosts.filter((p) => !p.sentiment);

  console.log(`   Root posts: ${rootPosts.length}`);
  console.log(`   Replies/comments: ${replies.length}`);
  console.log(`   Posts with sentiment: ${withSentiment.length}`);
  console.log(`   Posts without sentiment: ${withoutSentiment.length}`);
  console.log();

  // Check thread structure
  console.log(`🔗 Thread Structure Analysis:`);

  const postMap = new Map(facebookPosts.map((p) => [p.postId, p]));
  type PostItem = (typeof facebookPosts)[number];
  const threads: Array<{ root: PostItem; replies: PostItem[] }> = [];

  for (const root of rootPosts) {
    // Extract story_fbid from root URL
    let rootStoryFbid: string | null = null;
    if (root.url) {
      const storyFbidMatch = root.url.match(/story_fbid=([^&]+)/);
      if (storyFbidMatch && storyFbidMatch[1]) {
        rootStoryFbid = storyFbidMatch[1];
      }
    }

    // Find replies
    const threadReplies = replies.filter((reply) => {
      if (!reply.threadRefId) return false;

      // Direct match by postId
      if (reply.threadRefId === root.postId) return true;

      // Match by story_fbid
      if (rootStoryFbid && reply.threadRefId === rootStoryFbid) return true;

      // Traverse up threadRefId chain
      let parent = postMap.get(reply.threadRefId);
      const visited = new Set<string>();
      let depth = 0;

      while (parent && parent.threadRefId && depth < 100) {
        if (visited.has(parent.postId)) break;
        visited.add(parent.postId);

        if (parent.threadRefId === root.postId) return true;
        if (rootStoryFbid && parent.threadRefId === rootStoryFbid) return true;

        parent = postMap.get(parent.threadRefId);
        depth++;
      }

      return false;
    });

    if (threadReplies.length > 0) {
      threads.push({ root, replies: threadReplies });
    }
  }

  console.log(`   Threads formed: ${threads.length}`);

  const threadsWithMultipleParticipants = threads.filter((t) => {
    const participants = new Set(
      [t.root.authorName, ...t.replies.map((r) => r.authorName)].filter(Boolean)
    );
    return participants.size >= 2;
  });

  const threadsWithEnoughReplies = threads.filter((t) => t.replies.length >= 2);

  console.log(`   Threads with ≥2 participants: ${threadsWithMultipleParticipants.length}`);
  console.log(`   Threads with ≥2 replies: ${threadsWithEnoughReplies.length}`);
  console.log(
    `   Threads meeting chatter requirements: ${
      threads.filter((t) => {
        const participants = new Set(
          [t.root.authorName, ...t.replies.map((r) => r.authorName)].filter(Boolean)
        );
        return participants.size >= 2 || t.replies.length >= 2;
      }).length
    }`
  );
  console.log();

  // Check theme matches
  console.log(`🎯 Theme Analysis:`);
  const allThemeMatches = await prisma.themesAnalysis.findMany({
    where: {
      project_id: projectId,
      deleted_at: null,
    },
    select: {
      id: true,
      theme_name: true,
      post_id: true,
      relevance_score: true,
      platform: true,
    },
  });

  const themeMatches = allThemeMatches.filter((m) => m.platform?.toLowerCase() === "facebook");
  console.log(`   Facebook posts matched to themes: ${themeMatches.length}`);
  if (themeMatches.length > 0) {
    const byTheme = new Map<string, number>();
    themeMatches.forEach((m) => {
      byTheme.set(m.theme_name, (byTheme.get(m.theme_name) || 0) + 1);
    });
    console.log(`   Breakdown by theme:`);
    Array.from(byTheme.entries()).forEach(([theme, count]) => {
      console.log(`      - ${theme}: ${count}`);
    });
  }
  console.log();

  // Check chatter records
  console.log(`💬 Chatter Analysis:`);
  const allChatterRecords = await prisma.chatterAnalysis.findMany({
    where: {
      project_id: projectId,
      deleted_at: null,
    },
    select: {
      id: true,
      discussion_title: true,
      platforms_json: true,
      participant_count: true,
      total_messages: true,
      importance_score: true,
    },
  });

  const chatterRecords = allChatterRecords.filter((c) => {
    if (!c.platforms_json) return false;
    try {
      const platforms = JSON.parse(c.platforms_json) as string[];
      return platforms.some((p) => p?.toLowerCase() === "facebook");
    } catch {
      return false;
    }
  });

  console.log(`   Facebook threads in chatter: ${chatterRecords.length}`);
  if (chatterRecords.length > 0) {
    console.log(`   Sample chatter items:`);
    chatterRecords.slice(0, 5).forEach((c, i) => {
      console.log(
        `      ${i + 1}. ${c.discussion_title} (${c.participant_count} participants, ${c.total_messages} messages)`
      );
    });
  }
  console.log();

  // Check sentiment analysis status
  console.log(`📝 Sentiment Analysis Status:`);
  console.log(
    `   Posts with sentiment: ${withSentiment.length} (${((withSentiment.length / facebookPosts.length) * 100).toFixed(1)}%)`
  );
  console.log(
    `   Posts without sentiment: ${withoutSentiment.length} (${((withoutSentiment.length / facebookPosts.length) * 100).toFixed(1)}%)`
  );

  if (withoutSentiment.length > 0) {
    console.log(
      `\n   ⚠️  ${withoutSentiment.length} Facebook posts don't have sentiment analysis.`
    );
    console.log(`   These posts won't be analyzed for themes (themes require sentiment first).`);
    console.log(`   Recommendation: Run sentiment analysis first.`);
  }
  console.log();

  // Check thread linking issues
  console.log(`🔗 Thread Linking Analysis:`);
  const unlinkedReplies = replies.filter((reply) => {
    // Check if this reply can find its root
    if (reply.threadRefId === null) return false;

    // Try direct match
    const directMatch = rootPosts.find((r) => r.postId === reply.threadRefId);
    if (directMatch) return false;

    // Try story_fbid match
    const storyFbidMatch = rootPosts.find((r) => {
      if (!r.url) return false;
      const match = r.url.match(/story_fbid=([^&]+)/);
      return match && match[1] === reply.threadRefId;
    });
    if (storyFbidMatch) return false;

    // Try traversal
    let parent = postMap.get(reply.threadRefId);
    let depth = 0;
    while (parent && parent.threadRefId && depth < 100) {
      const current = parent;
      const refId = current.threadRefId;
      const rootMatch = rootPosts.find((r) => r.postId === refId);
      if (rootMatch) return false;
      parent = refId ? postMap.get(refId) : undefined;
      depth++;
    }

    return true; // Couldn't find root
  });

  console.log(`   Replies that couldn't be linked to root posts: ${unlinkedReplies.length}`);
  if (unlinkedReplies.length > 0 && unlinkedReplies.length <= 10) {
    console.log(`   Sample unlinked replies:`);
    unlinkedReplies.slice(0, 5).forEach((r, i) => {
      console.log(
        `      ${i + 1}. Post ID: ${r.postId}, threadRefId: ${r.threadRefId}, Author: ${r.authorName || "Unknown"}`
      );
    });
  }
  console.log();

  // Summary and recommendations
  console.log(`📋 Summary & Recommendations:`);
  console.log(`─`.repeat(80));

  if (withoutSentiment.length > 0) {
    console.log(`\n1. ⚠️  SENTIMENT ANALYSIS NEEDED:`);
    console.log(`   ${withoutSentiment.length} Facebook posts don't have sentiment.`);
    console.log(`   These posts cannot be analyzed for themes.`);
    console.log(`   Action: Run sentiment analysis first.`);
  }

  if (threads.length === 0 && replies.length > 0) {
    console.log(`\n2. ⚠️  THREAD LINKING ISSUE:`);
    console.log(`   Found ${replies.length} replies but ${threads.length} threads formed.`);
    console.log(`   Replies may not be properly linked to root posts.`);
    console.log(`   Check threadRefId values and story_fbid matching.`);
  }

  if (threads.length > 0 && chatterRecords.length === 0) {
    console.log(`\n3. ⚠️  CHATTER ANALYSIS FILTERING:`);
    console.log(`   Found ${threads.length} threads but ${chatterRecords.length} in chatter.`);
    console.log(`   Threads may be failing:`);
    console.log(`   - Embedding similarity prefilter (top 150 threads)`);
    console.log(`   - Relevance scoring (≥40 for Facebook)`);
    console.log(`   - Thread requirements (≥2 participants OR ≥2 replies)`);
  }

  if (withSentiment.length > 0 && themeMatches.length === 0) {
    console.log(`\n4. ⚠️  THEME MATCHING ISSUE:`);
    console.log(
      `   ${withSentiment.length} posts have sentiment but ${themeMatches.length} theme matches.`
    );
    console.log(`   Posts may not be matching themes due to:`);
    console.log(`   - Low relevance scores (<60 threshold)`);
    console.log(`   - Not semantically aligned with theme essence`);
    console.log(`   - Not matching project monitoring focus/keywords`);
  }

  console.log(`\n`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
