import { prisma } from "../lib/prisma";

async function check() {
  const projectId = "01KEDS2SD1X3MVN76DV58CMNJD";
  const deletionTime = new Date("2026-02-17T04:53:26.884Z");

  // Check for BlogPost records created AFTER the deletion time
  const newRecords = await prisma.blogPost.findMany({
    where: {
      project_id: projectId,
      created_at: { gt: deletionTime },
      deleted_at: null,
    },
    orderBy: { created_at: "desc" },
    take: 10,
    select: {
      id: true,
      article_url: true,
      created_at: true,
      deleted_at: true,
    },
  });

  console.log("BlogPost records created AFTER deletion time (2026-02-17T04:53:26.884Z):");
  console.log("Count:", newRecords.length);
  if (newRecords.length > 0) {
    console.log("Sample records:");
    newRecords.forEach((r, i) => {
      const pacificTime = r.created_at.toLocaleString("en-US", {
        timeZone: "America/Los_Angeles",
        dateStyle: "full",
        timeStyle: "long",
      });
      console.log(
        `  ${i + 1}. Created: ${r.created_at.toISOString()} (${pacificTime}), URL: ${r.article_url?.slice(0, 60)}...`
      );
    });
  } else {
    console.log("No new BlogPost records found after deletion time.");
  }

  // Check all BlogPost records (including deleted) created after deletion
  const allAfterDeletion = await prisma.blogPost.findMany({
    where: {
      project_id: projectId,
      created_at: { gt: deletionTime },
    },
    orderBy: { created_at: "desc" },
    take: 5,
    select: {
      id: true,
      article_url: true,
      created_at: true,
      deleted_at: true,
    },
  });

  console.log("\nAll BlogPost records (including deleted) created after deletion:");
  console.log("Count:", allAfterDeletion.length);
  if (allAfterDeletion.length > 0) {
    allAfterDeletion.forEach((r, i) => {
      const pacificTime = r.created_at.toLocaleString("en-US", {
        timeZone: "America/Los_Angeles",
        dateStyle: "full",
        timeStyle: "long",
      });
      const status = r.deleted_at ? `DELETED at ${r.deleted_at.toISOString()}` : "ACTIVE";
      console.log(
        `  ${i + 1}. Created: ${r.created_at.toISOString()} (${pacificTime}), Status: ${status}`
      );
    });
  }

  // Check recent TaskRun records to see when the Brand Blog Posts task last ran
  const brandBlogTask = await prisma.searchSourceTask.findFirst({
    where: { name: "Brand Blog Posts", deleted_at: null },
    select: { id: true },
  });

  if (brandBlogTask) {
    const recentRuns = await prisma.taskRun.findMany({
      where: {
        task_id: brandBlogTask.id,
        project_id: projectId,
        created_at: { gt: deletionTime },
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

    console.log("\nRecent Brand Blog Posts task runs (after deletion time):");
    console.log("Count:", recentRuns.length);
    if (recentRuns.length > 0) {
      recentRuns.forEach((run, i) => {
        const pacificCreated = run.created_at.toLocaleString("en-US", {
          timeZone: "America/Los_Angeles",
          dateStyle: "full",
          timeStyle: "long",
        });
        const pacificCompleted = run.completed_at
          ? run.completed_at.toLocaleString("en-US", {
              timeZone: "America/Los_Angeles",
              dateStyle: "full",
              timeStyle: "long",
            })
          : "not completed";
        console.log(
          `  ${i + 1}. Status: ${run.status}, Created: ${pacificCreated}, Completed: ${pacificCompleted}`
        );
        if (run.error_message) {
          console.log(`     Error: ${run.error_message.slice(0, 100)}...`);
        }
      });
    } else {
      console.log("No task runs found after deletion time.");
    }
  }

  process.exit(0);
}

check().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
