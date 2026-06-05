import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { getProjectContextForRelevance, checkRelevanceBatch } from "@/lib/comprehensive-analysis";

// Force dynamic rendering
export const dynamic = "force-dynamic";

/**
 * Test theme sanitization on existing records
 * This allows testing the sanitization logic without running a full analysis
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isUserAdmin = await isAdmin(session.user.id);
    if (!isUserAdmin) {
      return NextResponse.json({ error: "Forbidden - Admin access required" }, { status: 403 });
    }

    const body = await request.json();
    const { projectId } = body as { projectId?: string };

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const projectExists = await prisma.project.findUnique({
      where: { id: projectId, deleted_at: null },
      select: { id: true },
    });
    if (!projectExists) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Use semantic project scope for relevance (what is this user curious about?)
    const projectContext = await getProjectContextForRelevance(projectId);

    // Run theme sanitization
    console.log(`🧪 Testing theme sanitization for project ${projectId}`);
    const removed = await sanitizeThemes(projectId, projectContext);
    console.log(`✅ Theme sanitization test complete - removed ${removed} off-topic records`);

    return NextResponse.json({
      success: true,
      removed,
      message: `Sanitization test completed - removed ${removed} off-topic theme records`,
    });
  } catch (error) {
    console.error("Error testing theme sanitization:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to test theme sanitization",
      },
      { status: 500 }
    );
  }
}

/**
 * Sanitize Themes Analysis records
 * (Extracted from comprehensive-analysis.ts for standalone testing)
 */
async function sanitizeThemes(projectId: string, projectContext: string): Promise<number> {
  if (!process.env.OPENAI_API_KEY) {
    console.log("[Sanitization] Skipping theme sanitization - no OpenAI API key");
    return 0;
  }

  const records = await prisma.themesAnalysis.findMany({
    where: {
      project_id: projectId,
      deleted_at: null,
    },
    select: {
      id: true,
      theme_name: true,
      post_content: true,
      author_name: true,
    },
  });

  if (records.length === 0) {
    console.log("[Sanitization] No theme records to sanitize");
    return 0;
  }

  const batchSize = 20;
  let removed = 0;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const irrelevantIds = await checkRelevanceBatch(
      projectContext,
      batch.map((r) => ({
        id: r.id,
        type: "theme_match",
        content: `Theme: ${r.theme_name}\nAuthor: ${r.author_name}\nContent: ${r.post_content?.substring(0, 500) || "None"}`,
      })),
      undefined // theme context (no gravitas)
    );

    if (irrelevantIds.length > 0) {
      console.log(
        `[Sanitization] Removing ${irrelevantIds.length} off-topic theme matches from batch ${i}-${i + batchSize}`
      );
      await prisma.themesAnalysis.updateMany({
        where: { id: { in: irrelevantIds } },
        data: { deleted_at: new Date() },
      });
      removed += irrelevantIds.length;
    }

    if (i + batchSize < records.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return removed;
}
