import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { apifyService } from "@/lib/apify-service";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isUserAdmin = await isAdmin(session.user.id);
    if (!isUserAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const runIds = [
      "ZgkUZERQI8Iw6463p", // cursor
      "a3F7KTZbAT0HlAHeV", // lovable
      "gXeP8opvcnTwthUKj", // bolt
    ];

    console.log("Fetching results from completed runs...");
    const totalSaved = 0;

    for (const runId of runIds) {
      try {
        console.log(`\nChecking run ${runId}...`);
        const runStatus = await apifyService.getRunStatus(runId);
        console.log(`Status: ${runStatus.status}`);

        if (runStatus.defaultDatasetId) {
          console.log(`Fetching dataset items...`);
          const items = await apifyService.getDatasetItems(runStatus.defaultDatasetId);
          console.log(`Retrieved ${items.length} items`);

          if (items.length > 0) {
            // This endpoint is for manual data recovery - we need a real project ID
            console.error(
              "❌ Cannot save items without a valid project ID. This endpoint needs to be updated to accept projectId parameter."
            );
            continue;
          }
        } else {
          console.log(`❌ No dataset available - Status: ${runStatus.status}`);
        }
      } catch (error) {
        console.error(`❌ Error processing run ${runId}:`, error);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Fetched and saved ${totalSaved} test items from completed runs`,
      totalSaved,
    });
  } catch (error) {
    console.error("Error fetching completed results:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      },
      { status: 500 }
    );
  }
}
