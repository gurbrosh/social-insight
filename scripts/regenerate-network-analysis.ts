#!/usr/bin/env npx tsx
/**
 * Regenerate network analysis (key ideas) for a project
 *
 * Usage:
 *   npx tsx scripts/regenerate-network-analysis.ts <projectId>
 */

import { prisma } from "../lib/prisma";
import { runTaskBasedAnalysisForProject } from "../lib/task-based-analysis-run";
import { ulid as generateUlid } from "ulid";

async function main() {
  const projectId = process.argv[2];

  if (!projectId) {
    console.error("Usage: npx tsx scripts/regenerate-network-analysis.ts <projectId>");
    process.exit(1);
  }

  console.log(`\n🔄 Regenerating network analysis (key ideas) for project: ${projectId}\n`);

  try {
    // Verify project exists
    const project = await prisma.project.findFirst({
      where: { id: projectId, deleted_at: null },
      select: { id: true, name: true },
    });

    if (!project) {
      console.error(`❌ Project not found: ${projectId}`);
      process.exit(1);
    }

    console.log(`📋 Project: ${project.name}\n`);

    // Soft-delete existing network analysis entries
    const deletedCount = await prisma.networkAnalysis.updateMany({
      where: { project_id: projectId, deleted_at: null },
      data: { deleted_at: new Date() },
    });

    console.log(`🗑️  Soft-deleted ${deletedCount.count} existing network analysis records\n`);

    const existingProgress = await prisma.analysisProgress.findUnique({
      where: { project_id: projectId },
      select: { project_id: true },
    });

    if (existingProgress) {
      await prisma.analysisProgress.update({
        where: { project_id: projectId },
        data: {
          last_network_post_id: 0,
          last_sanitized_network_at: null,
        },
      });
    } else {
      await prisma.analysisProgress.create({
        data: {
          id: generateUlid(),
          project_id: projectId,
          last_sentiment_post_id: 0,
          last_chatter_post_id: 0,
          last_themes_post_id: 0,
          last_network_post_id: 0,
          last_news_post_id: 0,
          last_brand_post_id: 0,
          last_sanitized_chatter_at: null,
          last_sanitized_themes_at: null,
          last_sanitized_network_at: null,
          last_sanitized_news_at: null,
        },
      });
    }

    console.log(`🔄 Running network-only task-based analysis...\n`);

    const result = await runTaskBasedAnalysisForProject(projectId, {
      steps: ["NETWORK"],
      runSanitization: true,
    });

    console.log(`✅ Successfully regenerated network analysis!`);
    console.log(`   Run ID: ${result.runId}`);
    console.log(`   Tasks reset: ${result.tasksReset}`);
    console.log(`\n✨ Key ideas have been regenerated.`);
  } catch (error) {
    console.error(`❌ Error:`, error);
    process.exit(1);
  } finally {
    // prisma from lib/prisma is a singleton, no disconnect needed
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
