import { prisma } from "@/lib/prisma";
import { ulid } from "ulid";
import type { ProspectRoutingRuleDefinition, RoleCategory, OutreachTemplateDefinition } from "./types";

const DEFAULT_RULES: Omit<ProspectRoutingRuleDefinition, "id" | "projectId">[] = [
  {
    name: "Exclude students",
    enabled: true,
    priority: 8,
    conditionLogic: "all",
    conditions: [{ field: "roleCategory", op: "in", values: ["student"] }],
    actions: [{ type: "exclude_from_outreach" }],
  },
  {
    name: "Exclude recruiters",
    enabled: true,
    priority: 10,
    conditionLogic: "all",
    conditions: [{ field: "roleCategory", op: "in", values: ["recruiter"] }],
    actions: [{ type: "exclude_from_outreach" }],
  },
  {
    name: "Exclude open-to-work",
    enabled: true,
    priority: 15,
    conditionLogic: "all",
    conditions: [{ field: "openToWorkFlag", op: "isTrue" }],
    actions: [{ type: "exclude_from_outreach" }],
  },
  {
    name: "Exclude sales and legal non-target ICP",
    enabled: true,
    priority: 17,
    conditionLogic: "all",
    conditions: [
      {
        field: "roleCategory",
        op: "in",
        values: ["sales_account", "legal_counsel"],
      },
    ],
    actions: [{ type: "exclude_from_outreach" }],
  },
  {
    name: "Route investors to nurture",
    enabled: true,
    priority: 20,
    conditionLogic: "all",
    conditions: [{ field: "investorFlag", op: "isTrue" }],
    actions: [
      { type: "route", target: "investor_nurture" },
      { type: "set_bucket", bucket: "investor_nurture" },
    ],
  },
  {
    name: "Competitor watch",
    enabled: true,
    priority: 25,
    conditionLogic: "all",
    conditions: [{ field: "competitorList", op: "matched" }],
    actions: [
      { type: "route", target: "competitor_watch" },
      { type: "set_bucket", bucket: "competitor_watch" },
      { type: "exclude_from_outreach" },
    ],
  },
  {
    name: "Exclude solo or tiny signals",
    enabled: true,
    priority: 30,
    conditionLogic: "any",
    conditions: [
      { field: "excludedRoleFlags", op: "in", values: ["solo_operator"] },
      { field: "companySizeSignal", op: "in", values: ["solo", "tiny"] },
    ],
    actions: [{ type: "exclude_from_outreach" }],
  },
  {
    name: "Low classification confidence — manual review",
    enabled: true,
    priority: 35,
    conditionLogic: "all",
    conditions: [{ field: "classificationConfidence", op: "lte", value: 0.44 }],
    actions: [{ type: "manual_review" }],
  },
  {
    name: "Classifier flagged needs review",
    enabled: true,
    priority: 40,
    conditionLogic: "all",
    conditions: [{ field: "needsReview", op: "isTrue" }],
    actions: [{ type: "manual_review" }],
  },
  {
    name: "Consultant / fractional — manual review",
    enabled: true,
    priority: 42,
    conditionLogic: "all",
    conditions: [{ field: "roleCategory", op: "in", values: ["consultant"] }],
    actions: [{ type: "manual_review" }],
  },
  {
    name: "Engineering leaders to email when confident",
    enabled: true,
    priority: 100,
    conditionLogic: "all",
    conditions: [
      { field: "roleCategory", op: "in", values: ["engineering_leader"] },
      { field: "seniority", op: "in", values: ["c_level", "vp", "director"] },
      { field: "classificationConfidence", op: "gte", value: 0.58 },
      { field: "needsReview", op: "isFalse" },
    ],
    actions: [
      { type: "set_bucket", bucket: "email" },
      { type: "route", target: "email_outreach" },
    ],
  },
  {
    name: "Qualified technical buyers — LinkedIn (high relevance)",
    enabled: true,
    priority: 120,
    conditionLogic: "all",
    conditions: [
      { field: "themeRelevance", op: "gte", value: 72 },
      { field: "classificationConfidence", op: "gte", value: 0.52 },
      { field: "needsReview", op: "isFalse" },
      {
        field: "roleCategory",
        op: "in",
        values: [
          "engineering_leader",
          "security_leader",
          "technical_influencer",
          "platform_engineer",
          "ai_engineer",
          "target_buyer",
          "security_practitioner",
        ],
      },
    ],
    actions: [
      { type: "set_bucket", bucket: "linkedin" },
      { type: "route", target: "linkedin_outreach" },
    ],
  },
];

const EMAIL_BODY = `Hi {{firstName}},

I appreciated your LinkedIn post about {{sourcePostTopic}}.

{{safeProfessionalReference}} — I am reaching out because our product may align with challenges you discussed publicly.

{{productAngle}}

Would you be open to a brief conversation?

Thanks`;

const DEFAULT_TEMPLATES: Omit<OutreachTemplateDefinition, "id" | "projectId">[] = [
  {
    name: "Engineering leader initial (email)",
    channel: "email",
    templateType: "email_initial",
    appliesToRoleCategories: ["engineering_leader"] as RoleCategory[],
    appliesToFunctionTags: ["engineering"],
    appliesToSeniority: ["c_level", "vp", "director"],
    employmentConfidenceThreshold: 0.72,
    requiresHighConfidenceEmployment: false,
    requiresSourcePostContext: true,
    subjectTemplate: "Your post about {{sourcePostTopic}}",
    bodyTemplate: EMAIL_BODY,
    variables: [
      "firstName",
      "safeProfessionalReference",
      "sourcePostTopic",
      "sourcePostUrl",
      "productAngle",
    ],
    fallbackBehavior: {
      ifNoCompany: "useSafeReference",
      ifNoTitle: "useRoleCategory",
      ifLowConfidence: "manualReview",
    },
    priority: 50,
    enabled: true,
  },
  {
    name: "Security leader initial (email)",
    channel: "email",
    templateType: "email_initial",
    appliesToRoleCategories: ["security_leader"] as RoleCategory[],
    appliesToFunctionTags: ["security"],
    employmentConfidenceThreshold: 0.72,
    requiresHighConfidenceEmployment: false,
    requiresSourcePostContext: true,
    subjectTemplate: "Security / {{sourcePostTopic}}",
    bodyTemplate: EMAIL_BODY,
    variables: ["firstName", "safeProfessionalReference", "sourcePostTopic", "productAngle"],
    fallbackBehavior: {
      ifNoCompany: "useSafeReference",
      ifNoTitle: "omit",
      ifLowConfidence: "manualReview",
    },
    priority: 55,
    enabled: true,
  },
  {
    name: "Technical influencer soft ask (email)",
    channel: "email",
    templateType: "email_initial",
    appliesToRoleCategories: ["technical_influencer"] as RoleCategory[],
    appliesToFunctionTags: [],
    employmentConfidenceThreshold: 0.75,
    requiresHighConfidenceEmployment: false,
    requiresSourcePostContext: true,
    subjectTemplate: "Thoughts on {{sourcePostTopic}}",
    bodyTemplate: EMAIL_BODY,
    variables: ["firstName", "sourcePostTopic", "safeProfessionalReference", "productAngle"],
    fallbackBehavior: {
      ifNoCompany: "omit",
      ifNoTitle: "omit",
      ifLowConfidence: "useGenericTemplate",
    },
    priority: 120,
    enabled: true,
  },
  {
    name: "Investor nurture note (email)",
    channel: "email",
    templateType: "investor_note",
    appliesToRoleCategories: ["investor"] as RoleCategory[],
    appliesToFunctionTags: ["investor"],
    employmentConfidenceThreshold: 0.8,
    requiresHighConfidenceEmployment: false,
    requiresSourcePostContext: false,
    subjectTemplate: "Quick update — {{productAngle}}",
    bodyTemplate: `Hi {{firstName}},

Given your focus as {{safeProfessionalReference}}, sharing a short note on {{productAngle}}.

Happy to send more detail if useful.`,
    variables: ["firstName", "safeProfessionalReference", "productAngle"],
    fallbackBehavior: {
      ifNoCompany: "omit",
      ifNoTitle: "omit",
      ifLowConfidence: "useGenericTemplate",
    },
    priority: 40,
    enabled: true,
  },
  {
    name: "Manual review generic (email)",
    channel: "email",
    templateType: "manual_review_note",
    appliesToRoleCategories: [],
    appliesToFunctionTags: [],
    employmentConfidenceThreshold: 0.9,
    requiresHighConfidenceEmployment: false,
    requiresSourcePostContext: true,
    subjectTemplate: "Review: {{sourcePostTopic}}",
    bodyTemplate: `[Manual review suggested]

Context: {{safeProfessionalReference}}
Post: {{sourcePostUrl}}
Topic: {{sourcePostTopic}}`,
    variables: ["safeProfessionalReference", "sourcePostTopic", "sourcePostUrl"],
    fallbackBehavior: {
      ifNoCompany: "useSafeReference",
      ifNoTitle: "useRoleCategory",
      ifLowConfidence: "manualReview",
    },
    priority: 900,
    enabled: true,
  },
  {
    name: "LinkedIn connection (post context)",
    channel: "linkedin",
    templateType: "connection_request",
    appliesToRoleCategories: [],
    appliesToFunctionTags: [],
    employmentConfidenceThreshold: 0.75,
    requiresHighConfidenceEmployment: false,
    requiresSourcePostContext: true,
    bodyTemplate: `Hi {{firstName}} — I appreciated your take on {{sourcePostTopic}}. I'd like to connect.`,
    variables: ["firstName", "sourcePostTopic"],
    fallbackBehavior: {
      ifNoCompany: "omit",
      ifNoTitle: "omit",
      ifLowConfidence: "useGenericTemplate",
    },
    priority: 100,
    enabled: true,
  },
  {
    name: "LinkedIn ambiguous manual review",
    channel: "linkedin",
    templateType: "manual_review_note",
    appliesToRoleCategories: [],
    appliesToFunctionTags: [],
    employmentConfidenceThreshold: 0.99,
    requiresHighConfidenceEmployment: false,
    requiresSourcePostContext: true,
    bodyTemplate: `[Review] {{safeProfessionalReference}} — {{sourcePostUrl}}`,
    variables: ["safeProfessionalReference", "sourcePostUrl"],
    fallbackBehavior: {
      ifNoCompany: "useSafeReference",
      ifNoTitle: "useRoleCategory",
      ifLowConfidence: "manualReview",
    },
    priority: 950,
    enabled: true,
  },
];

export async function seedProspectIntelligenceDefaults(projectId: string): Promise<void> {
  const ruleCount = await prisma.prospectRoutingRule.count({
    where: { project_id: projectId, deleted_at: null },
  });
  if (ruleCount === 0) {
    for (const r of DEFAULT_RULES) {
      await prisma.prospectRoutingRule.create({
        data: {
          id: ulid(),
          project_id: projectId,
          name: r.name,
          enabled: r.enabled,
          priority: r.priority,
          notes: r.notes ?? null,
          condition_logic: r.conditionLogic,
          conditions_json: JSON.stringify(r.conditions),
          actions_json: JSON.stringify(r.actions),
        },
      });
    }
  }

  const tplCount = await prisma.outreachTemplate.count({
    where: { project_id: projectId, deleted_at: null },
  });
  if (tplCount === 0) {
    for (const t of DEFAULT_TEMPLATES) {
      await prisma.outreachTemplate.create({
        data: {
          id: ulid(),
          project_id: projectId,
          name: t.name,
          channel: t.channel,
          template_type: t.templateType,
          applies_to_role_categories_json: JSON.stringify(t.appliesToRoleCategories),
          applies_to_function_tags_json: JSON.stringify(t.appliesToFunctionTags),
          applies_to_seniority_json: t.appliesToSeniority ? JSON.stringify(t.appliesToSeniority) : null,
          employment_confidence_threshold: t.employmentConfidenceThreshold,
          requires_high_confidence_employment: t.requiresHighConfidenceEmployment,
          requires_source_post_context: t.requiresSourcePostContext,
          subject_template: t.subjectTemplate ?? null,
          body_template: t.bodyTemplate,
          variables_json: JSON.stringify(t.variables),
          fallback_behavior_json: JSON.stringify(t.fallbackBehavior),
          priority: t.priority,
          enabled: t.enabled,
        },
      });
    }
  }
}
