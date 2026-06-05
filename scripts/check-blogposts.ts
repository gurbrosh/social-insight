import { prisma } from "../lib/prisma";

async function check() {
  const projectId = "01KEDS2SD1X3MVN76DV58CMNJD";

  const totalActive = await prisma.blogPost.count({ where: { deleted_at: null } });
  const totalDeleted = await prisma.blogPost.count({ where: { NOT: { deleted_at: null } } });
  const totalAll = await prisma.blogPost.count({});
  console.log(
    `Total BlogPost records: ${totalAll} (active: ${totalActive}, deleted: ${totalDeleted})`
  );

  const withProjectId = await prisma.blogPost.count({
    where: { project_id: projectId, deleted_at: null },
  });
  console.log(`BlogPost records with project_id=${projectId} (active): ${withProjectId}`);

  const allProjects = await prisma.blogPost.groupBy({
    by: ["project_id"],
    where: { deleted_at: null },
    _count: true,
  });
  console.log("\nBlogPost records by project_id (active):");
  for (const g of allProjects) {
    console.log(`  - ${g.project_id || "(null)"}: ${g._count}`);
  }

  const sample = await prisma.blogPost.findFirst({
    select: {
      id: true,
      project_id: true,
      article_url: true,
      created_at: true,
      deleted_at: true,
    },
  });
  console.log("\nSample BlogPost record (any):", JSON.stringify(sample, null, 2));

  const cursor = await prisma.analysisProgress.findUnique({
    where: { project_id: projectId },
    select: { last_blog_analysis_post_id: true },
  });
  console.log(`\nCursor for project ${projectId}:`, cursor?.last_blog_analysis_post_id || "none");

  process.exit(0);
}

check().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
