import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apifyService } from "@/lib/apify-service";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; jobId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: projectId, jobId } = await params;

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
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Get the job to retry
    const job = await prisma.scrapeJob.findFirst({
      where: {
        id: jobId,
        project_id: projectId,
        deleted_at: null,
      },
      include: {
        scraper: true,
      },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.status === "RUNNING") {
      return NextResponse.json({ error: "Cannot retry a running job" }, { status: 400 });
    }

    // Create a new job based on the failed job
    const keywords = project.keywords.map((k) => k.keyword);

    try {
      const newJobId = await apifyService.startScrapingJob(projectId, job.scraper_id, keywords);

      return NextResponse.json({
        success: true,
        jobId: newJobId,
        message: "Job retried successfully",
      });
    } catch (error) {
      console.error("Error retrying job:", error);
      return NextResponse.json({ error: "Failed to retry job" }, { status: 500 });
    }
  } catch (error) {
    console.error("Error in retry endpoint:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
