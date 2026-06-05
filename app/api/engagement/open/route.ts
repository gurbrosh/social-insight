import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ulid as generateUlid } from "ulid";
import { normalizeThemeReadUrl } from "@/lib/theme-read-url";
import { applyThemesReadCascade } from "@/lib/themes-read-cascade";

export const dynamic = "force-dynamic";

/**
 * `dest` may be long (e.g. Reddit URLs with Unicode in the path) and can be truncated by clients
 * or proxies, leaving incomplete `%` escapes — `decodeURIComponent` then throws URIError.
 */
function safeDecodeDestParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * GET /api/engagement/open
 * Query: projectId, source (themes|chatter), sourceId, postId?, platform, dest (encoded URL)
 * Logs an EngagementSession+clicked event, then redirects (302) to dest URL.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.redirect(new URL("/auth/signin", request.url));
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const source = searchParams.get("source");
    const sourceId = searchParams.get("sourceId");
    const postIdParam = searchParams.get("postId");
    const platform = searchParams.get("platform");
    const dest = searchParams.get("dest");
    const identityId = searchParams.get("identityId"); // Optional: selected identity ID

    if (!projectId || !source || !sourceId || !platform || !dest) {
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 });
    }

    // If identityId is provided, verify it belongs to the user and matches the platform
    let selectedIdentityId: string | null = null;
    if (identityId) {
      const identity = await prisma.userPlatformIdentity.findFirst({
        where: {
          id: identityId,
          user_id: session.user.id,
          platform: platform.toLowerCase(),
          deleted_at: null,
        },
      });
      if (!identity) {
        return NextResponse.json({ error: "Invalid identity selected" }, { status: 400 });
      }
      selectedIdentityId = identityId;
    }

    // Check if an active or watching session already exists for this user + source combination
    // This prevents duplicate sessions when clicking the same entry multiple times
    const existingSession = await prisma.engagementSession.findFirst({
      where: {
        project_id: projectId,
        source_type: source,
        source_record_id: sourceId,
        started_by_user_id: session.user.id,
        status: { in: ["active", "watching"] },
        deleted_at: null,
      },
      orderBy: { started_at: "desc" },
    });

    const now = new Date();
    const destDecoded = safeDecodeDestParam(dest);
    let engagementId: string;

    if (existingSession) {
      // Reuse existing session - just update it and add a new clicked event
      engagementId = existingSession.id;

      // Update session to active if it was watching, and update destination_url/identity if changed
      await prisma.$transaction([
        prisma.engagementSession.update({
          where: { id: engagementId },
          data: {
            status: "active", // Reactivate if it was watching
            destination_url: destDecoded,
            selected_identity_id: selectedIdentityId || existingSession.selected_identity_id,
            last_check_at: now,
          },
        }),
        prisma.engagementEvent.create({
          data: {
            id: generateUlid(),
            engagement_id: engagementId,
            type: "clicked",
            payload: null,
            occurred_at: now,
          },
        }),
      ]);
    } else {
      // Create new session and initial event
      engagementId = generateUlid();

      const createData: any = {
        id: engagementId,
        project_id: projectId,
        source_type: source,
        source_record_id: sourceId,
        post_id: postIdParam ? Number(postIdParam) : null,
        platform,
        destination_url: destDecoded,
        started_by_user_id: session.user.id,
        started_at: now,
        status: "active",
      };
      if (selectedIdentityId) {
        createData.selected_identity_id = selectedIdentityId;
      }

      await prisma.$transaction([
        prisma.engagementSession.create({
          data: createData,
        }),
        prisma.engagementEvent.create({
          data: {
            id: generateUlid(),
            engagement_id: engagementId,
            type: "clicked",
            payload: null,
            occurred_at: now,
          },
        }),
      ]);
    }

    if (source === "themes") {
      const project = await prisma.project.findFirst({
        where: {
          id: projectId,
          user_id: session.user.id,
          deleted_at: null,
        },
      });
      if (project) {
        const readUrlKey = normalizeThemeReadUrl(destDecoded);
        await applyThemesReadCascade(projectId, {
          read: true,
          readUrlKey: readUrlKey || null,
          fallbackMatchId: sourceId,
        });
      }
    }

    let redirectUrl: URL;
    try {
      redirectUrl = new URL(destDecoded);
    } catch {
      return NextResponse.json({ error: "Invalid or truncated destination URL" }, { status: 400 });
    }
    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    console.error("Error in engagement open:", error);
    return NextResponse.json({ error: "Failed to open engagement" }, { status: 500 });
  }
}
