import { prisma } from "@/lib/prisma";
import { ulid } from "ulid";
import { classifyProspectDeterministic, mergeClassificationWithLocks } from "./classify";
import type {
  ProspectClassification,
  ProspectEvidence,
  ProspectOutreachBucket,
  ProspectRoutingRuleDefinition,
  RuleEngineInput,
} from "./types";
import { prospectRoutingRuleDefinitionSchema, parseProspectClassificationJson } from "./schemas";
import { gatherEvidenceFromPostRow, evidenceContentHash, mergePublicProfileScrapeEvidence } from "./gather-evidence";
import { evaluateRoutingRules } from "./rule-engine";
import { normalizePublicProfileUrl } from "@/lib/linkedin-prospects-csv/normalize-url";
import { getLinkedInAuthorFromExtraJson } from "@/lib/linkedin-prospects-csv/extra-json";
import type { LinkedInPublicProfileScrape } from "@/lib/linkedin-prospects-csv/fetch-linkedin-public-profile";

export async function loadCompetitorPatternsForProject(projectId: string): Promise<string[]> {
  const settings = await prisma.prospectIntelligenceSettings.findFirst({
    where: { project_id: projectId, deleted_at: null },
  });
  const listIds: string[] = [];
  if (settings?.default_competitor_list_id) {
    listIds.push(settings.default_competitor_list_id);
  }
  const lists = await prisma.competitorList.findMany({
    where: { project_id: projectId, deleted_at: null },
    select: { id: true },
  });
  for (const l of lists) {
    if (!listIds.includes(l.id)) listIds.push(l.id);
  }
  if (listIds.length === 0) return [];
  const entries = await prisma.competitorListEntry.findMany({
    where: { competitor_list_id: { in: listIds }, deleted_at: null },
    select: { pattern: true },
  });
  return entries.map((e) => e.pattern).filter(Boolean);
}

function prismaRuleToDefinition(row: {
  id: string;
  project_id: string;
  name: string;
  enabled: boolean;
  priority: number;
  notes: string | null;
  condition_logic: string;
  conditions_json: string;
  actions_json: string;
}): ProspectRoutingRuleDefinition {
  const conditions = JSON.parse(row.conditions_json) as unknown;
  const actions = JSON.parse(row.actions_json) as unknown;
  return prospectRoutingRuleDefinitionSchema.parse({
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    enabled: row.enabled,
    priority: row.priority,
    notes: row.notes ?? undefined,
    conditionLogic: row.condition_logic === "any" ? "any" : "all",
    conditions,
    actions,
  });
}

export async function fetchActiveRoutingRules(
  projectId: string
): Promise<ProspectRoutingRuleDefinition[]> {
  const rows = await prisma.prospectRoutingRule.findMany({
    where: { project_id: projectId, deleted_at: null },
    orderBy: { priority: "asc" },
  });
  return rows.map(prismaRuleToDefinition);
}

export type SyncProspectParams = {
  projectId: string;
  themesAnalysisId: string;
  postId: number;
  themeItemResponseId?: string | null;
  platform: string;
  themeRelevancePercent: number | null;
  authorName: string | null;
  headlineFallback?: string | null;
  /** Optional anonymous public profile scrape (low trust). */
  publicProfileScrape?: LinkedInPublicProfileScrape | null;
};

export async function syncProspectCandidateForThemeRow(
  params: SyncProspectParams
): Promise<{
  identityId: string;
  candidateId: string;
  classification: ProspectClassification;
  headlineForRules: string;
  ruleTrace: ReturnType<typeof evaluateRoutingRules>;
}> {
  const ta = await prisma.themesAnalysis.findFirst({
    where: { id: params.themesAnalysisId, project_id: params.projectId, deleted_at: null },
  });
  if (!ta) {
    throw new Error(`ThemesAnalysis not found: ${params.themesAnalysisId}`);
  }

  const post = await prisma.post.findFirst({
    where: { id: params.postId, project_id: params.projectId },
  });
  if (!post) {
    throw new Error(`Post not found: ${params.postId}`);
  }

  let inMemoryEvidence = gatherEvidenceFromPostRow({
    extraJson: post.extraJson,
    authorName: post.authorName ?? params.authorName,
    content: post.content,
    url: post.url,
    platform: params.platform,
    themePostContent: ta.post_content,
    postUrlFromTheme: ta.post_url,
  });
  inMemoryEvidence = mergePublicProfileScrapeEvidence(
    inMemoryEvidence,
    params.publicProfileScrape ?? null
  );

  const { profileUrl: rawProfile, headline: exHead } = getLinkedInAuthorFromExtraJson(post.extraJson);
  let href = rawProfile ? normalizePublicProfileUrl(String(rawProfile)) : null;

  if (!href) {
    throw new Error("No canonical LinkedIn profile URL on post; cannot sync prospect identity.");
  }

  const identity = await prisma.prospectIdentity.upsert({
    where: {
      project_id_linkedin_url_normalized: {
        project_id: params.projectId,
        linkedin_url_normalized: href,
      },
    },
    create: {
      id: ulid(),
      project_id: params.projectId,
      linkedin_url_normalized: href,
      display_name: post.authorName ?? params.authorName ?? undefined,
      primary_platform: params.platform,
    },
    update: {
      display_name: post.authorName ?? params.authorName ?? undefined,
      primary_platform: params.platform,
      updated_at: new Date(),
    },
  });

  await persistEvidenceRecords(identity.id, inMemoryEvidence);

  const competitorPatterns = await loadCompetitorPatternsForProject(params.projectId);

  const headlineFromEvidence =
    inMemoryEvidence.find((e) => e.source === "linkedin_author_headline")?.rawText ??
    exHead ??
    params.headlineFallback ??
    "";

  let classification = classifyProspectDeterministic(inMemoryEvidence, {
    linkedinUrl: href,
    name: post.authorName ?? params.authorName ?? undefined,
    competitorPatterns,
  });

  if (identity.manual_classification_locked && identity.locked_fields_json) {
    try {
      const locked = new Set<string>(JSON.parse(identity.locked_fields_json) as string[]);
      const snap = await prisma.prospectClassificationSnapshot.findFirst({
        where: { prospect_identity_id: identity.id, superseded_at: null, deleted_at: null },
        orderBy: { computed_at: "desc" },
      });
      if (snap?.manual_override_classification_json) {
        const override = parseProspectClassificationJson(
          JSON.parse(snap.manual_override_classification_json)
        );
        classification = mergeClassificationWithLocks(classification, override, locked);
      }
    } catch {
      /* ignore */
    }
  }

  await supersedeAndCreateSnapshot(identity.id, classification);

  const relevanceFloat =
    params.themeRelevancePercent != null ? params.themeRelevancePercent / 100 : null;
  let tirId = params.themeItemResponseId ?? null;
  if (!tirId) {
    const first = await prisma.themeItemResponse.findFirst({
      where: { themes_analysis_id: params.themesAnalysisId, deleted_at: null },
      orderBy: { relevance_score: "desc" },
      select: { id: true },
    });
    tirId = first?.id ?? null;
  }

  let candidate = await prisma.prospectCandidate.findFirst({
    where: {
      project_id: params.projectId,
      themes_analysis_id: params.themesAnalysisId,
      prospect_identity_id: identity.id,
      deleted_at: null,
    },
  });

  if (!candidate) {
    candidate = await prisma.prospectCandidate.create({
      data: {
        id: ulid(),
        project_id: params.projectId,
        prospect_identity_id: identity.id,
        themes_analysis_id: params.themesAnalysisId,
        post_id: params.postId,
        theme_item_response_id: tirId,
        relevance_score_cached: relevanceFloat,
        platform: params.platform,
        headline_snapshot: headlineFromEvidence.slice(0, 500),
      },
    });
  } else {
    candidate = await prisma.prospectCandidate.update({
      where: { id: candidate.id },
      data: {
        post_id: params.postId,
        theme_item_response_id: tirId,
        relevance_score_cached: relevanceFloat,
        platform: params.platform,
        headline_snapshot: headlineFromEvidence.slice(0, 500),
        updated_at: new Date(),
      },
    });
  }

  const rules = await fetchActiveRoutingRules(params.projectId);
  const headlineForRules = headlineFromEvidence;
  const competitorMatched =
    classification.roleCategories.includes("competitor") ||
    classification.excludedRoleFlags.includes("competitor");

  const ruleInput: RuleEngineInput = {
    classification,
    platform: params.platform,
    themeRelevancePercent: params.themeRelevancePercent,
    headlineText: headlineForRules,
    competitorMatched,
  };

  const ruleTrace = evaluateRoutingRules(rules, ruleInput);

  if (!identity.manual_routing_locked) {
    await prisma.outreachBucketAssignment.updateMany({
      where: { prospect_candidate_id: candidate.id, deleted_at: null },
      data: { deleted_at: new Date() },
    });
    const bucket = ruleTrace.bucket ?? "manual_review";
    const status =
      bucket === "excluded" ? "excluded" : ruleTrace.requireManualApproval ? "pending_review" : "draft";
    const matchedRule = ruleTrace.matchedRuleId
      ? await prisma.prospectRoutingRule.findFirst({
          where: { id: ruleTrace.matchedRuleId },
          select: { rule_version: true },
        })
      : null;
    await prisma.outreachBucketAssignment.create({
      data: {
        id: ulid(),
        prospect_candidate_id: candidate.id,
        bucket,
        status,
        rule_id_matched: ruleTrace.matchedRuleId,
        rule_version: matchedRule?.rule_version ?? null,
        reason: ruleTrace.reason,
        template_id: ruleTrace.templateId,
        suppress_title_company: ruleTrace.suppressTitleCompanyPersonalization,
        require_manual_approval: ruleTrace.requireManualApproval,
      },
    });
  }

  return {
    identityId: identity.id,
    candidateId: candidate.id,
    classification,
    headlineForRules,
    ruleTrace,
  };
}

async function persistEvidenceRecords(identityId: string, items: ProspectEvidence[]): Promise<void> {
  for (const ev of items) {
    const hash = evidenceContentHash(ev.source, ev.rawText, ev.sourceUrl);
    const exists = await prisma.prospectEvidenceRecord.findFirst({
      where: {
        prospect_identity_id: identityId,
        content_hash: hash,
        deleted_at: null,
      },
    });
    if (exists) continue;
    await prisma.prospectEvidenceRecord.create({
      data: {
        id: ulid(),
        prospect_identity_id: identityId,
        source: ev.source,
        source_url: ev.sourceUrl ?? null,
        raw_text: ev.rawText,
        extracted_signals_json: JSON.stringify(ev.extractedSignals ?? []),
        confidence: ev.confidence,
        observed_at: new Date(ev.observedAt),
        content_hash: hash,
        metadata_json: ev.metadata ? JSON.stringify(ev.metadata) : null,
      },
    });
  }
}

async function supersedeAndCreateSnapshot(
  identityId: string,
  classification: ProspectClassification
): Promise<void> {
  await prisma.prospectClassificationSnapshot.updateMany({
    where: { prospect_identity_id: identityId, superseded_at: null, deleted_at: null },
    data: { superseded_at: new Date() },
  });
  await prisma.prospectClassificationSnapshot.create({
    data: {
      id: ulid(),
      prospect_identity_id: identityId,
      classifier_version: classification.classifierVersion ?? "1.0.0",
      classification_json: JSON.stringify(classification),
      employment_confidence: classification.employmentConfidence,
      overall_confidence: classification.confidence,
      needs_review: classification.needsReview,
      routing_recommendation: classification.routingRecommendation,
    },
  });
}

export async function ensureProspectIntelligenceSettings(projectId: string): Promise<void> {
  const existing = await prisma.prospectIntelligenceSettings.findFirst({
    where: { project_id: projectId, deleted_at: null },
  });
  if (!existing) {
    await prisma.prospectIntelligenceSettings.create({
      data: {
        id: ulid(),
        project_id: projectId,
      },
    });
  }
  const { seedProspectIntelligenceDefaults } = await import("./default-seed");
  await seedProspectIntelligenceDefaults(projectId);
}

export function outreachTemplateRowToDefinition(row: {
  id: string;
  project_id: string;
  name: string;
  channel: string;
  template_type: string;
  applies_to_role_categories_json: string;
  applies_to_function_tags_json: string;
  applies_to_seniority_json: string | null;
  employment_confidence_threshold: number;
  requires_high_confidence_employment: boolean;
  requires_source_post_context: boolean;
  subject_template: string | null;
  body_template: string;
  variables_json: string;
  fallback_behavior_json: string;
  priority: number;
  enabled: boolean;
}): import("./types").OutreachTemplateDefinition {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    channel: row.channel as "email" | "linkedin",
    templateType: row.template_type as import("./types").OutreachTemplateDefinition["templateType"],
    appliesToRoleCategories: JSON.parse(row.applies_to_role_categories_json) as import("./types").RoleCategory[],
    appliesToFunctionTags: JSON.parse(row.applies_to_function_tags_json) as string[],
    appliesToSeniority: row.applies_to_seniority_json
      ? (JSON.parse(row.applies_to_seniority_json) as import("./types").Seniority[])
      : undefined,
    employmentConfidenceThreshold: row.employment_confidence_threshold,
    requiresHighConfidenceEmployment: row.requires_high_confidence_employment,
    requiresSourcePostContext: row.requires_source_post_context,
    subjectTemplate: row.subject_template ?? undefined,
    bodyTemplate: row.body_template,
    variables: JSON.parse(row.variables_json) as import("./types").OutreachTemplateDefinition["variables"],
    fallbackBehavior: JSON.parse(row.fallback_behavior_json) as import("./types").OutreachTemplateDefinition["fallbackBehavior"],
    priority: row.priority,
    enabled: row.enabled,
  };
}

export async function fetchOutreachTemplateDefinitions(
  projectId: string
): Promise<import("./types").OutreachTemplateDefinition[]> {
  const rows = await prisma.outreachTemplate.findMany({
    where: { project_id: projectId, deleted_at: null },
  });
  return rows.map(outreachTemplateRowToDefinition);
}

export async function buildProspectIntelContextForOutreach(
  params: SyncProspectParams
): Promise<{
  projectId: string;
  classification: ProspectClassification;
  bucket: ProspectOutreachBucket;
  suppressTitleCompany: boolean;
} | null> {
  try {
    await ensureProspectIntelligenceSettings(params.projectId);
    const s = await syncProspectCandidateForThemeRow(params);
    return {
      projectId: params.projectId,
      classification: s.classification,
      bucket: s.ruleTrace.bucket ?? "manual_review",
      suppressTitleCompany: s.ruleTrace.suppressTitleCompanyPersonalization,
    };
  } catch {
    return null;
  }
}
