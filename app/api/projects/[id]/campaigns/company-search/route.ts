import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { expandRoleGroupsToJobTitles } from "@/lib/campaigns/company-role-search-mapping";
import {
  APIFY_NOT_CONFIGURED_MESSAGE,
  runCompanyEmployeesSearch,
} from "@/lib/campaigns/run-company-employees-search";
import { validateCompanySearchInput } from "@/lib/campaigns/validate-company-search-input";
import { CAMPAIGN_COMPANY_SEARCH_MAX_ITEMS_OPTIONS } from "@/lib/campaigns/constants";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.object({
  companyUrls: z.array(z.string()).min(1),
  roleGroups: z.array(z.string()).min(1),
  maxItems: z.number().int(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: projectId } = await params;
    const project = await prisma.project.findFirst({
      where: { id: projectId, user_id: session.user.id, deleted_at: null },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const validated = validateCompanySearchInput({
      companyUrls: parsed.data.companyUrls,
      roleGroups: parsed.data.roleGroups,
      maxItems: parsed.data.maxItems,
      expandJobTitles: expandRoleGroupsToJobTitles,
    });

    if (!validated.ok) {
      return NextResponse.json(
        {
          ok: false,
          errors: [validated.error],
          warnings: [],
          rawCount: 0,
          normalizedCount: 0,
          candidates: [],
        },
        { status: 400 }
      );
    }

    if (
      !CAMPAIGN_COMPANY_SEARCH_MAX_ITEMS_OPTIONS.includes(validated.maxItems)
    ) {
      return NextResponse.json({ error: "Invalid maxItems" }, { status: 400 });
    }

    const result = await runCompanyEmployeesSearch({
      companyUrls: validated.companyUrls,
      jobTitles: validated.jobTitles,
      maxItems: validated.maxItems,
      roleGroups: validated.roleGroups,
    });

    if (!result.ok) {
      const status = result.apifyNotConfigured ? 503 : 500;
      return NextResponse.json(
        {
          ok: false,
          errors: [result.error ?? APIFY_NOT_CONFIGURED_MESSAGE],
          warnings: [],
          rawCount: 0,
          normalizedCount: 0,
          candidates: [],
        },
        { status }
      );
    }

    return NextResponse.json({
      ok: true,
      rawCount: result.rawCount,
      normalizedCount: result.normalizedCount,
      candidates: result.candidates,
      warnings: result.warnings,
      errors: [],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[campaigns/company-search]", e);
    return NextResponse.json({ error: msg || "Company search failed" }, { status: 500 });
  }
}
