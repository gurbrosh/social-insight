import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { validateLinkedInProfile } from "@/lib/linkedin-profile-validator";
import { buildPersonEmploymentValidationMetadata } from "@/lib/prospect-intelligence/load-profile-employment";

export const dynamic = "force-dynamic";

const validateLinkedInProfilesSchema = z.object({
  projectId: z.string().min(1),
  organizationName: z.string().min(1), // Organization name or domain URL
  profileUrls: z.array(z.string().url()).min(1),
});

/**
 * Validate LinkedIn profiles against an organization (employment + membership).
 *
 * Request (JSON): { projectId, organizationName, profileUrls: string[] }
 * - profileUrls: full LinkedIn /in/ URLs (not person IDs or post IDs)
 * - organizationName: tracked employer name or domain (e.g. "[Brand].com")
 * - Auth: session required; project must belong to the user
 *
 * Behavior:
 * - Sequential per URL (~500ms delay); not a single bulk OpenAI call
 * - Calls validateLinkedInProfile → OpenAI (gpt-4o-mini) for experienceItems, title, company
 * - Skips URLs already validation_status moved_to_different_company | left_no_new_company
 * - Writes PersonEmployment (shared by linkedin_url): current_title, current_company,
 *   validation_metadata.experienceItems, validation_status
 * - Links/creates ProjectProfile rows for projectId
 *
 * For classification-only enrichment (no org check), use:
 *   npx tsx scripts/enrich-linkedin-profile-employment.ts
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validatedData = validateLinkedInProfilesSchema.parse(body);

    const { projectId, organizationName, profileUrls } = validatedData;

    // Verify project belongs to user
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

    // Normalize organization name (remove domain if URL provided)
    const normalizedOrgName = organizationName
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, "")
      .toLowerCase()
      .trim();

    // Extract company name from domain (e.g., "lovable.dev" -> "lovable")
    const companyName = normalizedOrgName.split(".")[0];

    // Tracked companies for validation (organization name + extracted company name)
    const trackedCompanies = [organizationName, companyName].filter(Boolean);

    // Get existing LinkedIn profiles for this project
    const existingProfiles = await prisma.projectProfile.findMany({
      where: {
        project_id: projectId,
        platform: "linkedin",
        url: { in: profileUrls },
        deleted_at: null,
      },
      include: {
        personEmployment: true, // Include shared employment data
      },
    });

    // Create a map of existing profiles by URL
    const existingProfileMap = new Map(existingProfiles.map((p) => [p.url, p]));

    // Get or create PersonEmployment records for all profile URLs
    // This allows us to check shared validation status across all projects
    const existingEmployments = await prisma.personEmployment.findMany({
      where: {
        linkedin_url: { in: profileUrls },
      },
    });

    const employmentMap = new Map<string, (typeof existingEmployments)[0]>(
      existingEmployments.map((e) => [e.linkedin_url, e])
    );

    // Separate profiles into:
    // 1. Already marked as "moved_to_different_company" or "left_no_new_company" - skip these
    // 2. Profiles to validate (new or existing that need checking)
    const profilesToSkip = profileUrls.filter((url) => {
      const employment = employmentMap.get(url);
      return (
        employment?.validation_status === "moved_to_different_company" ||
        employment?.validation_status === "left_no_new_company"
      );
    });

    const profilesToValidate = profileUrls.filter((url) => {
      const employment = employmentMap.get(url);
      return (
        !employment ||
        (employment.validation_status !== "moved_to_different_company" &&
          employment.validation_status !== "left_no_new_company")
      );
    });

    console.log(
      `[LinkedIn Validation] Validating ${profilesToValidate.length} profiles, skipping ${profilesToSkip.length} already marked as left/moved`
    );

    // Validate each profile
    const validationResults = [];
    const errors: string[] = [];

    for (const profileUrl of profilesToValidate) {
      try {
        const existingProfile = existingProfileMap.get(profileUrl);
        const existingEmployment = employmentMap.get(profileUrl);

        // Get previous values from shared PersonEmployment (if exists)
        const previousTitle = existingEmployment?.current_title ?? null;
        const previousCompany = existingEmployment?.current_company ?? null;

        // Validate profile
        const result = await validateLinkedInProfile(profileUrl, trackedCompanies, {
          useOpenAI: true,
        });

        // Check if title changed (if profile was previously validated and still at company)
        let titleChanged = false;
        if (
          result.currentTitle &&
          previousTitle &&
          result.currentCompany &&
          previousCompany &&
          result.currentTitle.toLowerCase().trim() !== previousTitle.toLowerCase().trim()
        ) {
          titleChanged = true;
        }

        // Determine validation status
        // Important: If hasMovedCompany is true, distinguish between:
        // 1. moved_to_different_company - left and joined a new company
        // 2. left_no_new_company - left but no current company (unemployed/transitioning)
        let validationStatus: string;
        if (result.error) {
          validationStatus = "unknown";
        } else if (result.hasMovedCompany) {
          // They've left the tracked company - check if they have a new company
          if (result.currentCompany) {
            // They moved to a different company
            validationStatus = "moved_to_different_company";
          } else {
            // They left but don't have a new company yet
            validationStatus = "left_no_new_company";
          }
        } else if (!result.currentCompany) {
          // No current company info but haven't explicitly left - mark as unknown
          validationStatus = "unknown";
        } else if (titleChanged) {
          validationStatus = "title_changed";
        } else {
          validationStatus = "active";
        }

        // Create or update PersonEmployment (shared across all projects)
        const { ulid: generateUlid } = await import("ulid");
        let personEmploymentId: string;

        if (existingEmployment) {
          // Update existing shared employment record
          await prisma.personEmployment.update({
            where: { id: existingEmployment.id },
            data: {
              name: result.name || existingEmployment.name,
              current_company: result.currentCompany || null,
              current_title: result.currentTitle || null,
              validation_status: validationStatus,
              last_validated_at: new Date(),
              validation_metadata: buildPersonEmploymentValidationMetadata({
                analysisMethod: result.analysisMethod,
                confidence: result.confidence,
                error: result.error,
                previousTitle,
                previousCompany,
                experienceItems: result.rawData?.experienceItems,
              }),
            },
          });
          personEmploymentId = existingEmployment.id;
        } else {
          // Create new shared employment record
          const newEmployment = await prisma.personEmployment.create({
            data: {
              id: generateUlid(),
              linkedin_url: profileUrl,
              name: result.name || null,
              current_company: result.currentCompany || null,
              current_title: result.currentTitle || null,
              validation_status: validationStatus,
              last_validated_at: new Date(),
              validation_metadata: buildPersonEmploymentValidationMetadata({
                analysisMethod: result.analysisMethod,
                confidence: result.confidence,
                error: result.error,
                experienceItems: result.rawData?.experienceItems,
              }),
            },
          });
          personEmploymentId = newEmployment.id;
        }

        // Create or update ProjectProfile and link to PersonEmployment
        if (existingProfile) {
          // Update existing profile and link to PersonEmployment
          await prisma.projectProfile.update({
            where: { id: existingProfile.id },
            data: {
              name: result.name || existingProfile.name || "Unknown",
              person_employment_id: personEmploymentId,
            },
          });
        } else {
          // Create new profile linked to PersonEmployment
          await prisma.projectProfile.create({
            data: {
              id: generateUlid(),
              project_id: projectId,
              platform: "linkedin",
              url: profileUrl,
              type: "person",
              name: result.name || "Unknown",
              is_selected: true,
              person_employment_id: personEmploymentId,
            },
          });
        }

        validationResults.push({
          profileUrl,
          status: validationStatus,
          name: result.name,
          currentCompany: result.currentCompany,
          currentTitle: result.currentTitle,
          hasMovedCompany: result.hasMovedCompany,
          titleChanged: titleChanged,
          previousTitle: previousTitle,
          previousCompany: previousCompany,
          error: result.error,
        });

        // Small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`Error validating profile ${profileUrl}:`, error);
        errors.push(`${profileUrl}: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }

    // Summary statistics
    const stats = {
      total: profileUrls.length,
      validated: validationResults.length,
      skipped: profilesToSkip.length,
      errors: errors.length,
      movedToDifferentCompany: validationResults.filter(
        (r) => r.status === "moved_to_different_company"
      ).length,
      leftNoNewCompany: validationResults.filter((r) => r.status === "left_no_new_company").length,
      titleChanged: validationResults.filter((r) => r.status === "title_changed").length,
      active: validationResults.filter((r) => r.status === "active").length,
      unknown: validationResults.filter((r) => r.status === "unknown").length,
    };

    return NextResponse.json({
      success: true,
      organizationName,
      stats,
      results: validationResults,
      skipped: profilesToSkip,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Error validating LinkedIn profiles:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
