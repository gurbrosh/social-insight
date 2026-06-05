#!/usr/bin/env tsx

/**
 * Export all profile URLs for a project to a text file
 *
 * Usage:
 *   npx tsx scripts/export-project-profiles.ts "Vibe Coding"
 */

import { prisma } from "../lib/prisma";
import * as fs from "fs";
import * as path from "path";

async function exportProjectProfiles(projectName: string) {
  // Find the project
  const project = await (prisma as any).project.findFirst({
    where: {
      name: { contains: projectName },
      deleted_at: null,
    },
    include: {
      profiles: {
        where: { deleted_at: null },
        orderBy: [{ platform: "asc" }, { name: "asc" }],
      },
    },
  });

  if (!project) {
    console.error(`❌ Project "${projectName}" not found`);
    process.exit(1);
  }

  console.log(`📦 Found project: ${project.name} (ID: ${project.id})`);
  console.log(`   Total profiles: ${project.profiles.length}\n`);

  // Group profiles by platform
  const profilesByPlatform: Record<string, Array<{ name: string; url: string; type: string }>> = {};

  project.profiles.forEach((profile: any) => {
    if (!profilesByPlatform[profile.platform]) {
      profilesByPlatform[profile.platform] = [];
    }
    profilesByPlatform[profile.platform].push({
      name: profile.name,
      url: profile.url,
      type: profile.type,
    });
  });

  // Generate text file content
  const lines: string[] = [];
  lines.push("=".repeat(80));
  lines.push(`PROJECT: ${project.name}`);
  lines.push(`EXPORT DATE: ${new Date().toISOString()}`);
  lines.push(`TOTAL PROFILES: ${project.profiles.length}`);
  lines.push("=".repeat(80));
  lines.push("");

  // Sort platforms alphabetically
  const platforms = Object.keys(profilesByPlatform).sort();

  for (const platform of platforms) {
    const profiles = profilesByPlatform[platform];
    const platformDisplay = platform.charAt(0).toUpperCase() + platform.slice(1);

    lines.push(
      `${platformDisplay.toUpperCase()} (${profiles.length} profile${profiles.length !== 1 ? "s" : ""})`
    );
    lines.push("-".repeat(80));

    for (const profile of profiles) {
      lines.push(`  [${profile.type.toUpperCase()}] ${profile.name}`);
      lines.push(`  ${profile.url}`);
      lines.push("");
    }

    lines.push("");
  }

  // Summary
  lines.push("=".repeat(80));
  lines.push("SUMMARY BY PLATFORM:");
  platforms.forEach((platform) => {
    const count = profilesByPlatform[platform].length;
    const platformDisplay = platform.charAt(0).toUpperCase() + platform.slice(1);
    lines.push(`  ${platformDisplay}: ${count} profile${count !== 1 ? "s" : ""}`);
  });
  lines.push("=".repeat(80));

  // Write to file
  const filename = `vibe-coding-profiles-backup-${new Date().toISOString().split("T")[0]}.txt`;
  const filepath = path.join(process.cwd(), filename);

  fs.writeFileSync(filepath, lines.join("\n"), "utf-8");

  console.log(`✅ Exported ${project.profiles.length} profiles to: ${filename}`);
  console.log(`   File location: ${filepath}\n`);

  // Print summary
  console.log("Summary by platform:");
  platforms.forEach((platform) => {
    const count = profilesByPlatform[platform].length;
    const platformDisplay = platform.charAt(0).toUpperCase() + platform.slice(1);
    console.log(`  ${platformDisplay}: ${count} profile${count !== 1 ? "s" : ""}`);
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("❌ Error: Please provide a project name");
    console.error('   Usage: npx tsx scripts/export-project-profiles.ts "Vibe Coding"');
    process.exit(1);
  }

  const projectName = args[0];

  try {
    await exportProjectProfiles(projectName);
  } catch (error: any) {
    console.error("\n❌ Fatal error:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
