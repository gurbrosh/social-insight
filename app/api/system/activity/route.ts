import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { getSystemActivity } from "@/lib/system-activity";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    let session;
    try {
      session = await auth();
    } catch (error) {
      console.error("Error in auth() call:", error);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId") ?? undefined;

    let userIsAdmin = false;
    try {
      userIsAdmin = await isAdmin(session.user.id);
    } catch (error) {
      console.error("Error checking admin status:", error);
      // Continue with non-admin permissions if check fails
      userIsAdmin = false;
    }

    if (projectId) {
      let project;
      try {
        project = await prisma.project.findFirst({
          where: {
            id: projectId,
            deleted_at: null,
          },
          select: {
            user_id: true,
          },
        });
      } catch (error) {
        console.error("Error fetching project:", error);
        return NextResponse.json({ error: "Failed to fetch project" }, { status: 500 });
      }

      if (!project) {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
      }

      if (!userIsAdmin && project.user_id !== session.user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } else if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const activity = await getSystemActivity({ projectId });
    return NextResponse.json(
      { activity },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
          Pragma: "no-cache",
        },
      }
    );
  } catch (error) {
    console.error("Error fetching system activity:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to fetch activity status";
    console.error("Full error details:", {
      message: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined,
    });

    // IMPORTANT: Never hard-fail this endpoint; the admin UI should remain usable
    // even if system-activity introspection breaks. Fall back to an "empty" activity
    // payload instead of returning 500.
    return NextResponse.json(
      {
        activity: {
          orchestration: null,
          analysis: null,
          taskAnalysis: null,
        },
        error: errorMessage,
      },
      { status: 200 }
    );
  }
}
