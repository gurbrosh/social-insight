#!/usr/bin/env node

/**
 * Correct fix script to properly link posts to jobs and update posts_count
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function fixPostsCountCorrectly() {
  console.log("🔧 Starting correct posts_count fix...");

  try {
    // Get all completed jobs
    const completedJobs = await prisma.scrapeJob.findMany({
      where: {
        status: "COMPLETED",
        deleted_at: null,
      },
      include: {
        scraper: true,
      },
      orderBy: { created_at: "desc" },
    });

    console.log(`Found ${completedJobs.length} completed jobs`);

    for (const job of completedJobs) {
      console.log(
        `\n🔍 Processing job ${job.id} (${job.scraper.name}) - ${job.scraper.platform}...`
      );

      // Find posts that belong to this job based on project_id and platform
      // and don't have a job_id assigned yet
      const postsToLink = await prisma.post.findMany({
        where: {
          project_id: job.project_id,
          platform: job.scraper.platform,
          OR: [{ job_id: null }, { job_id: "" }],
        },
      });

      console.log(
        `  📊 Found ${postsToLink.length} posts to link for platform ${job.scraper.platform}`
      );

      if (postsToLink.length > 0) {
        // Link these posts to this job
        const updateResult = await prisma.post.updateMany({
          where: {
            project_id: job.project_id,
            platform: job.scraper.platform,
            OR: [{ job_id: null }, { job_id: "" }],
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
        console.log(`  ⚠️  No posts found for this job`);
      }
    }

    // Show final summary
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

    const totalPosts = await prisma.post.count();
    const linkedPosts = await prisma.post.count({
      where: {
        job_id: { not: null },
        job_id: { not: "" },
      },
    });

    console.log(`\n📊 Final Summary:`);
    console.log(`  Total completed jobs: ${totalJobs}`);
    console.log(`  Jobs with posts_count > 0: ${jobsWithPosts}`);
    console.log(`  Jobs with posts_count = 0: ${totalJobs - jobsWithPosts}`);
    console.log(`  Total posts in database: ${totalPosts}`);
    console.log(`  Posts linked to jobs: ${linkedPosts}`);
    console.log(`  Posts without job_id: ${totalPosts - linkedPosts}`);

    // Show some examples of jobs with posts
    const jobsWithPostsData = await prisma.scrapeJob.findMany({
      where: {
        status: "COMPLETED",
        posts_count: { gt: 0 },
        deleted_at: null,
      },
      include: {
        scraper: true,
      },
      orderBy: { posts_count: "desc" },
      take: 5,
    });

    if (jobsWithPostsData.length > 0) {
      console.log(`\n📋 Top jobs by posts_count:`);
      jobsWithPostsData.forEach((job) => {
        console.log(`  ${job.scraper.name} (${job.scraper.platform}): ${job.posts_count} posts`);
      });
    }

    console.log("\n✅ Fix completed successfully!");
  } catch (error) {
    console.error("❌ Error during fix:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the fix
fixPostsCountCorrectly()
  .then(() => {
    console.log("🎉 Posts count fix completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Posts count fix failed:", error);
    process.exit(1);
  });
