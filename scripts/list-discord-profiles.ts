#!/usr/bin/env tsx

import { prisma } from "../lib/prisma";

async function main() {
  const projectId = "01K5ZN4CAGXGM9D1HART3Q0A8A";

  console.log(`Listing Discord channel profiles for project ${projectId}...\n`);

  const profiles = await prisma.projectProfile.findMany({
    where: {
      project_id: projectId,
      platform: "discord",
      type: "channel",
      is_selected: true,
      deleted_at: null,
    },
    select: {
      id: true,
      name: true,
      url: true,
    },
    orderBy: {
      id: "asc",
    },
  });

  profiles.forEach((p, idx) => {
    console.log(`Channel ${idx + 1}: id=${p.id}, name=${p.name || "(no name)"}, url=${p.url}`);
  });

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("Error listing Discord profiles:", error);
  process.exit(1);
});
