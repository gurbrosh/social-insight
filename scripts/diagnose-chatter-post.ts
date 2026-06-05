#!/usr/bin/env npx tsx
/**
 * Diagnostic script to understand why a specific post didn't make it to chatter
 *
 * Usage:
 *   npx tsx scripts/diagnose-chatter-post.ts <projectName> <postUrl>
 *
 * Example:
 *   npx tsx scripts/diagnose-chatter-post.ts "Test12" "https://www.facebook.com/permalink.php?story_fbid=pfbid02cAmZqqV9NsWoE64m521o79sP2e3A7pY9LTHYihKAFu6MnmrHTT2v6rm6umHJ7DNel&id=61554983172978"
 */

import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const prisma = new PrismaClient();

async function main() {
  const projectName = process.argv[2];
  const postUrl = process.argv[3];

  if (!projectName || !postUrl) {
    console.error("Usage: npx tsx scripts/diagnose-chatter-post.ts <projectName> <postUrl>");
    process.exit(1);
  }

  console.log(`\n🔍 Diagnosing why post didn't make it to chatter...\n`);
  console.log(`Project: ${projectName}`);
  console.log(`Post URL: ${postUrl}\n`);

  // Find project
  const project = await prisma.project.findFirst({
    where: {
      name: { contains: projectName },
      deleted_at: null,
    },
    include: {
      keywords: { where: { deleted_at: null }, select: { keyword: true } },
      brands: { where: { deleted_at: null }, select: { brand_name: true } },
    },
  });

  if (!project) {
    console.error(`❌ Project "${projectName}" not found`);
    process.exit(1);
  }

  console.log(`✅ Found project: ${project.name} (ID: ${project.id})\n`);

  // Build project essence (same as in comprehensive-analysis.ts)
  const keywordList = project.keywords?.map((k) => k.keyword).filter(Boolean) || [];
  const brandList = project.brands?.map((b) => b.brand_name).filter(Boolean) || [];
  const monitoringFocus = (project as any)?.monitoring_focus as string | undefined;

  let essence = `Project: ${project.name}
${project.description ? `Description: ${project.description}` : ""}`;

  if (monitoringFocus) {
    essence += `\n\n🎯 MONITORING FOCUS (What we're looking for):\n${monitoringFocus}`;
  }

  essence += `\nKeywords: ${keywordList.join(", ")}
Brands: ${brandList.join(", ")}`.trim();

  console.log("📋 Project Essence:");
  console.log("─".repeat(80));
  console.log(essence);
  console.log("─".repeat(80));
  console.log();

  // Find the post in database
  const post = await prisma.downstreamPost.findFirst({
    where: {
      url: { contains: postUrl },
    },
    include: {
      project: {
        select: { id: true, name: true },
      },
    },
  });

  if (!post) {
    console.log(`⚠️  Post not found in database. It may not have been processed yet.`);
    console.log(`   Checking if post exists in any project...\n`);

    // Try to find by partial URL match
    const partialMatch = await prisma.downstreamPost.findFirst({
      where: {
        url: { contains: postUrl.split("?")[0] },
      },
      select: {
        id: true,
        url: true,
        project_id: true,
        platform: true,
        createdAt: true,
      },
    });

    if (partialMatch) {
      console.log(`   Found similar post: ${partialMatch.url}`);
      console.log(`   Platform: ${partialMatch.platform}`);
      console.log(`   Created: ${partialMatch.createdAt}`);
      console.log(`   Project ID: ${partialMatch.project_id}`);
    } else {
      console.log(`   ❌ No matching post found in database.`);
    }
    process.exit(0);
  }

  console.log(`✅ Found post in database:`);
  console.log(`   ID: ${post.id}`);
  console.log(`   Platform: ${post.platform}`);
  console.log(`   URL: ${post.url}`);
  console.log(`   Created: ${post.createdAt}`);
  console.log(`   Content preview: ${(post.content || "").substring(0, 200)}...`);
  console.log();

  // Check if post has replies (thread structure)
  const replies = await prisma.downstreamPost.findMany({
    where: {
      threadRefId: post.id.toString(),
    },
    select: {
      id: true,
      authorName: true,
      content: true,
      metricsLikes: true,
      createdAt: true,
    },
  });

  console.log(`📊 Thread Structure:`);
  console.log(`   Root post: 1`);
  console.log(`   Replies: ${replies.length}`);
  console.log(
    `   Total participants: ${new Set([post.authorName, ...replies.map((r) => r.authorName)]).size}`
  );
  console.log(
    `   Total engagement: ${(post.metricsLikes || 0) + replies.reduce((sum, r) => sum + (r.metricsLikes || 0), 0)}`
  );
  console.log();

  if (replies.length > 0) {
    console.log(`   Sample replies:`);
    replies.slice(0, 5).forEach((r, i) => {
      console.log(`   ${i + 1}. ${r.authorName}: ${(r.content || "").substring(0, 100)}...`);
    });
    if (replies.length > 5) {
      console.log(`   ... and ${replies.length - 5} more`);
    }
    console.log();
  }

  // Check if there's a chatter analysis record for this post (post_ids JSON array may contain this post id)
  const chatterCandidates = await prisma.chatterAnalysis.findMany({
    where: {
      project_id: project.id,
      deleted_at: null,
    },
    select: {
      id: true,
      importance_score: true,
      created_at: true,
      post_ids: true,
    },
  });
  const postIdStr = post.id.toString();
  const chatterRecord = chatterCandidates.find((c) => {
    if (!c.post_ids) return false;
    try {
      const ids = JSON.parse(c.post_ids) as unknown;
      return Array.isArray(ids) && ids.some((id: unknown) => String(id) === postIdStr);
    } catch {
      return c.post_ids.includes(postIdStr);
    }
  });

  if (chatterRecord) {
    console.log(`✅ Post WAS stored in chatter analysis:`);
    console.log(`   Importance score: ${chatterRecord.importance_score}`);
    console.log(`   Created: ${chatterRecord.created_at}`);
    console.log();
    console.log(`   🤔 If you're not seeing it in the UI, check:`);
    console.log(`      - Date range filters`);
    console.log(`      - Platform filters`);
    console.log(`      - minImportance filter (default: 10)`);
  } else {
    console.log(`❌ Post was NOT stored in chatter analysis`);
    console.log();
    console.log(`🔍 Analysis:`);
    console.log();

    // Check thread requirements
    const isFacebook = post.platform === "facebook";
    const replyThreshold = isFacebook ? 2 : 1;
    const participantCount = new Set([post.authorName, ...replies.map((r) => r.authorName)]).size;

    console.log(`1. Thread Identification (Stage 1):`);
    const passesThreadId = participantCount >= 2 || replies.length >= replyThreshold;
    console.log(`   ✓ Participants: ${participantCount} (required: ≥2)`);
    console.log(
      `   ✓ Replies: ${replies.length} (required: ≥${replyThreshold} for ${post.platform})`
    );
    console.log(`   ${passesThreadId ? "✅ PASSED" : "❌ FAILED"}`);
    console.log();

    if (!passesThreadId) {
      console.log(
        `   ⚠️  Post failed at Stage 1: Not enough participants or replies to form a thread.`
      );
      process.exit(0);
    }

    console.log(`2. Embedding Similarity Prefilter (Stage 2):`);
    console.log(`   ⚠️  Cannot verify without running full analysis`);
    console.log(`   This stage selects top 150 threads by similarity to project essence`);
    console.log(`   If there were 150+ more relevant threads, this one might not make the cut`);
    console.log();

    console.log(`3. AI Relevance Scoring (Stage 3) - MOST LIKELY CAUSE:`);
    const threshold = isFacebook ? 40 : 50;
    console.log(`   Threshold: ${threshold} (${isFacebook ? "Facebook" : "General"} platform)`);
    console.log(`   ⚠️  Post likely scored below ${threshold}`);
    console.log();
    console.log(`   📝 Why it might have scored low:`);
    console.log(`      - Post topic/brand may not match project's brand list or monitoring focus`);
    console.log(`      - Project monitoring focus: ${monitoringFocus || "Not specified"}`);
    console.log(`      - Project brands: ${brandList.length > 0 ? brandList.join(", ") : "None"}`);
    console.log();

    if (monitoringFocus) {
      console.log(`   🎯 The AI scoring uses MONITORING FOCUS as the PRIMARY semantic context.`);
      console.log(`      If the post doesn't align with what's described in monitoring focus,`);
      console.log(`      it will score low even if it's about a related topic.`);
    } else {
      console.log(`   ⚠️  No monitoring focus specified - scoring based on keywords/brands only.`);
      if (brandList.length > 0) {
        console.log(
          `   ❌ If the post is about a brand not in the list, that can explain a low score.`
        );
      }
    }
    console.log();

    console.log(`4. Deduplication (Stage 4):`);
    console.log(`   ⚠️  Cannot verify without running full analysis`);
    console.log(`   Checks for duplicate threads (same day + platform + content)`);
    console.log();

    console.log(`💡 Recommendations:`);
    console.log(`   1. Check server logs for: "[Analysis] ⚠️  Rejecting high-engagement thread"`);
    console.log(`   2. Review project's monitoring focus and brand list`);
    console.log(
      `   3. If the post's brand/topic should be in scope, add it to brands or update monitoring focus`
    );
    console.log(`   4. Consider lowering Facebook threshold if too strict (currently: 40)`);
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
