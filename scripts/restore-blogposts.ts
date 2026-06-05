/**
 * Restore soft-deleted BlogPost records by setting deleted_at to null.
 * Use this if blog posts were accidentally deleted or need to be re-analyzed.
 */

import { prisma } from "../lib/prisma";

async function restoreBlogPosts(projectId?: string) {
  const where: any = { NOT: { deleted_at: null } };
  if (projectId) {
    where.project_id = projectId;
  }

  const count = await prisma.blogPost.count({ where });
  console.log(
    `Found ${count} soft-deleted BlogPost record(s)${projectId ? ` for project ${projectId}` : ""}`
  );

  if (count === 0) {
    console.log("No soft-deleted BlogPost records to restore.");
    return;
  }

  const result = await prisma.blogPost.updateMany({
    where,
    data: { deleted_at: null },
  });

  console.log(`✅ Restored ${result.count} BlogPost record(s) (set deleted_at to null)`);
}

const projectId = process.argv[2];
restoreBlogPosts(projectId)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
