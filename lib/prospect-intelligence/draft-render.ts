import type { OutreachTemplateDefinition, ProspectClassification } from "./types";

const VAR_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export type RenderTemplateContext = {
  classification: ProspectClassification;
  firstName: string;
  sourcePostTopic: string;
  sourcePostUrl: string;
  productAngle: string;
  detectedPain: string;
  suppressTitleCompany: boolean;
};

function roleCategoryFallback(c: ProspectClassification): string {
  const r = c.roleCategories.find((x) => x !== "unknown");
  return r?.replace(/_/g, " ") ?? "professional";
}

export function renderOutreachTemplate(
  template: OutreachTemplateDefinition,
  ctx: RenderTemplateContext
): { subject: string; body: string; usedManualReview: boolean } {
  const c = ctx.classification;
  const empOk =
    !ctx.suppressTitleCompany &&
    c.employmentConfidence >= template.employmentConfidenceThreshold &&
    (!template.requiresHighConfidenceEmployment ||
      c.employmentConfidence >= template.employmentConfidenceThreshold);

  let usedManualReview = false;
  const classificationReview = c.classificationNeedsReview ?? c.needsReview;
  const low =
    c.confidence < 0.35 || c.evidence.length === 0
      ? true
      : classificationReview && template.fallbackBehavior.ifLowConfidence === "manualReview";

  if (low && template.fallbackBehavior.ifLowConfidence === "manualReview") {
    usedManualReview = true;
  }

  const vars: Record<string, string> = {
    firstName: ctx.firstName,
    professionalSummary: c.professionalSummary ?? "",
    safeProfessionalReference: c.safeProfessionalReference ?? "",
    sourcePostTopic: ctx.sourcePostTopic,
    sourcePostUrl: ctx.sourcePostUrl,
    detectedPain: ctx.detectedPain,
    productAngle: ctx.productAngle,
    currentCompany:
      empOk && c.currentCompany
        ? c.currentCompany
        : template.fallbackBehavior.ifNoCompany === "useSafeReference"
          ? c.safeProfessionalReference ?? ""
          : "",
    currentTitle:
      empOk && c.currentTitle
        ? c.currentTitle
        : template.fallbackBehavior.ifNoTitle === "useRoleCategory"
          ? roleCategoryFallback(c)
          : "",
  };

  const replaceAll = (s: string): string =>
    s.replace(VAR_RE, (_, key: string) => vars[key] ?? "");

  return {
    subject: template.subjectTemplate ? replaceAll(template.subjectTemplate) : "",
    body: replaceAll(template.bodyTemplate),
    usedManualReview,
  };
}
