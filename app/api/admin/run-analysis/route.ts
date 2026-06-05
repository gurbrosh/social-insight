import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { executionLogger } from "@/lib/execution-logger";
import { prisma } from "@/lib/prisma";
import {
  runTaskBasedAnalysisForProject,
  getAnalysisStepsForProject,
} from "@/lib/task-based-analysis-run";
import type { AnalysisStep } from "@prisma/client";
import {
  ANALYSIS_LOCK_TTL_MS,
  clearAnalysisLock,
  getAnalysisLock,
  isAnalysisLockStale,
  setAnalysisLock,
} from "@/lib/analysis-lock";

// Force dynamic rendering
export const dynamic = "force-dynamic";

// Simple in-memory guard to prevent duplicate/concurrent runs in dev
const RUN_TTL_MS = ANALYSIS_LOCK_TTL_MS;

/**
 * GET - Check analysis lock status
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isUserAdmin = await isAdmin(session.user.id);
    if (!isUserAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");

    const lock = getAnalysisLock();
    if (!lock) {
      return NextResponse.json({ locked: false, message: "No analysis in progress" });
    }

    const now = Date.now();
    const age = now - lock.startedAt;
    const isStale = age >= RUN_TTL_MS;

    const lockInfo = {
      locked: true,
      projectId: lock.projectId,
      startedAt: new Date(lock.startedAt).toISOString(),
      ageSeconds: Math.round(age / 1000),
      isStale,
      matchesRequest: projectId ? lock.projectId === projectId : null,
    };

    return NextResponse.json(lockInfo);
  } catch (error) {
    console.error("Error checking analysis lock:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to check lock status" },
      { status: 500 }
    );
  }
}

/**
 * DELETE - Force clear analysis lock (admin only)
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isUserAdmin = await isAdmin(session.user.id);
    if (!isUserAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const force = searchParams.get("force") === "true";

    const lock = getAnalysisLock();
    if (!lock) {
      return NextResponse.json({ cleared: true, message: "No lock to clear" });
    }

    // If projectId specified, only clear if it matches
    if (projectId && lock.projectId !== projectId && !force) {
      return NextResponse.json(
        {
          error: `Lock is held by different project: ${lock.projectId}`,
          currentLock: {
            projectId: lock.projectId,
            ageSeconds: Math.round((Date.now() - lock.startedAt) / 1000),
          },
        },
        { status: 400 }
      );
    }

    const clearedProjectId = lock.projectId;
    const age = Math.round((Date.now() - lock.startedAt) / 1000);
    clearAnalysisLock();
    console.log(`[Lock] Force-cleared lock for project ${clearedProjectId} (was ${age}s old)`);

    return NextResponse.json({
      cleared: true,
      clearedProjectId,
      ageSeconds: age,
      message: "Lock cleared successfully",
    });
  } catch (error) {
    console.error("Error clearing analysis lock:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to clear lock" },
      { status: 500 }
    );
  }
}

/**
 * Manually trigger task-based analysis for a project
 * Admin-only endpoint for running analysis on existing data
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
    const { projectId, skipSentiment, sentimentOnly } = body as {
      projectId?: string;
      skipSentiment?: boolean;
      sentimentOnly?: boolean;
    };

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    if (skipSentiment && sentimentOnly) {
      return NextResponse.json(
        { error: "Invalid options: cannot skip sentiment and run sentiment-only simultaneously" },
        { status: 400 }
      );
    }

    // Guard: prevent concurrent/duplicate triggers for same project
    const now = Date.now();

    const currentLock = getAnalysisLock();
    if (currentLock && isAnalysisLockStale(currentLock, RUN_TTL_MS)) {
      console.log(
        `[Lock] Clearing stale lock for project ${currentLock.projectId} (age: ${Math.round(
          (now - currentLock.startedAt) / 1000
        )}s)`
      );
      clearAnalysisLock();
    }

    const refreshedLock = getAnalysisLock();
    if (refreshedLock && refreshedLock.projectId === projectId) {
      const age = Math.round((now - refreshedLock.startedAt) / 1000);
      console.log(
        `[Lock] Analysis already in progress for project ${projectId} (lock age: ${age}s)`
      );
      return NextResponse.json(
        {
          error: "Analysis already in progress for this project",
          inProgress: true,
          lockAge: age,
        },
        { status: 409 }
      );
    }

    // Set lock
    setAnalysisLock({ projectId, startedAt: now, mode: "manual" });
    console.log(`[Lock] Acquired lock for project ${projectId} at ${new Date().toISOString()}`);

    console.log(`\n🔬 Manually triggered task-based analysis for project ${projectId}`);
    console.log("=".repeat(60));

    const steps: AnalysisStep[] = sentimentOnly
      ? ["SENTIMENT"]
      : skipSentiment
        ? ["THEMES", "CHATTER", "NETWORK", "NEWS", "BRAND"]
        : await getAnalysisStepsForProject(projectId);

    try {
      const result = await runTaskBasedAnalysisForProject(projectId, {
        steps,
        runSanitization: true,
      });

      console.log("✅ Manual analysis completed successfully");
      console.log("=".repeat(60) + "\n");

      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { name: true },
      });

      const analysisMode = sentimentOnly ? "sentiment-only" : skipSentiment ? "partial" : "full";

      await executionLogger.logSentimentAnalysis({
        executionId: `manual-${Date.now()}`,
        orchestrationId: "manual-run",
        projectId,
        projectName: project?.name,
        mode: analysisMode,
        source: "manual",
        processed: 0,
        skipped: 0,
        errors: 0,
        duration: 0,
        sentimentBreakdown: { POSITIVE: 0, NEGATIVE: 0, NEUTRAL: 0, MIXED: 0 },
        analysisBreakdown: {
          conversations: 0,
          sentimentAnalyzed: 0,
          influentialPeople: 0,
          newsItems: 0,
          themesMatched: 0,
        },
        timestamp: new Date(),
      });

      return NextResponse.json({
        success: true,
        runId: result.runId,
        tasksReset: result.tasksReset,
        message: "Task-based analysis completed successfully",
      });
    } finally {
      // Always release lock, even if error occurred
      const lockToRelease = getAnalysisLock();
      if (lockToRelease && lockToRelease.projectId === projectId) {
        const duration = Math.round((Date.now() - lockToRelease.startedAt) / 1000);
        console.log(`[Lock] Released lock for project ${projectId} after ${duration}s`);
        clearAnalysisLock(projectId);
      }
    }
  } catch (error) {
    console.error("Error running manual analysis:", error);

    // Ensure lock is released on error (projectId is in scope from try block)
    const lock = getAnalysisLock();
    if (lock) {
      const lockedProjectId = lock.projectId;
      console.log(`[Lock] Releasing lock for project ${lockedProjectId} due to error`);
      clearAnalysisLock(lockedProjectId);
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to run analysis",
      },
      { status: 500 }
    );
  }
}
