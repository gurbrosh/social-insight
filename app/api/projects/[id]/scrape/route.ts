import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apifyService } from "@/lib/apify-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: projectId } = await params;

    // Verify user owns the project
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        user_id: session.user.id,
        deleted_at: null,
      },
      include: {
        keywords: {
          where: { deleted_at: null },
        },
        brands: {
          where: { deleted_at: null },
        },
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Get active scrapers
    const scrapers = await prisma.scraper.findMany({
      where: {
        is_active: true,
        deleted_at: null,
      },
    });

    if (scrapers.length === 0) {
      return NextResponse.json({ error: "No active scrapers available" }, { status: 400 });
    }

    // Combine keywords + brand names into single array for scrapers
    // Scrapers treat both keywords and brands as keywords
    // Deduplicate to avoid sending duplicate search terms
    const allTerms = [
      ...project.keywords.map((k) => k.keyword),
      ...project.brands.map((b) => b.brand_name),
    ];
    const keywords = [...new Set(allTerms.map((t) => t.trim()).filter(Boolean))];

    // Start scraping jobs for each active scraper (handles array vs single-input + iteration)
    const jobIds: string[] = [];
    const errors: string[] = [];

    for (const scraper of scrapers) {
      try {
        const created = await apifyService.startScrapingJobsForScraper(
          projectId,
          scraper.id,
          keywords
        );
        jobIds.push(...created);
      } catch (error) {
        console.error(`Error starting scraper ${scraper.name}:`, error);
        errors.push(`${scraper.name}: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }

    if (jobIds.length === 0) {
      return NextResponse.json(
        { error: "Failed to start any scraping jobs", details: errors },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      jobIds,
      errors: errors.length > 0 ? errors : undefined,
      message: `Started ${jobIds.length} scraping job(s)`,
    });
  } catch (error) {
    console.error("Error starting scrape:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
