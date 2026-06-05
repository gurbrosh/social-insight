import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type ScraperLike = {
  name: string;
  platform: string;
  config_json: string | null;
};

type ScraperWithDescriptive = ScraperLike & {
  descriptive_name?: string | null;
};

function readDescriptiveName(scraper: ScraperLike): string | undefined {
  if (typeof scraper === "object" && scraper !== null && "descriptive_name" in scraper) {
    const value = (scraper as ScraperWithDescriptive).descriptive_name;
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function resolveExternalScraperName(scraper: ScraperLike) {
  const configJson = scraper.config_json;

  if (configJson) {
    try {
      const parsed = JSON.parse(configJson);
      const candidates = [
        parsed.externalName,
        parsed.external_name,
        parsed.displayName,
        parsed.display_name,
        parsed.name,
        parsed.title,
        parsed.label,
        parsed.metadata?.externalName,
        parsed.metadata?.displayName,
      ];

      const candidate = candidates.find(
        (value: unknown): value is string => typeof value === "string" && value.trim().length > 0
      );

      if (candidate) {
        return candidate.trim();
      }
    } catch (error) {
      console.warn("Failed to parse scraper config for external name:", error);
    }
  }

  // Fallback: transform internal name into a friendlier label
  return (
    scraper.name
      .replace(/\s*Scraper$/i, "")
      .replace(/\s*\(.*?\)/g, "")
      .replace(/_/g, " ")
      .trim() || `${scraper.platform.toUpperCase()} Scraper`
  );
}

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: projectId } = await params;
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "5");

    // Verify user owns the project
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        user_id: session.user.id,
        deleted_at: null,
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Get total count for pagination
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const totalJobs = await prisma.scrapeJob.count({
      where: {
        project_id: projectId,
        deleted_at: null,
      },
    });

    // Fetch jobs to ensure scraper diversity
    const allJobs = await prisma.scrapeJob.findMany({
      where: {
        project_id: projectId,
        deleted_at: null,
      },
      include: {
        scraper: true,
      },
      orderBy: { created_at: "desc" },
      take: 100, // Fetch enough to ensure diversity
    });

    // Smart diversity: Pick jobs while avoiding consecutive duplicates
    // This maintains recency while ensuring scraper variety
    const diverseJobs: typeof allJobs = [];
    const recentScrapers: string[] = []; // Track last 3 scrapers shown
    const maxRecentTracking = 3;

    for (const job of allJobs) {
      const scraperDescriptiveName = readDescriptiveName(job.scraper as ScraperWithDescriptive);
      const scraperName = scraperDescriptiveName ?? resolveExternalScraperName(job.scraper);

      // If we haven't shown this scraper in the last 3 positions, include it
      if (!recentScrapers.includes(scraperName)) {
        diverseJobs.push(job);

        // Track this scraper
        recentScrapers.push(scraperName);
        if (recentScrapers.length > maxRecentTracking) {
          recentScrapers.shift(); // Remove oldest from tracking
        }

        // Stop when we have enough diverse jobs
        if (diverseJobs.length >= 50) break;
      }
    }

    const sortedJobs = diverseJobs;

    // Apply pagination
    const skip = (page - 1) * limit;
    const paginatedJobs = sortedJobs.slice(skip, skip + limit);
    const totalPages = Math.ceil(sortedJobs.length / limit);

    return NextResponse.json({
      jobs: paginatedJobs.map((job) => ({
        id: job.id,
        status: job.status,
        created_at: job.created_at,
        posts_count: job.posts_count,
        scraper: {
          name: job.scraper.name,
          platform: job.scraper.platform,
          externalName:
            readDescriptiveName(job.scraper as ScraperWithDescriptive) ??
            resolveExternalScraperName(job.scraper),
        },
      })),
      pagination: {
        page,
        limit,
        totalJobs: sortedJobs.length, // Total diverse jobs available
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    console.error("Error fetching recent jobs:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
