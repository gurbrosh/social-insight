import { z } from "zod";
import {
  ROLE_CATEGORY_ENUM,
  FUNCTION_TAG_ENUM,
  ORGANIZATION_TYPE_ENUM,
  EMPLOYMENT_RELATIONSHIP_ENUM,
  type OrganizationType,
  type ProspectClassification,
} from "./types";

const evidenceSourceSchema = z.enum([
  "linkedin_author_headline",
  "linkedin_author_metadata",
  "linkedin_extra_json",
  "linkedin_profile_experience",
  "source_post_text",
  "source_comment_text",
  "existing_db_record",
  "manual_override",
  "search_snippet",
  "public_profile_fetch",
  "enrichment_vendor",
  "llm_reconciler",
]);

export const prospectEvidenceSchema = z.object({
  id: z.string().optional(),
  source: evidenceSourceSchema,
  sourceUrl: z.string().optional(),
  rawText: z.string(),
  extractedSignals: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  observedAt: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const roleCategorySchema = z.enum(ROLE_CATEGORY_ENUM);

const profileFlagSchema = z.enum([
  "advisor_signal",
  "affiliation_signal",
  "ambiguous_employment",
  "ambiguous_professional_identity",
  "board_member_signal",
  "career_transition_signal",
  "coach_signal",
  "commercial_non_core_signal",
  "competitor_signal",
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
  "micro_employer_signal",
  "multiple_roles_signal",
  "multiple_current_roles",
  "non_target_function_signal",
  "open_to_work_public_signal",
  "open_to_work_text_signal",
  "past_founder_signal",
  "past_role_signal",
  "platform_manager_signal",
  "possible_small_business",
  "recruiter_signal",
  "retired_signal",
  "solo_operator_signal",
  "student_signal",
  "typo_signal",
  "url_or_handle_signal",
  "weak_evidence",
  "weak_post_context_signal",
]);

const senioritySchema = z.enum([
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
]);

const functionTagSchema = z.enum(FUNCTION_TAG_ENUM);

const exclusionFlagSchema = z.enum([
  "solo_operator",
  "consultant",
  "recruiter",
  "competitor",
  "open_to_work",
  "investor",
  "student",
  "low_seniority",
  "wrong_function",
  "company_too_small",
  "insufficient_evidence",
  "non_buyer",
  "low_relevance",
]);

const companySizeSignalSchema = z.enum([
  "solo",
  "tiny",
  "startup",
  "mid_market",
  "enterprise",
  "unknown",
]);

const routingRecommendationSchema = z.enum([
  "unrouted",
  "email_outreach",
  "linkedin_outreach",
  "both",
  "exclude",
  "manual_review",
  "investor_nurture",
  "competitor_watch",
]);

const routeActionTargetSchema = routingRecommendationSchema.exclude(["unrouted"]);

const organizationTypeSchema = z
  .union([
    z.enum(ORGANIZATION_TYPE_ENUM),
    /** Legacy persisted values */
    z.literal("education"),
    z.literal("employer"),
  ])
  .optional()
  .nullable()
  .transform((x): OrganizationType | null => {
    if (x == null || x === "unknown") return "unknown";
    if (x === "education") return "unknown";
    if (x === "employer") return "commercial_employer";
    return x;
  });

const employmentRelationshipSchema = z.enum(EMPLOYMENT_RELATIONSHIP_ENUM);

const openToWorkStatusSchema = z.enum([
  "public_signal_detected",
  "text_signal_detected",
  "not_observed",
  "unknown",
]);

const openToWorkEvidenceSourceSchema = z.enum([
  "headline",
  "profile_metadata",
  "image_alt_text",
  "badge_metadata",
  "author_metadata",
  "source_post_text",
  "source_comment_text",
]);

const openToWorkDetectionSchema = z.object({
  status: openToWorkStatusSchema,
  confidence: z.number().min(0).max(1),
  source: z.string().optional(),
  evidence: z.string().optional(),
  reason: z.string().optional(),
  evidenceSource: openToWorkEvidenceSourceSchema.optional(),
  evidenceSupporting: z.string().optional(),
});

const prospectClassificationSchemaRaw = z.object({
  personId: z.string().optional(),
  linkedinUrl: z.string().optional(),
  name: z.string().optional(),

  currentTitle: z.string().nullable().optional(),
  currentCompany: z.string().nullable().optional(),
  pastTitle: z.string().nullable().optional(),
  pastCompany: z.string().nullable().optional(),
  lastTitle: z.string().nullable().optional(),
  lastCompany: z.string().nullable().optional(),
  profileExperienceInputCount: z.number().int().min(0).optional(),
  headlineEmploymentCandidateTitle: z.string().nullable().optional(),
  headlineEmploymentCandidateCompany: z.string().nullable().optional(),
  currentRoles: z
    .array(z.object({ title: z.string(), company: z.string() }))
    .optional(),
  pastRoles: z
    .array(z.object({ title: z.string(), company: z.string() }))
    .optional(),
  employmentSource: z
    .enum(["profile_experience", "structured_profile", "headline", "unknown"])
    .optional(),
  employmentReason: z.string().nullable().optional(),
  employmentConfidence: z.number().min(0).max(1),

  educationInstitution: z.string().nullable().optional(),
  educationArea: z.string().nullable().optional(),
  affiliations: z.array(z.string()).optional(),

  professionalSummary: z.string().nullable(),
  safeProfessionalReference: z.string().nullable(),

  roleCategories: z.array(roleCategorySchema),
  profileFlags: z.array(profileFlagSchema).default([]),
  excludedRoleFlags: z.array(exclusionFlagSchema),
  outreachTags: z.array(z.string()),

  seniority: senioritySchema,
  functionTags: z.array(functionTagSchema),
  companySizeSignal: companySizeSignalSchema,
  marketSegmentTerms: z.array(z.string()).optional(),
  companyType: organizationTypeSchema,
  employmentRelationship: employmentRelationshipSchema.optional().default("unknown"),

  routingRecommendation: routingRecommendationSchema,
  confidence: z.number().min(0).max(1),
  classificationNeedsReview: z.boolean().optional(),
  employmentNeedsReview: z.boolean().optional(),
  outreachNeedsReview: z.boolean().optional(),
  needsReview: z.boolean().optional(),
  reason: z.string(),

  evidence: z.array(prospectEvidenceSchema),

  classifierVersion: z.string().optional(),

  openToWorkDetection: openToWorkDetectionSchema.optional(),
});

export const prospectClassificationSchema = prospectClassificationSchemaRaw.transform(
  (p): ProspectClassification => {
    const classificationNeedsReview = p.classificationNeedsReview ?? p.needsReview ?? false;
    return {
      ...p,
      classificationNeedsReview,
      needsReview: classificationNeedsReview,
    };
  }
);

const ruleConditionSchema: z.ZodType<import("./types").RuleCondition> = z.discriminatedUnion(
  "field",
  [
    z.object({
      field: z.literal("roleCategory"),
      op: z.enum(["in", "notIn"]),
      values: z.array(roleCategorySchema),
    }),
    z.object({
      field: z.literal("excludedRoleFlags"),
      op: z.enum(["in", "notIn"]),
      values: z.array(exclusionFlagSchema),
    }),
    z.object({
      field: z.literal("functionTags"),
      op: z.enum(["in", "notIn"]),
      values: z.array(functionTagSchema),
    }),
    z.object({
      field: z.literal("seniority"),
      op: z.enum(["eq", "in"]),
      values: z.array(senioritySchema),
    }),
    z.object({
      field: z.literal("companySizeSignal"),
      op: z.enum(["eq", "in"]),
      values: z.array(companySizeSignalSchema),
    }),
    z.object({
      field: z.literal("currentCompany"),
      op: z.literal("matchesAny"),
      patterns: z.array(z.string()),
    }),
    z.object({
      field: z.literal("currentTitle"),
      op: z.literal("containsAny"),
      keywords: z.array(z.string()),
    }),
    z.object({
      field: z.literal("headline"),
      op: z.literal("containsAny"),
      keywords: z.array(z.string()),
    }),
    z.object({ field: z.literal("platform"), op: z.literal("eq"), value: z.string() }),
    z.object({ field: z.literal("themeRelevance"), op: z.enum(["gte", "lte"]), value: z.number() }),
    z.object({
      field: z.literal("classificationConfidence"),
      op: z.enum(["gte", "lte", "between"]),
      value: z.number().optional(),
      max: z.number().optional(),
    }),
    z.object({
      field: z.literal("employmentConfidence"),
      op: z.enum(["gte", "lte"]),
      value: z.number(),
    }),
    z.object({ field: z.literal("competitorList"), op: z.literal("matched") }),
    z.object({ field: z.literal("investorFlag"), op: z.enum(["isTrue", "isFalse"]) }),
    z.object({ field: z.literal("openToWorkFlag"), op: z.enum(["isTrue", "isFalse"]) }),
    z.object({ field: z.literal("needsReview"), op: z.enum(["isTrue", "isFalse"]) }),
  ]
);

const prospectOutreachBucketSchema = z.enum([
  "email",
  "linkedin",
  "both",
  "investor_nurture",
  "competitor_watch",
  "excluded",
  "manual_review",
]);

const ruleActionSchema: z.ZodType<import("./types").RuleAction> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("exclude_from_outreach") }),
  z.object({ type: z.literal("manual_review") }),
  z.object({ type: z.literal("route"), target: routeActionTargetSchema }),
  z.object({ type: z.literal("set_bucket"), bucket: prospectOutreachBucketSchema }),
  z.object({ type: z.literal("add_tag"), tags: z.array(z.string()) }),
  z.object({ type: z.literal("assign_template"), templateId: z.string() }),
  z.object({ type: z.literal("assign_sequence"), sequenceId: z.string() }),
  z.object({ type: z.literal("suppress_title_company_personalization") }),
  z.object({ type: z.literal("require_manual_approval") }),
]);

export const prospectRoutingRuleDefinitionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  priority: z.number(),
  notes: z.string().optional(),
  conditionLogic: z.enum(["all", "any"]),
  conditions: z.array(ruleConditionSchema),
  actions: z.array(ruleActionSchema),
});

export function parseProspectClassificationJson(raw: unknown): ProspectClassification {
  return prospectClassificationSchema.parse(raw);
}

export function safeParseProspectClassificationJson(
  raw: unknown
): ReturnType<typeof prospectClassificationSchema.safeParse> {
  return prospectClassificationSchema.safeParse(raw);
}
