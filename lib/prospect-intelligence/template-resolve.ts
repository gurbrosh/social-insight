import type {
  OutreachTemplateDefinition,
  ProspectClassification,
  ProspectOutreachBucket,
  FunctionTag,
} from "./types";

function intersects<T>(a: T[], b: T[]): boolean {
  const set = new Set(b);
  return a.some((x) => set.has(x));
}

function scoreTemplateMatch(
  t: OutreachTemplateDefinition,
  c: ProspectClassification
): number {
  let score = 0;
  if (t.appliesToRoleCategories.length > 0) {
    if (!intersects(t.appliesToRoleCategories, c.roleCategories)) return -1;
    score += t.appliesToRoleCategories.filter((r) => c.roleCategories.includes(r)).length * 10;
  }
  if (t.appliesToFunctionTags.length > 0) {
    const ft = t.appliesToFunctionTags as FunctionTag[];
    if (!intersects(ft, c.functionTags)) return -1;
    score += ft.filter((f) => c.functionTags.includes(f)).length * 5;
  }
  if (t.appliesToSeniority?.length) {
    if (!t.appliesToSeniority.includes(c.seniority)) return -1;
    score += 3;
  }
  return score;
}

function bucketToPreferredChannel(bucket: ProspectOutreachBucket): "email" | "linkedin" {
  if (bucket === "email" || bucket === "investor_nurture") return "email";
  return "linkedin";
}

export function resolveOutreachTemplateForClassification(params: {
  templates: OutreachTemplateDefinition[];
  bucket: ProspectOutreachBucket;
  classification: ProspectClassification;
  hasSourcePostText: boolean;
  preferChannel?: "email" | "linkedin";
}): OutreachTemplateDefinition | null {
  const channel = params.preferChannel ?? bucketToPreferredChannel(params.bucket);
  const candidates = params.templates.filter((t) => t.enabled && t.channel === channel);

  const scored: { t: OutreachTemplateDefinition; score: number }[] = [];
  for (const t of candidates) {
    if (t.requiresSourcePostContext && !params.hasSourcePostText) continue;
    const s = scoreTemplateMatch(t, params.classification);
    if (s < 0) continue;
    scored.push({ t, score: s });
  }

  if (scored.length === 0) return null;

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.t.priority - b.t.priority;
  });
  return scored[0]?.t ?? null;
}
