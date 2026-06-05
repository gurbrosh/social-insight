import { openaiChatJsonObject } from "@/lib/response-generator/openai-json";
import type { OpenAIChatModelKind } from "@/lib/openai-chat-model";
import {
  type ClassifierOptions,
  type LlmReconcileInput,
  type LlmReconcileOutput,
  type ProspectLlmReconciler,
} from "./classify";
import { classifyProspect } from "./classify-prospect";
import type { DeterministicProspectContext } from "./deterministic-context";
import { safeParseProspectClassificationJson } from "./schemas";
import type { ProspectClassification, ProspectEvidence } from "./types";
import {
  EMPLOYMENT_RELATIONSHIP_VALUES,
  FUNCTION_TAG_VALUES,
  ORGANIZATION_TYPE_VALUES,
  ROLE_CATEGORY_VALUES,
} from "./types";

const SENIORITY_VALUES = [
  "c_level",
  "vp",
  "director",
  "manager",
  "principal",
  "ic",
  "senior_ic",
  "staff",
  "founder",
  "owner",
  "founder_owner",
  "investor",
  "student",
  "unknown",
] as const;

const PROFILE_FLAG_VALUES = [
  "advisor_signal",
  "affiliation_signal",
  "ambiguous_employment",
  "ambiguous_professional_identity",
  "board_member_signal",
  "career_transition_signal",
  "coach_signal",
  "consultant_signal",
  "early_career_signal",
  "early_team_signal",
  "education_signal",
  "ex_company_signal",
  "former_intern_signal",
  "founding_engineer_signal",
  "founder_signal",
  "freelance_signal",
  "informal_title_signal",
  "investor_signal",
  "job_search_signal",
  "job_seeker_signal",
  "junior_or_intern_signal",
  "multiple_roles_signal",
  "multiple_current_roles",
  "non_target_function_signal",
  "open_to_work_public_signal",
  "open_to_work_text_signal",
  "past_founder_signal",
  "past_role_signal",
  "recruiter_signal",
  "solo_operator_signal",
  "student_signal",
  "typo_signal",
  "url_or_handle_signal",
  "weak_evidence",
  "weak_post_context_signal",
] as const;

function clip(s: string, max: number): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length <= max ? t : `${t.slice(0, max).trim()}…`;
}

function formatPostContextOnly(evidence: ProspectEvidence[]): string {
  return evidence
    .filter((e) => e.source !== "linkedin_author_headline")
    .map((e, i) => {
      const meta =
        e.metadata && Object.keys(e.metadata).length > 0
          ? ` meta=${JSON.stringify(e.metadata).slice(0, 300)}`
          : "";
      return `[ctx-${i}] source=${e.source} confidence=${e.confidence}${meta}\n${clip(e.rawText, 800)}`;
    })
    .join("\n\n");
}

function formatDeterministicContextBlock(ctx: DeterministicProspectContext | undefined): string {
  if (!ctx) return "(no structured deterministic context supplied)";
  return JSON.stringify(
    {
      originalHeadline: ctx.originalHeadline,
      normalizedHeadline: ctx.normalizedHeadline,
      headlineForParsing: ctx.headlineForParsing,
      segments: ctx.segments,
      extractionCandidates: ctx.extractionCandidates,
      guardrailFindings: ctx.guardrailFindings,
      explicitFounderEvidence: ctx.explicitFounderEvidence,
      foundingEngineerHeadline: ctx.foundingEngineerHeadline,
      explicitRecruiterHeadline: ctx.explicitRecruiterHeadline,
      explicitSelfOpenToWorkPhrase: ctx.explicitSelfOpenToWorkPhrase,
      postContextNote: ctx.postContextNote,
    },
    null,
    0
  );
}

function summarizeDraft(draft: ProspectClassification): string {
  return JSON.stringify(
    {
      currentTitle: draft.currentTitle,
      currentCompany: draft.currentCompany,
      pastTitle: draft.pastTitle,
      pastCompany: draft.pastCompany,
      employmentConfidence: draft.employmentConfidence,
      educationInstitution: draft.educationInstitution,
      educationArea: draft.educationArea,
      affiliations: draft.affiliations,
      roleCategories: draft.roleCategories,
      profileFlags: draft.profileFlags,
      excludedRoleFlags: draft.excludedRoleFlags,
      seniority: draft.seniority,
      functionTags: draft.functionTags,
      companyType: draft.companyType,
      employmentRelationship: draft.employmentRelationship,
      openToWorkStatus: draft.openToWorkDetection?.status,
      safeProfessionalReference: draft.safeProfessionalReference,
      professionalSummary: draft.professionalSummary,
      classificationNeedsReview: draft.classificationNeedsReview,
      needsReview: draft.needsReview,
    },
    null,
    0
  );
}

/** Merge LLM semantic patches onto deterministic draft; keep OTW / job-seeker guardrails from draft. */
export function mergeLlmPatchesIntoClassification(
  draft: ProspectClassification,
  patches: Partial<ProspectClassification>
): ProspectClassification {
  const merged: ProspectClassification = {
    ...draft,
    ...patches,
    evidence: draft.evidence,
    openToWorkDetection: draft.openToWorkDetection,
  };

  if (patches.roleCategories) merged.roleCategories = [...patches.roleCategories];
  if (patches.functionTags) merged.functionTags = [...patches.functionTags];
  if (patches.profileFlags) merged.profileFlags = [...patches.profileFlags];
  if (patches.excludedRoleFlags) merged.excludedRoleFlags = [...patches.excludedRoleFlags];
  if (patches.outreachTags) merged.outreachTags = [...patches.outreachTags];
  if (patches.affiliations) merged.affiliations = [...patches.affiliations];
  if (patches.marketSegmentTerms) merged.marketSegmentTerms = [...patches.marketSegmentTerms];

  const otwProfileFlags = new Set([
    "open_to_work_public_signal",
    "open_to_work_text_signal",
    "job_search_signal",
  ]);
  const pf = new Set(merged.profileFlags);
  for (const f of draft.profileFlags) {
    if (otwProfileFlags.has(f)) pf.add(f);
  }
  merged.profileFlags = [...pf];

  const ex = new Set(merged.excludedRoleFlags);
  for (const f of draft.excludedRoleFlags) {
    if (f === "open_to_work") ex.add(f);
  }
  merged.excludedRoleFlags = [...ex];

  const rc = new Set(merged.roleCategories);
  if (draft.roleCategories.includes("job_seeker")) rc.add("job_seeker");
  merged.roleCategories = [...rc];

  if (patches.classificationNeedsReview !== undefined) {
    merged.classificationNeedsReview = patches.classificationNeedsReview;
    merged.needsReview = patches.classificationNeedsReview;
  }

  const parsed = safeParseProspectClassificationJson(merged);
  if (parsed.success) return parsed.data;
  return draft;
}

const SYSTEM_PROMPT = `You refine LinkedIn prospect classifications. You receive deterministic evidence extraction, guardrail findings, and a DRAFT JSON baseline.

Return JSON ONLY:
{
  "patches": {
    "roleCategories": string[],
    "functionTags": string[],
    "profileFlags": string[],
    "seniority": string,
    "safeProfessionalReference": string | null,
    "professionalSummary": string | null,
    "currentTitle": string | null,
    "currentCompany": string | null,
    "pastTitle": string | null,
    "pastCompany": string | null,
    "educationInstitution": string | null,
    "educationArea": string | null,
    "affiliations": string[],
    "employmentRelationship": string,
    "companyType": string,
    "classificationNeedsReview": boolean
  },
  "llmReason": string
}

Rules:
- Use ONLY enum values provided in the user message for roleCategories, functionTags, profileFlags, seniority, employmentRelationship, companyType.
- Do NOT make routing or filtering decisions; classify professional context only.
- Do NOT change open-to-work / job-seeker labeling; draft OTW fields are authoritative.
- Assign founder / founder_signal only when explicitFounderEvidence is true in deterministic context.
- NOT founder from: founding engineer, builder, creator, CEO alone, investor, venture investor, chief of staff to the founder.
- Prefer specific safeProfessionalReference over generic phrases like "your professional background".
- Post/comment context is background only — never proof of employment or Open-to-Work.
- If employment is ambiguous, null currentTitle/currentCompany and set classificationNeedsReview true.
- Include "unknown" in roleCategories only when no professional role can be inferred.`;

export async function reconcileProspectClassificationWithOpenAi(
  input: LlmReconcileInput,
  options?: { modelKind?: OpenAIChatModelKind; temperature?: number }
): Promise<{ classification: ProspectClassification; reconcile: LlmReconcileOutput }> {
  const ctx = input.deterministicContext;
  const invokeNote =
    input.invokeReasons?.length ? `LLM invoked because: ${input.invokeReasons.join(", ")}` : "";

  const user = `ALLOWED roleCategories (${ROLE_CATEGORY_VALUES.length} values):
${JSON.stringify(ROLE_CATEGORY_VALUES)}

ALLOWED functionTags:
${JSON.stringify(FUNCTION_TAG_VALUES)}

ALLOWED profileFlags:
${JSON.stringify(PROFILE_FLAG_VALUES)}

ALLOWED seniority: ${JSON.stringify(SENIORITY_VALUES)}
ALLOWED employmentRelationship: ${JSON.stringify(EMPLOYMENT_RELATIONSHIP_VALUES)}
ALLOWED companyType: ${JSON.stringify(ORGANIZATION_TYPE_VALUES)}

${invokeNote}

--- DETERMINISTIC CONTEXT (evidence + guardrails) ---
${formatDeterministicContextBlock(ctx)}

--- DETERMINISTIC DRAFT (baseline; preserve OTW fields) ---
${summarizeDraft(input.draftClassification)}

--- POST/COMMENT CONTEXT (not proof of employment or OTW) ---
${formatPostContextOnly(input.evidence)}

Return patches that improve roleCategories, functionTags, seniority, summaries, and employment fields when justified by headline evidence and deterministic context.`;

  const raw = await openaiChatJsonObject({
    modelKind: options?.modelKind ?? "default",
    temperature: options?.temperature ?? 0.15,
    maxTokens: 2200,
    system: SYSTEM_PROMPT,
    user,
  });

  const patchesRaw = (raw.patches ?? raw) as Record<string, unknown>;
  const patches = patchesRaw as Partial<ProspectClassification>;
  const llmReason = typeof raw.llmReason === "string" ? raw.llmReason.trim() : "";

  const reconcile: LlmReconcileOutput = {
    patches,
    citations: [],
  };

  let classification = mergeLlmPatchesIntoClassification(input.draftClassification, patches);
  classification = {
    ...classification,
    classifierVersion: `${input.draftClassification.classifierVersion ?? "1.0.0"}-llm`,
    reason: llmReason
      ? `${input.draftClassification.reason} [llm] ${llmReason}`.trim()
      : `${input.draftClassification.reason} [llm-reconciled]`.trim(),
  };

  return { classification, reconcile };
}

export const openAiProspectLlmReconciler: ProspectLlmReconciler = {
  async reconcile(input) {
    const { reconcile } = await reconcileProspectClassificationWithOpenAi(input);
    return reconcile;
  },
};

/**
 * Full hybrid path (deterministic + gated LLM + post-validation).
 * Requires OPENAI_API_KEY when LLM reconciliation runs.
 */
export async function classifyProspectWithOpenAi(
  evidence: ProspectEvidence[],
  options: ClassifierOptions = {}
): Promise<ProspectClassification> {
  const result = await classifyProspect(evidence, { ...options, mode: "full" });
  return result.classification;
}
