import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/permissions";
import { checkCrunchyConeAuth } from "@/lib/crunchycone-auth-service";
import { getCrunchyConeProjectID } from "crunchycone-lib/auth";
import { isPlatformEnvironment } from "@/lib/environment-service";

// Force dynamic rendering
export const dynamic = "force-dynamic";

interface CrunchyConeProject {
  project_id: string;
  [key: string]: unknown;
}

export async function POST(_request: NextRequest) {
  try {
    // Require admin role
    await requireRole("admin");

    const result = {
      authenticated: false,
      hasProject: false,
      authDetails: null as Record<string, unknown> | null,
      projectDetails: null as CrunchyConeProject | null,
      error: null as string | null,
    };

    // Check if we're in platform mode first
    if (isPlatformEnvironment()) {
      const hasApiKey = !!process.env.CRUNCHYCONE_API_KEY;
      const hasProjectId = !!process.env.CRUNCHYCONE_PROJECT_ID;

      if (hasApiKey && hasProjectId) {
        result.authenticated = true;
        result.hasProject = true;
        result.authDetails = {
          success: true,
          message: "CrunchyCone configured for platform environment",
          user: { name: "Platform User" },
        };
        result.projectDetails = {
          project_id: process.env.CRUNCHYCONE_PROJECT_ID!,
          configFile: "environment variables (platform mode)",
        };
        return NextResponse.json(result);
      }
    }

    // For local development, use the unified auth service from crunchycone-lib
    try {
      const authResult = await checkCrunchyConeAuth();

      result.authenticated = authResult.success;
      result.authDetails = {
        success: authResult.success,
        message: authResult.message || (authResult.success ? "Authenticated" : "Not authenticated"),
        user: authResult.user,
        source: authResult.source,
      };

      if (authResult.error) {
        result.error = authResult.error;
      }
    } catch (error) {
      console.error("Error checking CrunchyCone auth:", error);
      result.error = error instanceof Error ? error.message : "Unknown error occurred";
      result.authDetails = {
        success: false,
        message: "Failed to check authentication status",
      };
    }

    // Check for project configuration
    try {
      // Try crunchycone-lib function first
      let projectId = getCrunchyConeProjectID();

      // If library function fails, use manual fallback (more reliable)
      if (!projectId) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require("fs");
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const path = require("path");
        const tomlPath = path.join(process.cwd(), "crunchycone.toml");
        if (fs.existsSync(tomlPath)) {
          const tomlContent = fs.readFileSync(tomlPath, "utf-8");
          const projectIdMatch = tomlContent.match(/^project_id\s*=\s*['"](.*?)['"]$/m);
          if (projectIdMatch) {
            projectId = projectIdMatch[1];
          }
        }
      }

      if (projectId) {
        result.hasProject = true;
        result.projectDetails = {
          project_id: projectId,
          configFile: "crunchycone.toml",
        };
      } else {
        result.hasProject = false;
        result.projectDetails = null;
      }
    } catch (error) {
      console.error("Error checking project configuration:", error);
      result.hasProject = false;
      result.projectDetails = null;
      if (!result.error) {
        result.error = "Failed to check project configuration";
      }
    }

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
