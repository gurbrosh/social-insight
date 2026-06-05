import { prisma } from "../lib/prisma";

async function checkProjectThresholds() {
  try {
    const project = await prisma.project.findFirst({
      where: {
        name: {
          contains: "Vibe",
        },
        deleted_at: null,
      },
      select: {
        id: true,
        name: true,
        linkedin_engagement_threshold: true,
        facebook_engagement_threshold: true,
        twitter_engagement_threshold: true,
      },
    });

    if (!project) {
      console.log("Project 'Vibe Coding' not found");
      return;
    }

    console.log("\n=== Project: " + project.name + " ===\n");
    console.log(
      "LinkedIn Threshold:",
      project.linkedin_engagement_threshold ?? "null (default: 0)"
    );
    console.log(
      "Facebook Threshold:",
      project.facebook_engagement_threshold ?? "null (default: 0)"
    );
    console.log("Twitter Threshold:", project.twitter_engagement_threshold ?? "null (default: 0)");
    console.log("\n");
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

checkProjectThresholds();
