#!/usr/bin/env node

/**
 * Fix script to correct posts_count in ScrapeJob records and link posts to jobs
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function fixPostsCount() {
  console.log("🔧 Starting posts_count fix...");

  try {
    // Get all completed jobs that have posts_count = 0
    const jobsWithZeroCount = await prisma.scrapeJob.findMany({
      where: {
        status: "COMPLETED",
        posts_count: 0,
        deleted_at: null,
      },
      include: {
        scraper: true,
      },
    });

    console.log(`Found ${jobsWithZeroCount.length} completed jobs with posts_count = 0`);

    for (const job of jobsWithZeroCount) {
      console.log(`\n🔍 Processing job ${job.id} (${job.scraper.name})...`);

      // Count posts for this job's project that don't have a job_id yet
      const postsWithoutJobId = await prisma.post.count({
        where: {
          project_id: job.project_id,
          job_id: null,
          platform: job.scraper.platform,
        },
      });

      if (postsWithoutJobId > 0) {
        console.log(
          `  📊 Found ${postsWithoutJobId} posts without job_id for platform ${job.scraper.platform}`
        );

        // Update these posts to link them to this job
        const updateResult = await prisma.post.updateMany({
          where: {
            project_id: job.project_id,
            job_id: null,
            platform: job.scraper.platform,
          },
          data: {
            job_id: job.id,
          },
        });

        console.log(`  ✅ Linked ${updateResult.count} posts to job ${job.id}`);

        // Update the job's posts_count
        await prisma.scrapeJob.update({
          where: { id: job.id },
          data: { posts_count: updateResult.count },
        });

        console.log(`  ✅ Updated job ${job.id} posts_count to ${updateResult.count}`);
      } else {
        console.log(`  ⚠️  No unlinked posts found for this job`);
      }
    }

    // Show summary
    const totalJobs = await prisma.scrapeJob.count({
      where: {
        status: "COMPLETED",
        deleted_at: null,
      },
    });

    const jobsWithPosts = await prisma.scrapeJob.count({
      where: {
        status: "COMPLETED",
        posts_count: { gt: 0 },
        deleted_at: null,
      },
    });

    console.log(`\n📊 Summary:`);
    console.log(`  Total completed jobs: ${totalJobs}`);
    console.log(`  Jobs with posts_count > 0: ${jobsWithPosts}`);
    console.log(`  Jobs with posts_count = 0: ${totalJobs - jobsWithPosts}`);

    const totalPosts = await prisma.post.count();
    const linkedPosts = await prisma.post.count({
      where: { job_id: { not: null } },
    });

    console.log(`  Total posts in database: ${totalPosts}`);
    console.log(`  Posts linked to jobs: ${linkedPosts}`);
    console.log(`  Posts without job_id: ${totalPosts - linkedPosts}`);

    console.log("\n✅ Fix completed successfully!");
  } catch (error) {
    console.error("❌ Error during fix:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the fix
fixPostsCount()
  .then(() => {
    console.log("🎉 Posts count fix completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Posts count fix failed:", error);
    process.exit(1);
  });
