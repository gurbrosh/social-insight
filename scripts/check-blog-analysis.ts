/**
 * Diagnostic script to check why BlogNewsAnalysis records weren't created.
 * Checks: BlogPost records, analysis cursor, task execution status.
 */

import { prisma } from "../lib/prisma";

async function checkBlogAnalysis(projectId?: string) {
  console.log("=== BLOG ANALYSIS DIAGNOSTIC ===\n");

  // Get project(s)
  const projects = projectId
    ? await prisma.project.findMany({ where: { id: projectId, deleted_at: null } })
    : await prisma.project.findMany({ where: { deleted_at: null }, take: 5 });

  if (projects.length === 0) {
    console.log("❌ No projects found");
    return;
  }

  for (const project of projects) {
    console.log(`\n📁 Project: ${project.name} (${project.id})`);
    console.log("─".repeat(60));

    // Check BlogPost records
    const blogPosts = await prisma.blogPost.findMany({
      where: { project_id: project.id, deleted_at: null },
      orderBy: { created_at: "desc" },
      take: 5,
      select: {
        id: true,
        article_title: true,
        article_url: true,
        created_at: true,
      },
    });
    const totalBlogPosts = await prisma.blogPost.count({
      where: { project_id: project.id, deleted_at: null },
    });
    console.log(`\n📝 BlogPost records: ${totalBlogPosts} total`);

    // Check if project has blog URLs configured (needed for Brand Blog Posts task)
    const projectBrands = await prisma.projectBrand.findMany({
      where: { project_id: project.id, deleted_at: null },
      select: { brand_id: true },
    });
    const brandIds = projectBrands
      .map((pb) => pb.brand_id)
      .filter((id): id is string => id != null);
    const brandsWithBlogUrl =
      brandIds.length > 0
        ? await prisma.brand.findMany({
            where: {
              id: { in: brandIds },
              blog_news_url: { not: null },
              deleted_at: null,
            },
            select: { id: true, brand_name: true, blog_news_url: true },
            take: 5,
          })
        : [];
    console.log(`\n🔗 Blog URLs configured:`);
    console.log(`   - Brands with blog_news_url: ${brandsWithBlogUrl.length}`);
    if (brandsWithBlogUrl.length > 0) {
      for (const b of brandsWithBlogUrl) {
        console.log(`     • ${b.brand_name}: ${b.blog_news_url}`);
      }
    } else {
      console.log(`   ⚠️  No brands with blog_news_url found`);
      console.log(`   💡 Brand Blog Posts task needs blog URLs to create BlogPost records`);
      console.log(`   💡 Configure blog URLs in Brand settings or BrandAdditionalLink`);
    }
    if (blogPosts.length > 0) {
      console.log("   Recent posts:");
      for (const post of blogPosts) {
        const title = (post.article_title ?? "No title").slice(0, 50);
        console.log(`   - ${title}... (${post.id.slice(0, 8)}...)`);
      }
    } else {
      console.log("   ⚠️  No BlogPost records found - task may not have created any");
    }

    // Check analysis cursor
    const progress = await prisma.analysisProgress.findUnique({
      where: { project_id: project.id },
      select: { last_blog_analysis_post_id: true },
    });
    const cursor = progress?.last_blog_analysis_post_id;
    console.log(
      `\n📍 Analysis cursor: ${cursor ? cursor.slice(0, 8) + "..." : "none (start from beginning)"}`
    );

    // Check BlogNewsAnalysis records
    const analyses = await prisma.blogNewsAnalysis.findMany({
      where: { project_id: project.id, deleted_at: null },
      orderBy: { created_at: "desc" },
      take: 5,
      select: {
        id: true,
        article_title: true,
        article_url: true,
        created_at: true,
      },
    });
    const totalAnalyses = await prisma.blogNewsAnalysis.count({
      where: { project_id: project.id, deleted_at: null },
    });
    console.log(`\n🔬 BlogNewsAnalysis records: ${totalAnalyses} total`);
    if (analyses.length > 0) {
      console.log("   Recent analyses:");
      for (const a of analyses) {
        const title = (a.article_title ?? "No title").slice(0, 50);
        console.log(`   - ${title}... (${a.id.slice(0, 8)}...)`);
      }
    } else {
      console.log("   ⚠️  No BlogNewsAnalysis records found");
    }

    // Check recent orchestration executions (simplified - can't filter by project_ids JSON easily)
    const recentExecutions = await prisma.orchestrationExecution.findMany({
      orderBy: { started_at: "desc" },
      take: 5,
      select: {
        id: true,
        status: true,
        started_at: true,
        completed_at: true,
        orchestration: {
          select: { name: true, project_ids: true },
        },
      },
    });
    const projectExecutions = recentExecutions.filter((e) => {
      try {
        const pids =
          typeof e.orchestration.project_ids === "string"
            ? JSON.parse(e.orchestration.project_ids)
            : e.orchestration.project_ids;
        return Array.isArray(pids) && pids.includes(project.id);
      } catch {
        return false;
      }
    });
    console.log(
      `\n🚀 Recent orchestration executions for this project: ${projectExecutions.length}`
    );
    for (const exec of projectExecutions) {
      const status = exec.status;
      const started = exec.started_at?.toISOString().slice(0, 19).replace("T", " ");
      const completed = exec.completed_at?.toISOString().slice(0, 19).replace("T", " ");
      console.log(
        `   - ${exec.orchestration.name}: ${status} (started: ${started}${completed ? `, completed: ${completed}` : ""})`
      );
    }

    // Check recent TaskRun records for Brand Blog Posts task
    const brandBlogTask = await prisma.searchSourceTask.findFirst({
      where: { name: "Brand Blog Posts", deleted_at: null },
      select: { id: true },
    });
    if (brandBlogTask) {
      const taskRuns = await prisma.taskRun.findMany({
        where: {
          task_id: brandBlogTask.id,
          project_id: project.id,
        },
        orderBy: { created_at: "desc" },
        take: 3,
        select: {
          id: true,
          status: true,
          created_at: true,
          completed_at: true,
          error_message: true,
        },
      });
      console.log(`\n📋 Brand Blog Posts task runs: ${taskRuns.length}`);
      for (const run of taskRuns) {
        const status = run.status;
        const created = run.created_at.toISOString().slice(0, 19).replace("T", " ");
        const completed = run.completed_at?.toISOString().slice(0, 19).replace("T", " ");
        const error = run.error_message ? ` (error: ${run.error_message.slice(0, 50)}...)` : "";
        console.log(
          `   - ${status} (created: ${created}${completed ? `, completed: ${completed}` : ""}${error})`
        );
      }
    } else {
      console.log(`\n⚠️  Brand Blog Posts task not found in database`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("\n💡 Next steps:");
  console.log("   1. Check server logs for '[BlogPostTableAnalysis]' messages");
  console.log("   2. Check server logs for '[Orchestration] Blog post table analysis' messages");
  console.log("   3. If BlogPost records exist but no analyses:");
  console.log("      - Check OPENAI_API_KEY is set");
  console.log("      - Check cursor isn't past all posts");
  console.log("   4. If no BlogPost records:");
  console.log("      - Check BrandAdditionalLink records exist for project");
  console.log("      - Check task execution logs for errors");
}

const projectId = process.argv[2];
checkBlogAnalysis(projectId)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
