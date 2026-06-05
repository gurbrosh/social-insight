import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import {
  ProjectPurgeAction,
  purgeProjectAnalysis,
  purgeProjectRecords,
} from "@/lib/projects/purge-service";
import { generateMonitoringFocus } from "@/lib/projects/monitoring-focus-generator";
import { syncProjectKeywordsToBrands } from "@/lib/brand-directory/brand-service";
import { generateId } from "@/lib/utils/ulid";

export const dynamic = "force-dynamic";

const createProjectSchema = z.object({
  name: z.string().min(1, "Project name is required").max(100),
  description: z.string().max(500).optional().nullable(),
  monitoring_focus: z.string().max(1000).optional().nullable(),
  keywords: z.array(z.string().min(1)).max(12, "Maximum 12 keywords allowed"),
  brands: z
    .array(
      z.union([
        z.string().min(1), // Legacy: brand name as string
        z.object({
          id: z.string(), // Allow empty string for legacy brands
          brand_name: z.string().min(1),
          company_name: z.string().optional(),
        }),
      ])
    )
    .max(12, "Maximum 12 brands allowed")
    .optional()
    .default([]),
  profiles: z
    .array(
      z.object({
        platform: z.string().min(1),
        name: z.string().min(1),
        url: z.string().url(),
        type: z.enum(["person", "company", "channel"]),
        is_selected: z.boolean().optional().default(true),
      })
    )
    .max(100, "Maximum 100 profiles allowed")
    .optional()
    .default([]),
  schedule_enabled: z.boolean().optional().default(false),
  // Accept null from the client and treat it as undefined
  schedule_cron: z.string().optional().nullable(),
  themes: z
    .array(
      z.object({
        theme_name: z.string().min(1),
        description: z.string().optional().nullable(),
        is_active: z.boolean().optional().default(false),
      })
    )
    .optional()
    .default([]),
  // Engagement thresholds (minimum engagement score: likes + comments + shares)
  linkedin_engagement_threshold: z.number().int().min(0).max(10000).nullable().optional(),
  facebook_engagement_threshold: z.number().int().min(0).max(10000).nullable().optional(),
  twitter_engagement_threshold: z.number().int().min(0).max(10000).nullable().optional(),
  require_keywords_with_brands: z.boolean().optional().default(false),
});

const updateProjectSchema = z.object({
  name: z.string().min(1, "Project name is required").max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  monitoring_focus: z.string().max(1000).nullable().optional(),
  keywords: z
    .array(z.string().min(1, "Keyword cannot be empty"))
    .max(12, "Maximum 12 keywords allowed")
    .optional(),
  brands: z
    .array(
      z.union([
        z.string().min(1, "Brand name cannot be empty"), // Legacy: brand name as string
        z.object({
          id: z.string(), // Allow empty string for legacy brands
          brand_name: z.string().min(1),
          company_name: z.string().optional(),
        }),
      ])
    )
    .max(12, "Maximum 12 brands allowed")
    .optional(),
  profiles: z
    .array(
      z.object({
        platform: z.string().min(1),
        name: z.string().min(1),
        url: z.string().url(),
        type: z.enum(["person", "company", "channel"]),
        is_selected: z.boolean().optional().default(true),
      })
    )
    .max(100, "Maximum 100 profiles allowed")
    .optional(),
  // Engagement thresholds (minimum engagement score: likes + comments + shares)
  linkedin_engagement_threshold: z.number().int().min(0).max(10000).nullable().optional(),
  facebook_engagement_threshold: z.number().int().min(0).max(10000).nullable().optional(),
  twitter_engagement_threshold: z.number().int().min(0).max(10000).nullable().optional(),
  require_keywords_with_brands: z.boolean().optional(),
  analysis_profile: z.enum(["full", "minimal"]).optional(),
  analysis_sample_post_limit: z.number().int().min(1).max(500000).nullable().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validatedData = createProjectSchema.parse(body);

    // Create project with keywords in a transaction
    const project = await prisma.$transaction(async (tx) => {
      // Extract brand names for monitoring focus generation
      const brandNames = validatedData.brands.map((brand) =>
        typeof brand === "string" ? brand : brand.brand_name
      );

      // Auto-generate monitoring focus if not provided
      const monitoringFocus =
        validatedData.monitoring_focus ||
        generateMonitoringFocus({
          keywords: validatedData.keywords,
          brands: brandNames,
        });

      // Create the project
      const newProject = await tx.project.create({
        data: {
          name: validatedData.name,
          description: validatedData.description,
          monitoring_focus: monitoringFocus,
          user_id: session.user.id,
          schedule_enabled: validatedData.schedule_enabled ?? false,
          schedule_cron: validatedData.schedule_cron || null,
          next_scheduled_at:
            (validatedData.schedule_enabled ?? false) && !!validatedData.schedule_cron
              ? new Date(Date.now() + 60 * 60 * 1000) // 1 hour from now as placeholder
              : null,
          linkedin_engagement_threshold: validatedData.linkedin_engagement_threshold ?? null,
          facebook_engagement_threshold: validatedData.facebook_engagement_threshold ?? null,
          twitter_engagement_threshold: validatedData.twitter_engagement_threshold ?? null,
          require_keywords_with_brands: validatedData.require_keywords_with_brands ?? false,
        },
      });

      // Create keywords
      await tx.projectKeyword.createMany({
        data: validatedData.keywords.map((keyword) => ({
          project_id: newProject.id,
          keyword,
        })),
      });

      // Create brands
      if (validatedData.brands && validatedData.brands.length > 0) {
        // Validate combined limit (keywords + brands = 12 total)
        const totalItems = validatedData.keywords.length + validatedData.brands.length;
        if (totalItems > 12) {
          throw new Error(
            `Total items (keywords + brands) cannot exceed 12. Currently: ${validatedData.keywords.length} keywords + ${validatedData.brands.length} brands = ${totalItems} items`
          );
        }

        await tx.projectBrand.createMany({
          data: validatedData.brands.map((brand) => {
            // Handle both string (legacy) and object formats
            if (typeof brand === "string") {
              return {
                project_id: newProject.id,
                brand_name: brand,
                brand_id: null,
                is_selected: true,
              };
            } else {
              return {
                project_id: newProject.id,
                brand_name: brand.brand_name,
                brand_id: brand.id && brand.id.trim() ? brand.id : null, // Only set brand_id if it's not empty
                is_selected: true,
              };
            }
          }),
        });
      }

      // Source configuration (profiles) is not set here: only Brand Related Sources (POST /api/projects/[id]/brand-sources) and follow/unfollow from the network tab change it.

      // Create themes from request
      if (validatedData.themes && validatedData.themes.length > 0) {
        // Pre-generate IDs sequentially to avoid collisions when creating in parallel
        const themesWithIds = validatedData.themes.map((theme) => ({
          ...theme,
          id: generateId(),
        }));

        // Use individual create calls with pre-generated IDs
        await Promise.all(
          themesWithIds.map((theme) =>
            tx.projectTheme.create({
              data: {
                id: theme.id,
                project_id: newProject.id,
                theme_name: theme.theme_name,
                description: theme.description,
                is_active: theme.is_active ?? false,
              },
            })
          )
        );
      }

      // Return project with keywords, brands, sources, and profiles
      return await tx.project.findUnique({
        where: { id: newProject.id },
        include: {
          keywords: {
            where: { deleted_at: null },
          },
          brands: {
            where: { deleted_at: null },
          },
          sources: {
            where: { deleted_at: null },
          },
          profiles: {
            where: { deleted_at: null },
          },
        },
      });
    });

    // Sync project keywords to selected brands (after transaction completes)
    try {
      const brandIds = validatedData.brands
        .map((brand) =>
          typeof brand === "object" && brand.id && brand.id.trim() ? brand.id : null
        )
        .filter((id): id is string => id !== null);

      if (brandIds.length > 0 && validatedData.keywords.length > 0) {
        await syncProjectKeywordsToBrands(validatedData.keywords, brandIds);
      }
    } catch (syncError) {
      // Log error but don't fail the project creation
      console.error("Error syncing keywords to brands:", syncError);
    }

    return NextResponse.json(project);
  } catch (error) {
    console.error("Error creating project:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(_request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projects = await prisma.project.findMany({
      where: {
        user_id: session.user.id,
        deleted_at: null,
      },
      include: {
        keywords: {
          where: { deleted_at: null },
        },
        brands: {
          where: { deleted_at: null },
        },
        sources: {
          where: { deleted_at: null },
        },
        profiles: {
          where: { deleted_at: null },
        },
        _count: {
          select: {
            posts: true,
            jobs: {
              where: { deleted_at: null },
            },
          },
        },
      },
      orderBy: { created_at: "desc" },
    });

    return NextResponse.json(projects);
  } catch (error) {
    console.error("Error fetching projects:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { projectId, purge_action: rawPurgeAction, ...updateData } = body;

    if (!projectId) {
      return NextResponse.json({ error: "Project ID is required" }, { status: 400 });
    }

    const purgeAction: ProjectPurgeAction = ((): ProjectPurgeAction => {
      if (typeof rawPurgeAction !== "string") {
        return "none";
      }

      switch (rawPurgeAction.toLowerCase()) {
        case "analysis":
          return "analysis";
        case "records":
          return "records";
        default:
          return "none";
      }
    })();

    // Normalize description and monitoring_focus empty strings to null before validation
    if (updateData.description !== undefined && updateData.description !== null) {
      updateData.description = updateData.description.trim() || null;
    }
    if (updateData.monitoring_focus !== undefined && updateData.monitoring_focus !== null) {
      updateData.monitoring_focus = updateData.monitoring_focus.trim() || null;
    }

    // Filter out empty keywords and brands before validation
    if (updateData.keywords) {
      updateData.keywords = updateData.keywords.filter(
        (keyword: string) => keyword.trim().length > 0
      );
    }

    if (updateData.brands) {
      updateData.brands = updateData.brands.filter((brand: any) => {
        if (typeof brand === "string") {
          return brand.trim().length > 0;
        }
        // Object format: check brand_name
        return brand && brand.brand_name && brand.brand_name.trim().length > 0;
      });
    }

    if (updateData.profiles) {
      console.log("Received profiles:", updateData.profiles);
      updateData.profiles = updateData.profiles.filter(
        (profile: any) =>
          profile.name &&
          profile.name.trim().length > 0 &&
          profile.url &&
          profile.url.trim().length > 0
      );
      console.log("Filtered profiles:", updateData.profiles);
    }

    console.log("About to validate data:", updateData);
    let validatedData;
    try {
      validatedData = updateProjectSchema.parse(updateData);
    } catch (error) {
      console.error("Validation error:", error);
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: "Validation failed", details: error.issues },
          { status: 400 }
        );
      }
      throw error;
    }

    // Verify user owns the project
    const existingProject = await prisma.project.findFirst({
      where: {
        id: projectId,
        user_id: session.user.id,
        deleted_at: null,
      },
    });

    if (!existingProject) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Get current keywords and brands for monitoring focus generation
    const currentKeywords =
      validatedData.keywords !== undefined
        ? validatedData.keywords
        : (
            await prisma.projectKeyword.findMany({
              where: { project_id: projectId, deleted_at: null },
              select: { keyword: true },
            })
          ).map((k) => k.keyword);

    const currentBrands =
      validatedData.brands !== undefined
        ? validatedData.brands.map((brand) =>
            typeof brand === "string" ? brand : brand.brand_name
          )
        : (
            await prisma.projectBrand.findMany({
              where: { project_id: projectId, deleted_at: null },
              select: { brand_name: true },
            })
          ).map((b) => b.brand_name);

    // Auto-generate monitoring focus if keywords or brands changed
    const monitoringFocus =
      validatedData.monitoring_focus !== undefined
        ? validatedData.monitoring_focus
        : generateMonitoringFocus({
            keywords: currentKeywords,
            brands: currentBrands,
          });

    // Update project
    console.log("Updating project - monitoring_focus value:", monitoringFocus);
    const projectUpdateData: any = {
      name: validatedData.name,
      description: validatedData.description,
      monitoring_focus: monitoringFocus,
      linkedin_engagement_threshold: validatedData.linkedin_engagement_threshold ?? null,
      facebook_engagement_threshold: validatedData.facebook_engagement_threshold ?? null,
      twitter_engagement_threshold: validatedData.twitter_engagement_threshold ?? null,
    };

    // Include require_keywords_with_brands if provided
    if (validatedData.require_keywords_with_brands !== undefined) {
      projectUpdateData.require_keywords_with_brands = validatedData.require_keywords_with_brands;
    }

    if (validatedData.analysis_profile !== undefined) {
      projectUpdateData.analysis_profile = validatedData.analysis_profile;
    }
    if (validatedData.analysis_sample_post_limit !== undefined) {
      projectUpdateData.analysis_sample_post_limit = validatedData.analysis_sample_post_limit;
    }

    await prisma.project.update({
      where: { id: projectId },
      data: projectUpdateData,
    });

    // Use transaction to ensure atomicity for keywords and brands
    await prisma.$transaction(async (tx) => {
      // Always update keywords (even if empty array to clear them)
      if (validatedData.keywords !== undefined) {
        const keywords = validatedData.keywords;

        // Soft delete existing keywords
        await tx.projectKeyword.updateMany({
          where: { project_id: projectId },
          data: { deleted_at: new Date() },
        });

        // Create new keywords (only if there are any)
        if (keywords.length > 0) {
          await tx.projectKeyword.createMany({
            data: keywords.map((keyword) => ({
              project_id: projectId,
              keyword: keyword,
            })),
          });
        }
      }

      // Always update brands (even if empty array to clear them)
      if (validatedData.brands !== undefined) {
        const brands = validatedData.brands;

        // Validate combined limit if keywords are also being updated
        if (validatedData.keywords !== undefined) {
          const totalItems = validatedData.keywords.length + brands.length;
          if (totalItems > 12) {
            throw new Error(
              `Total items (keywords + brands) cannot exceed 12. Currently: ${validatedData.keywords.length} keywords + ${brands.length} brands = ${totalItems} items`
            );
          }
        } else {
          // Only brands are being updated, check against existing keywords
          const existingKeywords = await tx.projectKeyword.count({
            where: { project_id: projectId, deleted_at: null },
          });
          const totalItems = existingKeywords + brands.length;
          if (totalItems > 12) {
            throw new Error(
              `Total items (keywords + brands) cannot exceed 12. Currently: ${existingKeywords} keywords + ${brands.length} brands = ${totalItems} items`
            );
          }
        }

        // Get existing brands before deletion to identify which brands are being removed
        const existingBrands = await tx.projectBrand.findMany({
          where: {
            project_id: projectId,
            deleted_at: null,
          },
          select: {
            brand_id: true,
          },
        });

        // Identify which brands are being removed (brands in existingBrands but not in new brands list)
        const existingBrandIds = existingBrands
          .map((b) => b.brand_id)
          .filter((id): id is string => id !== null);

        const newBrandIds = brands
          .map((b) => (typeof b === "string" ? null : b.id))
          .filter((id): id is string => id !== null && id.trim() !== "");

        // Only delete sources for brands that are actually being removed
        const removedBrandIds = existingBrandIds.filter((id) => !newBrandIds.includes(id));

        if (removedBrandIds.length > 0) {
          await tx.projectBrandSource.updateMany({
            where: {
              project_id: projectId,
              brand_id: { in: removedBrandIds },
              deleted_at: null,
            },
            data: { deleted_at: new Date() },
          });
        }

        // Soft delete existing brands
        await tx.projectBrand.updateMany({
          where: { project_id: projectId },
          data: { deleted_at: new Date() },
        });

        // Create new brands (only if there are any)
        if (brands.length > 0) {
          await tx.projectBrand.createMany({
            data: brands.map((brand) => {
              // Handle both string (legacy) and object formats
              if (typeof brand === "string") {
                return {
                  project_id: projectId,
                  brand_name: brand,
                  brand_id: null,
                  is_selected: true,
                };
              } else {
                return {
                  project_id: projectId,
                  brand_name: brand.brand_name,
                  brand_id: brand.id && brand.id.trim() ? brand.id : null, // Only set brand_id if it's not empty
                  is_selected: true,
                };
              }
            }),
          });
        }
      }

      // Source configuration (profiles) is not updated here: only Brand Related Sources (POST /api/projects/[id]/brand-sources) and follow/unfollow from the network tab change it.
    });

    if (purgeAction === "analysis") {
      await purgeProjectAnalysis(projectId);
    } else if (purgeAction === "records") {
      await purgeProjectRecords(projectId);
    }

    // Sync project keywords to selected brands (if keywords or brands were updated)
    try {
      if (validatedData.keywords !== undefined || validatedData.brands !== undefined) {
        // Get final keywords and brand IDs for syncing
        const finalKeywords =
          validatedData.keywords !== undefined
            ? validatedData.keywords
            : (
                await prisma.projectKeyword.findMany({
                  where: { project_id: projectId, deleted_at: null },
                  select: { keyword: true },
                })
              ).map((k) => k.keyword);

        // Extract brand IDs - handle both string (legacy) and object formats
        let brandIds: string[] = [];
        if (validatedData.brands !== undefined) {
          brandIds = validatedData.brands
            .map((brand) => {
              if (typeof brand === "string") {
                return null; // Legacy format - no brand_id
              } else {
                return brand.id && brand.id.trim() ? brand.id : null;
              }
            })
            .filter((id): id is string => id !== null);
        } else {
          // Get brand IDs from database
          const dbBrands = await prisma.projectBrand.findMany({
            where: { project_id: projectId, deleted_at: null },
            select: { brand_id: true },
          });
          brandIds = dbBrands
            .map((b) => b.brand_id)
            .filter((id): id is string => id !== null && id.trim() !== "");
        }

        if (brandIds.length > 0 && finalKeywords.length > 0) {
          console.log(
            `[PATCH /api/projects] Syncing ${finalKeywords.length} keyword(s) to ${brandIds.length} brand(s):`,
            {
              keywords: finalKeywords,
              brandIds,
            }
          );
          await syncProjectKeywordsToBrands(finalKeywords, brandIds);
        } else {
          console.log(
            `[PATCH /api/projects] Skipping sync - keywords: ${finalKeywords.length}, brandIds: ${brandIds.length}`
          );
        }
      }
    } catch (syncError) {
      // Log error but don't fail the project update
      console.error("Error syncing keywords to brands:", syncError);
    }

    // Return updated project with keywords, brands, sources, and profiles
    const projectWithKeywords = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        keywords: {
          where: { deleted_at: null },
        },
        brands: {
          where: { deleted_at: null },
        },
        sources: {
          where: { deleted_at: null },
        },
        profiles: {
          where: { deleted_at: null },
        },
      },
    });

    return NextResponse.json(projectWithKeywords);
  } catch (error) {
    console.error("PATCH /api/projects - Error updating project:", error);
    if (error instanceof Error) {
      console.error("PATCH /api/projects - Error stack:", error.stack);
    }

    if (error instanceof z.ZodError) {
      console.error("PATCH /api/projects - Validation errors:", error.issues);
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

export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("id");

    if (!projectId) {
      return NextResponse.json({ error: "Project ID is required" }, { status: 400 });
    }

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

    // Soft delete the project and related project brand sources
    await prisma.$transaction(async (tx) => {
      // Soft delete project brand sources
      await tx.projectBrandSource.updateMany({
        where: {
          project_id: projectId,
          deleted_at: null,
        },
        data: { deleted_at: new Date() },
      });

      await tx.projectMyProductDocument.updateMany({
        where: { project_id: projectId, deleted_at: null },
        data: { deleted_at: new Date() },
      });

      // Soft delete the project
      await tx.project.update({
        where: { id: projectId },
        data: { deleted_at: new Date() },
      });
    });

    return NextResponse.json({ success: true, message: "Project deleted successfully" });
  } catch (error) {
    console.error("Error deleting project:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
