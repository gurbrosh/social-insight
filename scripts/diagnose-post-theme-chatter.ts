#!/usr/bin/env npx tsx
/**
 * Diagnostic script to understand why a specific post didn't match themes or make it to chatter
 *
 * Usage:
 *   npx tsx scripts/diagnose-post-theme-chatter.ts <postUrl> [projectId]
 *
 * Example:
 *   npx tsx scripts/diagnose-post-theme-chatter.ts "https://www.linkedin.com/feed/update/urn:li:activity:7422625073208930304/"
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const postUrl = process.argv[2];
  const projectId = process.argv[3];

  if (!postUrl) {
    console.error("Usage: npx tsx scripts/diagnose-post-theme-chatter.ts <postUrl> [projectId]");
    process.exit(1);
  }

  console.log(`\n🔍 Diagnosing post: ${postUrl}\n`);

  // Extract activity ID from LinkedIn URL
  const activityMatch = postUrl.match(/activity:(\d+)/);
  const activityId = activityMatch ? activityMatch[1] : null;

  // Find the post in database
  let post = null;
  let project = null;

  if (projectId) {
    // Search in specific project
    post = await prisma.post.findFirst({
      where: {
        project_id: projectId,
        OR: [
          { url: { contains: postUrl.split("?")[0] } },
          { url: { contains: activityId || "" } },
          ...(activityId ? [{ postId: { contains: activityId } }] : []),
        ],
      },
      include: {
        project: {
          include: {
            keywords: { where: { deleted_at: null }, select: { keyword: true } },
            brands: { where: { deleted_at: null }, select: { brand_name: true } },
            themes: {
              where: { deleted_at: null },
              select: { id: true, theme_name: true, description: true },
            },
          },
        },
      },
    });
  } else {
    // Search across all projects
    post = await prisma.post.findFirst({
      where: {
        OR: [
          { url: { contains: postUrl.split("?")[0] } },
          { url: { contains: activityId || "" } },
          ...(activityId ? [{ postId: { contains: activityId } }] : []),
        ],
      },
      include: {
        project: {
          include: {
            keywords: { where: { deleted_at: null }, select: { keyword: true } },
            brands: { where: { deleted_at: null }, select: { brand_name: true } },
            themes: {
              where: { deleted_at: null },
              select: { id: true, theme_name: true, description: true },
            },
          },
        },
      },
    });
  }

  if (!post) {
    console.log(`⚠️  Post not found in Post table. Checking DownstreamPost...\n`);

    const downstreamPost = await prisma.downstreamPost.findFirst({
      where: {
        OR: [
          { url: { contains: postUrl.split("?")[0] } },
          { url: { contains: activityId || "" } },
          ...(activityId ? [{ postId: { contains: activityId } }] : []),
        ],
      },
      include: {
        project: {
          include: {
            keywords: { where: { deleted_at: null }, select: { keyword: true } },
            brands: { where: { deleted_at: null }, select: { brand_name: true } },
            themes: {
              where: { deleted_at: null },
              select: { id: true, theme_name: true, description: true },
            },
          },
        },
      },
    });

    if (downstreamPost) {
      console.log(`✅ Found post in DownstreamPost (not yet processed to Post table):`);
      console.log(`   ID: ${downstreamPost.id}`);
      console.log(`   Platform: ${downstreamPost.platform}`);
      console.log(`   URL: ${downstreamPost.url}`);
      console.log(`   Status: ${downstreamPost.status}`);
      console.log(`   Project: ${downstreamPost.project?.name || "Unknown"}`);
      console.log(
        `\n   ⚠️  Post is in DownstreamPost but hasn't been processed to Post table yet.`
      );
      console.log(`   This means it hasn't been analyzed for sentiment, themes, or chatter.`);
      await prisma.$disconnect();
      return;
    } else {
      console.log(`❌ Post not found in database at all.`);
      console.log(`   It may not have been scraped yet, or the URL format doesn't match.`);
      await prisma.$disconnect();
      return;
    }
  }

  project = post.project;
  if (!project) {
    console.log(`❌ Post found but no project associated`);
    await prisma.$disconnect();
    return;
  }

  console.log(`✅ Found post:`);
  console.log(`   Post ID: ${post.id}`);
  console.log(`   Platform: ${post.platform}`);
  console.log(`   URL: ${post.url}`);
  console.log(`   Created: ${post.createdAt}`);
  console.log(`   Author: ${post.authorName || "Unknown"}`);
  console.log(`   Sentiment: ${post.sentiment || "NOT ANALYZED"}`);
  console.log(`   Content preview: ${(post.content || "").substring(0, 200)}...`);
  console.log(`\n📋 Project: ${project.name} (ID: ${project.id})`);

  // Build project essence
  const keywordList = project.keywords?.map((k) => k.keyword).filter(Boolean) || [];
  const brandList = project.brands?.map((b) => b.brand_name).filter(Boolean) || [];
  const monitoringFocus = (project as any)?.monitoring_focus as string | undefined;
  const themes = project.themes || [];

  console.log(`   Keywords: ${keywordList.length > 0 ? keywordList.join(", ") : "None"}`);
  console.log(`   Brands: ${brandList.length > 0 ? brandList.join(", ") : "None"}`);
  if (monitoringFocus) {
    console.log(`   Monitoring Focus: ${monitoringFocus}`);
  }
  console.log(`   Themes: ${themes.length} total`);
  themes.forEach((t, i) => {
    console.log(`      ${i + 1}. "${t.theme_name}"${t.description ? ` - ${t.description}` : ""}`);
  });
  console.log();

  // Check theme matches
  console.log(`\n🎯 THEME ANALYSIS:`);
  console.log(`─`.repeat(80));

  if (!post.sentiment) {
    console.log(`❌ Post has NO sentiment - theme matching requires sentiment analysis first.`);
    console.log(`   Posts without sentiment are skipped during theme analysis.`);
    console.log(`   Recommendation: Run sentiment analysis first, then theme analysis.`);
  } else {
    const themeMatches = await prisma.themesAnalysis.findMany({
      where: {
        project_id: project.id,
        post_id: post.id,
        deleted_at: null,
      },
      select: {
        id: true,
        theme_id: true,
        theme_name: true,
        relevance_score: true,
        sentiment: true,
      },
    });

    if (themeMatches.length === 0) {
      console.log(`❌ Post did NOT match any themes.`);
      console.log(`\n   Possible reasons:`);
      console.log(`   1. Theme matching hasn't been run yet for this post`);
      console.log(`   2. Post didn't meet relevance threshold (≥60)`);
      console.log(`   3. Post doesn't semantically align with any theme's essence`);

      // Check if there's a pricing/cost theme
      const pricingTheme = themes.find(
        (t) =>
          t.theme_name.toLowerCase().includes("pricing") ||
          t.theme_name.toLowerCase().includes("cost") ||
          t.description?.toLowerCase().includes("pricing") ||
          t.description?.toLowerCase().includes("cost")
      );

      if (pricingTheme) {
        console.log(`\n   🎯 Found pricing/cost theme: "${pricingTheme.theme_name}"`);
        console.log(`      Description: ${pricingTheme.description || "None"}`);
        console.log(`\n   Why it might not have matched:`);
        console.log(`      - Post sentiment: ${post.sentiment}`);
        console.log(`      - Post content: ${(post.content || "").substring(0, 300)}...`);
        console.log(
          `      - Theme requires semantic alignment with: ${pricingTheme.theme_name}${pricingTheme.description ? ` - ${pricingTheme.description}` : ""}`
        );
        console.log(
          `      - The LLM may have determined the post doesn't match the theme's essence`
        );
      } else {
        console.log(`\n   ⚠️  No pricing/cost theme found in project.`);
      }
    } else {
      console.log(`✅ Post matched ${themeMatches.length} theme(s):`);
      themeMatches.forEach((match, i) => {
        console.log(
          `   ${i + 1}. "${match.theme_name}" (relevance: ${match.relevance_score || "N/A"})`
        );
      });
    }
  }

  // Check chatter
  console.log(`\n\n💬 CHATTER ANALYSIS:`);
  console.log(`─`.repeat(80));

  // Find root post
  let rootPostId = post.id;
  if (post.threadRefId) {
    // This is a reply, find the root
    const rootPost = await prisma.post.findFirst({
      where: {
        project_id: project.id,
        postId: post.threadRefId,
      },
    });
    if (rootPost) {
      rootPostId = rootPost.id;
      console.log(`   Post is a reply. Root post ID: ${rootPostId}`);
    }
  }

  // Check for replies
  const replies = await prisma.post.findMany({
    where: {
      project_id: project.id,
      threadRefId: post.postId,
    },
    select: {
      id: true,
      authorName: true,
      content: true,
      metricsComments: true,
      metricsLikes: true,
    },
  });

  const participants = new Set(
    [post.authorName, ...replies.map((r) => r.authorName)].filter(Boolean)
  );
  const totalEngagement =
    (post.metricsLikes || 0) +
    (post.metricsComments || 0) +
    (post.metricsShares || 0) +
    replies.reduce((sum, r) => sum + (r.metricsLikes || 0) + (r.metricsComments || 0), 0);

  console.log(`   Thread structure:`);
  console.log(`      Root post: 1`);
  console.log(`      Replies: ${replies.length}`);
  console.log(`      Participants: ${participants.size}`);
  console.log(`      Total engagement: ${totalEngagement}`);

  // Check chatter record
  const chatterRecord = await prisma.chatterAnalysis.findFirst({
    where: {
      project_id: project.id,
      post_ids: { contains: rootPostId.toString() },
      deleted_at: null,
    },
    select: {
      id: true,
      importance_score: true,
      total_engagement: true,
      participant_count: true,
      discussion_title: true,
    },
  });

  if (chatterRecord) {
    console.log(`\n   ✅ Post WAS stored in chatter analysis:`);
    console.log(`      Discussion title: ${chatterRecord.discussion_title}`);
    console.log(`      Importance score: ${chatterRecord.importance_score || "N/A"}`);
    console.log(`      Total engagement: ${chatterRecord.total_engagement}`);
    console.log(`      Participants: ${chatterRecord.participant_count}`);
    console.log(`\n   🤔 If you're not seeing it in the UI, check:`);
    console.log(`      - Date range filters`);
    console.log(`      - Platform filters`);
    console.log(`      - minImportance filter (default: 10)`);
  } else {
    console.log(`\n   ❌ Post was NOT stored in chatter analysis`);

    // Check thread requirements
    const isFacebook = post.platform === "facebook";
    const replyThreshold = isFacebook ? 2 : 1;
    const passesThreadId = participants.size >= 2 || replies.length >= replyThreshold;
    const threshold = isFacebook ? 40 : 50;

    console.log(`\n   Stage 1 - Thread Identification:`);
    console.log(
      `      Participants: ${participants.size} (required: ≥2) ${participants.size >= 2 ? "✅" : "❌"}`
    );
    console.log(
      `      Replies: ${replies.length} (required: ≥${replyThreshold} for ${post.platform}) ${replies.length >= replyThreshold ? "✅" : "❌"}`
    );
    console.log(`      ${passesThreadId ? "✅ PASSED" : "❌ FAILED"}`);

    if (!passesThreadId) {
      console.log(`\n   ⚠️  Post failed at Stage 1: Not enough participants or replies.`);
    } else {
      console.log(`\n   Stage 2 - Embedding Similarity:`);
      console.log(`      ⚠️  Cannot verify without running full analysis`);
      console.log(`      Top 150 threads selected by similarity to project essence`);

      console.log(`\n   Stage 3 - AI Relevance Scoring (MOST LIKELY CAUSE):`);
      console.log(
        `      Threshold: ${threshold} (${isFacebook ? "Facebook" : "General"} platform)`
      );
      console.log(`      ⚠️  Post likely scored below ${threshold}`);
      console.log(`\n   Why it might have scored low:`);
      if (monitoringFocus) {
        console.log(`      - Monitoring focus: ${monitoringFocus}`);
        console.log(`      - Post may not align with monitoring focus`);
      } else {
        console.log(`      - No monitoring focus specified`);
        console.log(
          `      - Post may not align with keywords/brands: ${keywordList.length > 0 ? keywordList.join(", ") : "None"}`
        );
      }
    }
  }

  console.log(`\n`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
