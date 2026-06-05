/**
 * Permanently delete all blog-related records and reset the blog analysis cursor so the next run starts fresh.
 * Deletes: BlogNewsAnalysis, BlogAnalysisRun, BlogPost, blog-sourced PostNews, all ThemesAnalysis
 * (platform blog/blogs), Post (platform=blogs), and dependent BrandAnalysis; resets last_blog_analysis_post_id.
 *
 * Usage:
 *   npx tsx scripts/clean-blog-posts.ts [--project-id <projectId>]
 *
 * Without --project-id: deletes all such rows and resets blog cursor for all projects.
 * With --project-id: deletes only that project's rows and resets cursor for that project.
 */

import { prisma } from "../lib/prisma";

async function main() {
  const projectIdArg = process.argv.indexOf("--project-id");
  const projectId =
    projectIdArg !== -1 && process.argv[projectIdArg + 1]
      ? process.argv[projectIdArg + 1]
      : undefined;

  const where = projectId ? { project_id: projectId } : {};

  // 1. Hard-delete BlogNewsAnalysis first (they reference BlogAnalysisRun optionally)
  const analysisCount = await prisma.blogNewsAnalysis.count({ where });
  if (analysisCount === 0) {
    console.log("No BlogNewsAnalysis records to delete.");
  } else {
    await prisma.blogNewsAnalysis.deleteMany({ where });
    console.log(
      `Deleted ${analysisCount} BlogNewsAnalysis record(s) permanently${projectId ? ` for project ${projectId}` : ""}.`
    );
  }

  // 2. Hard-delete BlogAnalysisRun (run metadata) so next run has no stale counters
  const runCount = await prisma.blogAnalysisRun.count({ where });
  if (runCount === 0) {
    console.log("No BlogAnalysisRun records to delete.");
  } else {
    await prisma.blogAnalysisRun.deleteMany({ where });
    console.log(
      `Deleted ${runCount} BlogAnalysisRun record(s) permanently${projectId ? ` for project ${projectId}` : ""}.`
    );
  }

  // 3. Hard-delete BlogPost (raw scraped content)
  const postCount = await prisma.blogPost.count({ where });
  if (postCount === 0) {
    console.log("No BlogPost records to delete.");
  } else {
    await prisma.blogPost.deleteMany({ where });
    console.log(
      `Deleted ${postCount} BlogPost record(s) permanently${projectId ? ` for project ${projectId}` : ""}.`
    );
  }

  // 4. Delete blog items from the News section (PostNews where sources includes "blog")
  const newsWhere = {
    ...(projectId ? { project_id: projectId } : {}),
    sources: { contains: '"blog"' },
  };
  const newsCount = await prisma.postNews.count({ where: newsWhere });
  if (newsCount === 0) {
    console.log("No blog-sourced PostNews records to delete.");
  } else {
    await prisma.postNews.deleteMany({ where: newsWhere });
    console.log(
      `Deleted ${newsCount} PostNews (blog) record(s) from News section${projectId ? ` for project ${projectId}` : ""}.`
    );
  }

  // 5. Delete ALL blog-related ThemesAnalysis first (before deleting Posts).
  //    Blog pipeline creates rows with platform "blog" and post_id 0; comprehensive analysis
  //    creates rows with platform "blogs" tied to Post ids. Remove all so Themes filtered by Blog are empty.
  const themesBlogWhere = {
    ...(projectId ? { project_id: projectId } : {}),
    OR: [{ platform: "blog" }, { platform: "blogs" }],
  };
  const themesBlogCount = await prisma.themesAnalysis.count({ where: themesBlogWhere });
  if (themesBlogCount > 0) {
    await prisma.themesAnalysis.deleteMany({ where: themesBlogWhere });
    console.log(
      `Deleted ${themesBlogCount} ThemesAnalysis (blog/blogs) record(s)${projectId ? ` for project ${projectId}` : ""}.`
    );
  } else {
    console.log("No ThemesAnalysis (blog/blogs) records to delete.");
  }

  // 6. Delete Post records with platform = 'blogs' (created from blog analysis).
  //    First delete dependent BrandAnalysis that reference these posts.
  const blogPostWhere = {
    ...(projectId ? { project_id: projectId } : {}),
    platform: "blogs",
  };
  const blogPosts = await prisma.post.findMany({
    where: blogPostWhere,
    select: { id: true },
  });
  const blogPostIds = blogPosts.map((p) => p.id);
  const blogPostRecords = blogPostIds.length;

  if (blogPostRecords === 0) {
    console.log("No Post (blogs) records to delete.");
  } else {
    const brandWhere = { post_id: { in: blogPostIds } };
    const brandCount = await prisma.brandAnalysis.count({ where: brandWhere });
    if (brandCount > 0) {
      await prisma.brandAnalysis.deleteMany({ where: brandWhere });
      console.log(
        `Deleted ${brandCount} BrandAnalysis record(s) referencing blog Post(s)${projectId ? ` for project ${projectId}` : ""}.`
      );
    }

    await prisma.post.deleteMany({ where: blogPostWhere });
    console.log(
      `Deleted ${blogPostRecords} Post (platform=blogs) record(s)${projectId ? ` for project ${projectId}` : ""}.`
    );
  }

  // 7. Reset blog analysis cursor
  try {
    const cursorWhere = projectId ? { project_id: projectId } : {};
    const updated = await prisma.analysisProgress.updateMany({
      where: cursorWhere,
      data: { last_blog_analysis_post_id: null },
    });
    console.log(`Reset blog analysis cursor for ${updated.count} project(s).`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("last_blog_analysis_post_id") && msg.includes("does not exist")) {
      console.log("Blog cursor column not in DB yet (run migrations); skipping cursor reset.");
    } else {
      throw e;
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
