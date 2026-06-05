import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getHeadlineFixtureById } from "@/lib/prospect-intelligence/__fixtures__/headlines";
import { gatherProspectEvidence } from "@/lib/prospect-intelligence/gather-evidence";
import { classifyProspectDeterministic } from "@/lib/prospect-intelligence/classify";
import { fetchActiveRoutingRules } from "@/lib/prospect-intelligence/pipeline";
import { evaluateRoutingRules } from "@/lib/prospect-intelligence/rule-engine";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  fixtureId: z.string().min(1),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = bodySchema.parse(await req.json());
  const fx = getHeadlineFixtureById(body.fixtureId);
  if (!fx) {
    return NextResponse.json({ error: "Unknown fixtureId" }, { status: 400 });
  }
  const ev = gatherProspectEvidence({
    headline: fx.headline,
    authorDisplayName: "Fixture User",
    postContent: fx.postSnippet ?? "Sample post body for fixture.",
    postUrl: fx.linkedinUrl ?? "https://www.linkedin.com/posts/example",
    platform: "linkedin",
  });
  const classification = classifyProspectDeterministic(ev, { linkedinUrl: fx.linkedinUrl });
  const defs = await fetchActiveRoutingRules(projectId);
  const routed = evaluateRoutingRules(defs, {
    classification,
    platform: "linkedin",
    themeRelevancePercent: 80,
    headlineText: fx.headline,
    competitorMatched: classification.roleCategories.includes("competitor"),
  });
  return NextResponse.json({ classification, ruleEngine: routed, fixtureId: fx.id });
}
