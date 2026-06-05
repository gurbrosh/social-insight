import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/check-reddit-identity
 * Checks Reddit identity configuration for the authenticated user
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get user's Reddit identities
    const redditIdentities = await prisma.userPlatformIdentity.findMany({
      where: {
        user_id: session.user.id,
        platform: "reddit",
        deleted_at: null,
      },
      orderBy: {
        created_at: "desc",
      },
    });

    // Get sample Reddit posts to test matching
    // Note: Post model doesn't have deleted_at, so we just filter by platform
    const sampleRedditPosts = await prisma.post.findMany({
      where: {
        platform: "reddit",
      },
      select: {
        authorName: true,
        authorId: true,
      },
      take: 20,
      distinct: ["authorName"],
    });

    // Test matching logic (EXACT same as in engagement refresh)
    // This matches the logic in app/api/engagement/refresh/route.ts line 352-382
    const normalizedIdentities = redditIdentities.map((id) =>
      id.identity
        .toLowerCase()
        .trim()
        .replace(/^@/, "")
        .replace(/^https?:\/\//, "")
        .replace(/\/$/, "")
    );

    const matchingExamples = sampleRedditPosts
      .filter((post) => post.authorName)
      .map((post) => {
        const authorNormalized = post.authorName!.toLowerCase().trim();
        // This matches the exact logic from engagement refresh: includes() check for partial matching
        const matches = normalizedIdentities.some((id) => {
          // For Reddit, also try removing u/ prefix from both sides for comparison
          const identityWithoutU = id.replace(/^u\//, "").replace(/^www\.reddit\.com\/user\//, "");
          const authorWithoutU = authorNormalized.replace(/^u\//, "");
          return (
            authorNormalized === id ||
            authorNormalized.includes(id) ||
            id.includes(authorNormalized) ||
            authorWithoutU === identityWithoutU ||
            authorWithoutU.includes(identityWithoutU) ||
            identityWithoutU.includes(authorWithoutU)
          );
        });

        return {
          authorName: post.authorName,
          authorId: post.authorId,
          normalized: authorNormalized,
          normalizedWithoutU: authorNormalized.replace(/^u\//, ""),
          matches: matches,
          matchingIdentities: normalizedIdentities.filter((id) => {
            const identityWithoutU = id
              .replace(/^u\//, "")
              .replace(/^www\.reddit\.com\/user\//, "");
            const authorWithoutU = authorNormalized.replace(/^u\//, "");
            return (
              authorNormalized === id ||
              authorNormalized.includes(id) ||
              id.includes(authorNormalized) ||
              authorWithoutU === identityWithoutU ||
              authorWithoutU.includes(identityWithoutU) ||
              identityWithoutU.includes(authorWithoutU)
            );
          }),
        };
      })
      .filter((example) => example.matches)
      .slice(0, 10);

    return NextResponse.json({
      success: true,
      redditIdentities: redditIdentities.map((id) => ({
        id: id.id,
        identity: id.identity,
        verified: id.verified,
        normalized: id.identity
          .toLowerCase()
          .trim()
          .replace(/^@/, "")
          .replace(/^https?:\/\//, "")
          .replace(/\/$/, ""),
        created_at: id.created_at,
      })),
      identityCount: redditIdentities.length,
      matchingExamples: matchingExamples,
      sampleAuthors: sampleRedditPosts
        .filter((p) => p.authorName)
        .map((p) => p.authorName)
        .slice(0, 10),
      recommendations:
        redditIdentities.length === 0
          ? ["No Reddit identity configured. Add your Reddit username in User Identities section."]
          : redditIdentities.map((id) => {
              const recommendations: string[] = [];

              if (id.identity.includes("http")) {
                recommendations.push(
                  "Consider using just the username (e.g., 'username') instead of full URL"
                );
              }
              if (id.identity.startsWith("@")) {
                recommendations.push(
                  "Reddit usernames don't need @ prefix, but this will still work"
                );
              }
              if (id.identity.startsWith("u/")) {
                recommendations.push("Format is correct: 'u/username' is acceptable");
              }

              return {
                identity: id.identity,
                recommendations,
              };
            }),
    });
  } catch (error) {
    console.error("Error checking Reddit identity:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to check Reddit identity" },
      { status: 500 }
    );
  }
}
