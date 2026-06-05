/**
 * Verification script to check that all orchestrations have sources correctly configured
 * for a specific project (Test12).
 *
 * This script verifies:
 * - Project exists and has correct configuration
 * - All orchestrations that include the project
 * - For each scraper in each orchestration, verifies sources are available:
 *   - LinkedIn: ProjectProfile URLs + Brand Directory URLs
 *   - X/Twitter: ProjectProfile URLs + Brand Directory URLs
 *   - Reddit: ProjectSource + Brand Directory URLs
 *   - Facebook: ProjectProfile URLs + Brand Directory URLs
 *   - Discord: ProjectSource URLs
 */

import { prisma } from "../lib/prisma";
import { getBrandDirectoryUrlsForProject } from "../lib/brand-directory/project-brand-urls-service";
import { getEffectiveSourcesForBrand } from "../lib/projects/project-brand-sources-service";

interface SourceVerificationResult {
  orchestrationId: string;
  orchestrationName: string;
  threadName: string;
  scraperName: string;
  platform: string;
  status: "OK" | "WARNING" | "ERROR";
  message: string;
  sourceCounts: {
    projectProfiles?: number;
    brandDirectory?: number;
    projectSources?: number;
    total?: number;
  };
}

async function fetchLinkedInUrlsFromProject(projectId: string): Promise<string[]> {
  const profiles = await prisma.projectProfile.findMany({
    where: {
      project_id: projectId,
      platform: "linkedin",
      is_selected: true,
      deleted_at: null,
    },
    select: { url: true },
  });
  return profiles.map((p) => p.url);
}

async function fetchXUrlsFromProject(projectId: string): Promise<string[]> {
  const profiles = await prisma.projectProfile.findMany({
    where: {
      project_id: projectId,
      platform: "x",
      is_selected: true,
      deleted_at: null,
    },
    select: { url: true },
  });
  return profiles.map((p) => p.url);
}

async function fetchRedditUrlsFromProject(projectId: string): Promise<string[]> {
  const profiles = await prisma.projectProfile.findMany({
    where: {
      project_id: projectId,
      platform: "reddit",
      is_selected: true,
      deleted_at: null,
    },
    select: { url: true, type: true },
  });
  // Only return URLs for Reddit users (person type), not subreddits (channel type)
  return profiles
    .filter((profile) => profile.type === "person" || profile.url.includes("/user/"))
    .map((profile) => profile.url);
}

async function fetchDiscordUrlsFromProject(projectId: string): Promise<string[]> {
  const profiles = await prisma.projectProfile.findMany({
    where: {
      project_id: projectId,
      platform: "discord",
      is_selected: true,
      deleted_at: null,
    },
    select: { url: true },
  });
  return profiles.map((p) => p.url);
}

async function fetchFacebookUrlsFromProject(projectId: string): Promise<string[]> {
  const profiles = await prisma.projectProfile.findMany({
    where: {
      project_id: projectId,
      platform: "facebook",
      is_selected: true,
      deleted_at: null,
    },
    select: { url: true },
  });
  return profiles.map((p) => p.url);
}

async function verifyOrchestrationSources(
  projectId: string,
  projectName: string
): Promise<SourceVerificationResult[]> {
  const results: SourceVerificationResult[] = [];

  console.log(`\n🔍 Verifying sources for project: ${projectName} (${projectId})\n`);

  // Get all orchestrations
  const orchestrations = await prisma.orchestration.findMany({
    where: { deleted_at: null },
    select: {
      id: true,
      name: true,
      project_ids: true,
      threads: true,
    },
  });

  // Filter orchestrations that include this project
  const relevantOrchestrations = orchestrations.filter((orch) => {
    if (!orch.project_ids) return false;
    try {
      const projectIds = JSON.parse(orch.project_ids);
      return Array.isArray(projectIds) && projectIds.includes(projectId);
    } catch {
      return false;
    }
  });

  console.log(
    `Found ${relevantOrchestrations.length} orchestration(s) that include project "${projectName}":`
  );
  relevantOrchestrations.forEach((orch) => console.log(`  - ${orch.name}`));

  if (relevantOrchestrations.length === 0) {
    console.log(`\n⚠️  No orchestrations found for project "${projectName}"`);
    return results;
  }

  // Get brand directory URLs once for the project
  const brandDirectoryUrls = await getBrandDirectoryUrlsForProject(projectId);

  // Get project brands for brand source verification
  const projectBrands = await prisma.projectBrand.findMany({
    where: {
      project_id: projectId,
      brand_id: { not: null },
      deleted_at: null,
    },
    select: { brand_id: true },
  });

  const brandIds = projectBrands.map((pb) => pb.brand_id).filter((id): id is string => id !== null);

  // Verify each orchestration
  for (const orchestration of relevantOrchestrations) {
    console.log(`\n📋 Checking orchestration: ${orchestration.name}`);

    if (!orchestration.threads) {
      console.log(`  ⚠️  No threads found`);
      continue;
    }

    let threads: any[];
    try {
      threads = JSON.parse(orchestration.threads);
    } catch {
      console.log(`  ⚠️  Invalid threads JSON`);
      continue;
    }

    for (const thread of threads) {
      const threadName = thread.name || "Unnamed Thread";
      console.log(`\n  🧵 Thread: ${threadName}`);

      if (!thread.steps || !Array.isArray(thread.steps)) {
        console.log(`    ⚠️  No steps found`);
        continue;
      }

      for (const step of thread.steps) {
        const scraperId = step.scraperId;
        const scraperName = step.scraperName || "Unknown Scraper";
        const platform = step.platform?.toLowerCase() || "unknown";

        console.log(`\n    🔧 Scraper: ${scraperName} (${platform})`);

        // Get scraper details
        const scraper = await prisma.scraper.findFirst({
          where: { id: scraperId, deleted_at: null },
        });

        if (!scraper) {
          results.push({
            orchestrationId: orchestration.id,
            orchestrationName: orchestration.name,
            threadName,
            scraperName,
            platform,
            status: "ERROR",
            message: `Scraper not found in database`,
            sourceCounts: {},
          });
          console.log(`      ❌ ERROR: Scraper not found`);
          continue;
        }

        // Check if scraper requires downstream sources (e.g., comments scrapers)
        const requiresDownstream =
          Boolean(scraper.url_input_field_name) && Boolean(scraper.url_input_source_scraper);

        if (requiresDownstream) {
          results.push({
            orchestrationId: orchestration.id,
            orchestrationName: orchestration.name,
            threadName,
            scraperName,
            platform,
            status: "OK",
            message: `Downstream-dependent scraper (uses ${scraper.url_input_source_scraper})`,
            sourceCounts: {},
          });
          console.log(
            `      ✅ Downstream-dependent scraper (source: ${scraper.url_input_source_scraper})`
          );
          continue;
        }

        // Verify sources based on platform
        let projectProfileUrls: string[] = [];
        let brandDirectoryPlatformUrls: string[] = [];
        let totalUrls = 0;

        switch (platform) {
          case "linkedin":
            projectProfileUrls = await fetchLinkedInUrlsFromProject(projectId);
            brandDirectoryPlatformUrls = brandDirectoryUrls.linkedinUrls;
            totalUrls = projectProfileUrls.length + brandDirectoryPlatformUrls.length;
            break;

          case "x":
          case "twitter":
            projectProfileUrls = await fetchXUrlsFromProject(projectId);
            brandDirectoryPlatformUrls = brandDirectoryUrls.twitterUrls;
            totalUrls = projectProfileUrls.length + brandDirectoryPlatformUrls.length;
            break;

          case "reddit":
            projectProfileUrls = await fetchRedditUrlsFromProject(projectId);
            brandDirectoryPlatformUrls = brandDirectoryUrls.redditUrls;
            // Also check brand sources for Reddit
            for (const brandId of brandIds) {
              const sources = await getEffectiveSourcesForBrand(projectId, brandId);
              const redditSources = sources.filter((s) => s.link_type === "REDDIT");
              brandDirectoryPlatformUrls.push(...redditSources.map((s) => s.url));
            }
            // Deduplicate
            brandDirectoryPlatformUrls = Array.from(new Set(brandDirectoryPlatformUrls));
            totalUrls = projectProfileUrls.length + brandDirectoryPlatformUrls.length;
            break;

          case "facebook":
            projectProfileUrls = await fetchFacebookUrlsFromProject(projectId);
            brandDirectoryPlatformUrls = brandDirectoryUrls.facebookUrls;
            totalUrls = projectProfileUrls.length + brandDirectoryPlatformUrls.length;
            break;

          case "discord":
            projectProfileUrls = await fetchDiscordUrlsFromProject(projectId);
            // Discord doesn't use brand directory URLs currently
            totalUrls = projectProfileUrls.length;
            break;

          default:
            console.log(`      ⚠️  Unknown platform: ${platform}`);
        }

        // Determine status
        let status: "OK" | "WARNING" | "ERROR" = "OK";
        let message = "";

        if (totalUrls === 0) {
          status = "ERROR";
          message = `No sources found for ${platform} scraper`;
        } else if (totalUrls < 3) {
          status = "WARNING";
          message = `Only ${totalUrls} source(s) found (recommended: 3+)`;
        } else {
          message = `${totalUrls} source(s) available`;
        }

        const result: SourceVerificationResult = {
          orchestrationId: orchestration.id,
          orchestrationName: orchestration.name,
          threadName,
          scraperName,
          platform,
          status,
          message,
          sourceCounts: {
            projectProfiles: projectProfileUrls.length,
            brandDirectory: brandDirectoryPlatformUrls.length,
            total: totalUrls,
          },
        };

        results.push(result);

        // Log result
        const statusIcon = status === "OK" ? "✅" : status === "WARNING" ? "⚠️" : "❌";
        console.log(`      ${statusIcon} ${message}`);
        if (
          platform === "linkedin" ||
          platform === "x" ||
          platform === "twitter" ||
          platform === "facebook" ||
          platform === "reddit" ||
          platform === "discord"
        ) {
          console.log(`         - Project Profiles: ${projectProfileUrls.length}`);
          if (platform !== "discord") {
            console.log(`         - Brand Directory: ${brandDirectoryPlatformUrls.length}`);
          }
        }
      }
    }
  }

  return results;
}

async function main() {
  try {
    // Find project "Test12"
    const project = await prisma.project.findFirst({
      where: {
        name: { contains: "Test12" },
        deleted_at: null,
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (!project) {
      console.error("❌ Project 'Test12' not found");
      process.exit(1);
    }

    console.log(`\n🎯 Found project: ${project.name} (${project.id})\n`);

    // Verify sources
    const results = await verifyOrchestrationSources(project.id, project.name);

    // Print summary
    console.log(`\n\n📊 SUMMARY\n${"=".repeat(60)}`);
    console.log(`Total scrapers checked: ${results.length}`);

    const okCount = results.filter((r) => r.status === "OK").length;
    const warningCount = results.filter((r) => r.status === "WARNING").length;
    const errorCount = results.filter((r) => r.status === "ERROR").length;

    console.log(`✅ OK: ${okCount}`);
    console.log(`⚠️  WARNINGS: ${warningCount}`);
    console.log(`❌ ERRORS: ${errorCount}`);

    if (errorCount > 0) {
      console.log(`\n❌ ERRORS FOUND:\n`);
      results
        .filter((r) => r.status === "ERROR")
        .forEach((r) => {
          console.log(
            `  - ${r.orchestrationName} > ${r.threadName} > ${r.scraperName} (${r.platform}): ${r.message}`
          );
        });
    }

    if (warningCount > 0) {
      console.log(`\n⚠️  WARNINGS:\n`);
      results
        .filter((r) => r.status === "WARNING")
        .forEach((r) => {
          console.log(
            `  - ${r.orchestrationName} > ${r.threadName} > ${r.scraperName} (${r.platform}): ${r.message}`
          );
        });
    }

    // Exit with error code if there are errors
    if (errorCount > 0) {
      console.log(`\n❌ Verification failed: ${errorCount} error(s) found`);
      process.exit(1);
    } else {
      console.log(`\n✅ Verification passed! All sources are configured correctly.`);
      process.exit(0);
    }
  } catch (error) {
    console.error("❌ Error during verification:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
main();
