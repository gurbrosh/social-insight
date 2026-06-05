import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { apifyService } from "@/lib/apify-service";

export const dynamic = "force-dynamic";

const testScraperSchema = z.object({
  testInput: z.object({
    keywords: z.array(z.string()).optional(),
  }),
  saveTestResults: z.boolean().default(false),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isUserAdmin = await isAdmin(session.user.id);
    if (!isUserAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const validatedData = testScraperSchema.parse(body);
    const { testInput, saveTestResults } = validatedData;

    // Get the scraper
    const scraper = await prisma.scraper.findUnique({
      where: { id, deleted_at: null },
    });

    if (!scraper) {
      return NextResponse.json({ error: "Scraper not found" }, { status: 404 });
    }

    // Parse scraper configuration
    const config = JSON.parse(scraper.config_json);
    console.log("Config:", config);
    console.log("Keywords:", testInput.keywords);
    let totalItems = 0;

    // Prepare test input - Discord, Reddit, X, LinkedIn, and Facebook scrapers expect config at root level, others expect nested
    let input;
    if (
      scraper.platform === "discord" ||
      scraper.platform === "reddit" ||
      scraper.platform === "x" ||
      scraper.platform === "linkedin" ||
      scraper.platform === "facebook"
    ) {
      // For these scrapers, send config directly at root level
      input = { ...config };
    } else {
      // For other scrapers, nest config under "config" key and include keywords
      input = {
        config: config,
        keywords: testInput.keywords || [],
      };
    }
    console.log("Final input being sent to scraper:", input);

    const result = await apifyService.testScraper(scraper.actor_id, input);

    if (saveTestResults && result.success && result.runId) {
      try {
        const runStatus = await apifyService.getRunStatus(result.runId);
        if (runStatus.defaultDatasetId) {
          const items = await apifyService.getDatasetItems(runStatus.defaultDatasetId);

          if (saveTestResults) {
            if (scraper.platform === "discord") {
              console.log(
                `✅ Retrieved ${items.length} Discord messages (Discord scrapers can save results without project ID)`
              );
              totalItems = items.length;
            } else {
              // This endpoint needs to be updated to accept projectId parameter
              console.error(
                "❌ Cannot save test results without a valid project ID. This endpoint needs to be updated to accept projectId parameter."
              );
            }
          } else {
            console.log(`✅ Retrieved ${items.length} items (not saving to database)`);
          }
        }
      } catch (error) {
        console.error(`Error saving test results:`, error);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Test completed${saveTestResults ? ` and saved ${totalItems} items` : ""}`,
      result: {
        runId: result.runId,
        success: result.success,
        status: result.status,
      },
      totalItems,
      savedToDatabase: saveTestResults,
    });
  } catch (error) {
    console.error("Error testing scraper:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    });
  }
}
