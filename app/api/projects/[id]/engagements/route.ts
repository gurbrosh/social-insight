import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/projects/[id]/engagements
 * Returns engagement sessions for a project with associated events.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: projectId } = await params;
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const platform = searchParams.get("platform");

    // Verify project ownership
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

    const where: any = {
      project_id: projectId,
      deleted_at: null,
    };

    if (status && status !== "all") {
      where.status = status;
    }

    if (platform && platform !== "all") {
      where.platform = platform;
    }

    const sessions = await prisma.engagementSession.findMany({
      where,
      orderBy: { started_at: "desc" },
    });

    // Deduplicate: If multiple sessions exist for the same source_type + source_record_id + user,
    // keep only the most recent one (or active/watching over ended)
    const sessionMap = new Map<string, (typeof sessions)[0]>();
    for (const sess of sessions) {
      const key = `${sess.source_type}:${sess.source_record_id}:${sess.started_by_user_id}`;
      const existing = sessionMap.get(key);

      if (!existing) {
        sessionMap.set(key, sess);
      } else {
        // Prefer active/watching over ended, or more recent if same status
        const existingIsActive = existing.status === "active" || existing.status === "watching";
        const currentIsActive = sess.status === "active" || sess.status === "watching";

        if (currentIsActive && !existingIsActive) {
          sessionMap.set(key, sess); // Replace ended with active/watching
        } else if (existingIsActive === currentIsActive && sess.started_at > existing.started_at) {
          sessionMap.set(key, sess); // Replace with more recent if same status
        }
        // Otherwise keep existing
      }
    }

    const deduplicatedSessions = Array.from(sessionMap.values());

    // Fetch events for all sessions
    const sessionIds = deduplicatedSessions.map((s) => s.id);
    const allEvents = await prisma.engagementEvent.findMany({
      where: {
        engagement_id: { in: sessionIds },
        deleted_at: null,
      },
      orderBy: { occurred_at: "asc" },
    });

    // Group events by engagement_id
    const eventsBySession = new Map<string, typeof allEvents>();
    allEvents.forEach((event) => {
      if (!eventsBySession.has(event.engagement_id)) {
        eventsBySession.set(event.engagement_id, []);
      }
      eventsBySession.get(event.engagement_id)!.push(event);
    });

    // Enrich with source record info (themes or chatter title/preview) and selected identity
    const enriched = await Promise.all(
      deduplicatedSessions.map(async (sess) => {
        const events = eventsBySession.get(sess.id) || [];
        let preview: { title?: string; summary?: string; platform?: string } | null = null;

        if (sess.source_type === "themes") {
          const theme = await prisma.themesAnalysis.findUnique({
            where: { id: sess.source_record_id },
            select: { theme_name: true, post_content: true, platform: true },
          });
          if (theme)
            preview = {
              title: theme.theme_name,
              summary: theme.post_content?.substring(0, 150) || undefined,
              platform: theme.platform,
            };
        } else if (sess.source_type === "chatter") {
          const chatter = await prisma.chatterAnalysis.findUnique({
            where: { id: sess.source_record_id },
            select: { discussion_title: true, summary: true, platforms_json: true },
          });
          if (chatter) {
            const platforms = chatter.platforms_json ? JSON.parse(chatter.platforms_json) : [];
            preview = {
              title: chatter.discussion_title || undefined,
              summary: chatter.summary || undefined,
              platform: platforms[0],
            };
          }
        }

        // Fetch selected identity if one was chosen
        let selectedIdentity: { id: string; identity: string; platform: string } | null = null;
        if (sess.selected_identity_id) {
          const identity = await prisma.userPlatformIdentity.findUnique({
            where: { id: sess.selected_identity_id },
            select: { id: true, identity: true, platform: true },
          });
          if (identity) selectedIdentity = identity;
        }

        const hasUserReply = events.some(
          (e) => e.type === "detected_user_reply" || e.type === "manual_marked"
        );
        const lastSnapshot = events.filter((e) => e.type === "reaction_snapshot").slice(-1)[0];

        // Safely parse snapshot payload
        let snapshot: any = null;
        if (lastSnapshot?.payload) {
          try {
            snapshot =
              typeof lastSnapshot.payload === "string"
                ? JSON.parse(lastSnapshot.payload)
                : lastSnapshot.payload;
          } catch (error) {
            console.error(`Error parsing snapshot payload for engagement ${sess.id}:`, error);
            snapshot = null;
          }
        }

        // Helper to safely parse payload
        const parsePayload = (payload: any): any => {
          if (!payload) return null;
          if (typeof payload === "object") return payload; // Already parsed
          if (typeof payload === "string") {
            try {
              return JSON.parse(payload);
            } catch (error) {
              console.error(`Error parsing event payload:`, error);
              return null;
            }
          }
          return payload;
        };

        return {
          id: sess.id,
          source_type: sess.source_type,
          source_record_id: sess.source_record_id,
          platform: sess.platform,
          destination_url: sess.destination_url,
          status: sess.status,
          started_at: sess.started_at,
          watch_until: sess.watch_until,
          last_check_at: sess.last_check_at,
          selected_identity: selectedIdentity,
          preview,
          has_user_reply: hasUserReply,
          events: events.map((e) => ({
            id: e.id,
            type: e.type,
            payload: parsePayload(e.payload),
            occurred_at: e.occurred_at,
          })),
          snapshot,
        };
      })
    );

    return NextResponse.json({ success: true, sessions: enriched });
  } catch (error) {
    console.error("Error fetching engagements:", error);
    return NextResponse.json({ error: "Failed to fetch engagements" }, { status: 500 });
  }
}
