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

    const isUserAdmin = await isAdmin(session.user.id);
    if (!isUserAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id: projectId } = await params;

    // Fetch X (Twitter) profiles from the project
    const xProfiles = await prisma.projectProfile.findMany({
      where: {
        project_id: projectId,
        platform: "x",
        is_selected: true,
        deleted_at: null,
      },
      select: {
        url: true,
        name: true,
        type: true,
      },
    });

    // Extract URLs from the profiles
    const urls = xProfiles.map((profile) => profile.url);

    return NextResponse.json({
      urls,
      profiles: xProfiles,
      count: urls.length,
    });
  } catch (error) {
    console.error("Error fetching X URLs:", error);
    return NextResponse.json({ error: "Failed to fetch X URLs" }, { status: 500 });
  }
}
