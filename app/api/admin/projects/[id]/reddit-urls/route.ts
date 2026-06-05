import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userIsAdmin = await isAdmin(session.user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id: projectId } = await params;

    // Fetch Reddit URLs from project profiles
    const redditProfiles = await prisma.projectProfile.findMany({
      where: {
        project_id: projectId,
        platform: "reddit",
        is_selected: true,
        deleted_at: null,
      },
      select: {
        url: true,
        name: true,
      },
    });

    const urls = redditProfiles.map((profile) => profile.url);

    return NextResponse.json({
      urls,
      count: urls.length,
      profiles: redditProfiles,
    });
  } catch (error) {
    console.error("Error fetching Reddit URLs:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
