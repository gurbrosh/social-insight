import type { DeterministicProspectContext } from "./deterministic-context";

const GENERIC_SAFE_REFERENCES = new Set([
  "your professional background",
  "your work",
  "your background",
  "your experience",
]);

export type LlmInvokeDecision = {
  invoke: boolean;
  reasons: string[];
};

function isGenericSafeReference(ref: string | null | undefined): boolean {
  if (!ref?.trim()) return true;
  return GENERIC_SAFE_REFERENCES.has(ref.trim().toLowerCase());
}

function meaningfulFunctionTags(tags: string[]): string[] {
  return tags.filter((t) => t !== "unknown");
}

function professionalRoleCategories(roleCategories: string[]): string[] {
  return roleCategories.filter((r) => r !== "job_seeker");
}

export function shouldInvokeLlmReconciler(ctx: DeterministicProspectContext): LlmInvokeDecision {
  const draft = ctx.draft;
  const reasons: string[] = [];
  const roles = professionalRoleCategories(draft.roleCategories);
  const unknownOnly = roles.length === 1 && roles[0] === "unknown";
  const tags = meaningfulFunctionTags(draft.functionTags);

  if (unknownOnly && tags.length > 0) reasons.push("unknown_roles_with_meaningful_function_tags");
  if (unknownOnly) reasons.push("unknown_role_categories");
  if (isGenericSafeReference(draft.safeProfessionalReference) && (roles.length > 0 || tags.length > 0)) {
    reasons.push("generic_safe_professional_reference");
  }
  if (draft.employmentConfidence < 0.55 && (draft.currentTitle || draft.currentCompany)) {
    reasons.push("ambiguous_employment");
  }
  if (
    draft.profileFlags.includes("ambiguous_employment") ||
    draft.profileFlags.includes("multiple_roles_signal")
  ) {
    reasons.push("ambiguous_profile_flags");
  }
  if (ctx.guardrailFindings.some((f) => f.severity === "block" || f.severity === "warn")) {
    reasons.push("guardrail_findings");
  }
  if (draft.classificationNeedsReview || draft.needsReview) {
    reasons.push("needs_review");
  }
  if (
    draft.profileFlags.includes("founder_signal") &&
    !ctx.explicitFounderEvidence
  ) {
    reasons.push("founder_signal_without_explicit_evidence");
  }

  const highConfidenceSkip =
    !unknownOnly &&
    draft.employmentConfidence >= 0.72 &&
    draft.confidence >= 0.7 &&
    !isGenericSafeReference(draft.safeProfessionalReference) &&
    reasons.length === 0;

  if (highConfidenceSkip) {
    return { invoke: false, reasons: ["high_confidence_deterministic"] };
  }

  if (reasons.length === 0) {
    reasons.push("semantic_reconciliation_pass");
  }

  return { invoke: true, reasons };
}
