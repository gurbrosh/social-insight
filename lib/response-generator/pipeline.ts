import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getLinkedInAuthorFromExtraJson } from "@/lib/linkedin-prospects-csv/extra-json";
import { tryGenerateLinkedinOutreachForThemeItem } from "@/lib/linkedin-outreach/try-generate-outreach-for-theme-item";
import { buildProspectIntelContextForOutreach } from "@/lib/prospect-intelligence/pipeline";
import { linkedInMatchedPostPassesProspectSubstanceGate } from "@/lib/linkedin-outreach/evaluate-linkedin-comment-for-prospect";
import { isLinkedInPlatform } from "@/lib/utils/platform";
import { synthesizeConversationWithoutThemeAnalyses } from "@/lib/response-generator/conversation-without-theme-synthesis";
import { evaluateRelevance } from "@/lib/response-generator/relevance-service";
import { generateResponseText } from "@/lib/response-generator/response-service";
import { resolveSourceReplyForThemeRow } from "@/lib/response-generator/source-reply-resolve";
import { RESPONSE_RELEVANCE_THRESHOLD } from "@/lib/response-generator/relevance-threshold";
import { resolveContextTextsForThemeRows } from "@/lib/response-generator/theme-context-text";

export { RESPONSE_RELEVANCE_THRESHOLD } from "@/lib/response-generator/relevance-threshold";

const BATCH_SIZE = 50;

const LOG_PREFIX = "[response-generator]";

function trimForLog(s: string, maxLen = 500): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return "(empty)";
  return t.length <= maxLen ? t : `${t.slice(0, maxLen)}…`;
}

/** Count skipped LinkedIn supportive-only-thread comments once per theme row across objectives/batches. */
function recordLinkedInSupportiveProspectSkip(
  seenThemeIds: Set<string>,
  stats: ThemeResponseGeneratorStats,
  themeRowId: string,
  postId: number,
  contextLabel: string
) {
  if (seenThemeIds.has(themeRowId)) return;
  seenThemeIds.add(themeRowId);
  stats.skippedLinkedInSupportiveComment += 1;
  console.log(
    `${LOG_PREFIX} theme=${themeRowId} post=${postId} outcome=rejected_linkedIn_supportive_comment ` +
      `context=${contextLabel}`
  );
}

const MAX_STORED_GEN_ERR = 400;

function parseGenerationErrorsJson(v: unknown): Record<string, string> {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === "string" && val.trim()) out[k] = val.trim().slice(0, MAX_STORED_GEN_ERR);
  }
  return out;
}

export type ThemeResponseGeneratorStats = {
  /** Theme rows that counted toward `limit` (at least one objective allowed by source configuration). */
  processed: number;
  skippedHasResponse: number;
  skippedPlatform: number;
  /** Rows where every objective skipped due to source/platform configuration (not counted toward `limit`). */
  skippedRowAllSourcesExcluded: number;
  skippedLowRelevance: number;
  generated: number;
  /** Existing ThemeItemResponse rows that had empty `outreach_email_*` and received a new private email. */
  outreachBackfilled: number;
  /** LinkedIn thread comments skipped (supportive/no substance) — no cold outreach generated once per theme row). */
  skippedLinkedInSupportiveComment: number;
  errors: number;
  batches: number;
};

export type RunThemeResponseGeneratorOptions = {
  /** Max theme rows to consider (eligible-by-source rows count toward this). Ignored when `orchestrationRunId` is set (process all rows for that run). */
  limit?: number;
  /** Only process `ThemesAnalysis` rows from this orchestration run (post-sanitization incremental generation). */
  orchestrationRunId?: string;
};

/**
 * Synchronous pipeline: process theme matches in batches of 50, per objective,
 * skip existing rows, skip platform mismatch, relevance gate 0.7, then generate.
 */
export async function runThemeResponseGeneratorPipeline(
  projectId: string,
  options: RunThemeResponseGeneratorOptions = {}
): Promise<ThemeResponseGeneratorStats> {
  const stats: ThemeResponseGeneratorStats = {
    processed: 0,
    skippedHasResponse: 0,
    skippedPlatform: 0,
    skippedRowAllSourcesExcluded: 0,
    skippedLowRelevance: 0,
    generated: 0,
    outreachBackfilled: 0,
    skippedLinkedInSupportiveComment: 0,
    errors: 0,
    batches: 0,
  };

  const objectives = await prisma.responseObjective.findMany({
    where: { project_id: projectId, deleted_at: null },
  });

  const projectBrandRows = await prisma.projectBrand.findMany({
    where: { project_id: projectId, deleted_at: null, is_selected: true },
    select: { brand_name: true },
  });
  const projectBrandNames = projectBrandRows.map((r) => r.brand_name).filter(Boolean);

  const projectProduct = await prisma.project.findFirst({
    where: { id: projectId, deleted_at: null },
    select: {
      my_product_name: true,
      my_product_focus_text: true,
      my_product_reference_urls: true,
      my_product_summary_json: true,
    },
  });

  if (objectives.length === 0) {
    console.log(
      `${LOG_PREFIX} start project=${projectId} objectives=0 — nothing to do (add response objectives first)`
    );
    return stats;
  }

  const runId =
    options.orchestrationRunId != null && String(options.orchestrationRunId).trim() !== ""
      ? String(options.orchestrationRunId).trim()
      : undefined;

  const themeWhere = {
    project_id: projectId,
    deleted_at: null,
    ...(runId ? { orchestration_run_id: runId } : {}),
  };

  /** Run-scoped: process every theme row for this analysis run (no cap). */
  const maxTotal =
    runId != null
      ? undefined
      : options.limit != null && options.limit > 0
        ? options.limit
        : undefined;
  let cursor: { id: string } | undefined;

  console.log(
    `${LOG_PREFIX} begin project=${projectId} objectives=${objectives.length} ` +
      `objectiveNames=${objectives.map((o) => `"${o.name}"`).join(", ")} ` +
      `orchestrationRunId=${runId ?? "any"} themeRowLimit=${maxTotal ?? "all"} ` +
      `relevanceThreshold=${RESPONSE_RELEVANCE_THRESHOLD}`
  );

  const skippedSupportiveLinkedInThemes = new Set<string>();

  while (true) {
    if (maxTotal != null && stats.processed >= maxTotal) {
      break;
    }

    const take = Math.min(BATCH_SIZE, maxTotal != null ? maxTotal - stats.processed : BATCH_SIZE);
    if (take <= 0) break;

    // Newest theme rows first so "last N" matches Global Actions limit (most recent N posts).
    const batch = await prisma.themesAnalysis.findMany({
      where: themeWhere,
      take,
      ...(cursor ? { skip: 1, cursor } : {}),
      orderBy: { id: "desc" },
    });

    if (batch.length === 0) break;
    stats.batches += 1;
    cursor = { id: batch[batch.length - 1].id };

    console.log(
      `${LOG_PREFIX} batch=${stats.batches} size=${batch.length} ` +
        `themeIds=${batch.map((b) => b.id).join(",")}`
    );

    const batchIds = batch.map((b) => b.id);
    const existing = await prisma.themeItemResponse.findMany({
      where: {
        themes_analysis_id: { in: batchIds },
        deleted_at: null,
      },
      select: {
        id: true,
        themes_analysis_id: true,
        response_objective_id: true,
        outreach_email_body: true,
      },
    });
    const existingPairs = new Set(
      existing.map((e) => `${e.themes_analysis_id}:${e.response_objective_id}`)
    );
    const existingByPair = new Map<string, { id: string; outreach_email_body: string | null }>(
      existing.map((e) => [`${e.themes_analysis_id}:${e.response_objective_id}`, e])
    );

    const contextByThemeId = await resolveContextTextsForThemeRows(
      projectId,
      batch.map((r) => ({
        id: r.id,
        post_id: r.post_id,
        post_content: r.post_content,
      }))
    );

    const postIds = [...new Set(batch.map((b) => b.post_id))];
    const postsForAuthor = await prisma.post.findMany({
      where: { id: { in: postIds } },
      select: {
        id: true,
        authorName: true,
        authorId: true,
        url: true,
        extraJson: true,
        threadRefId: true,
        content: true,
      },
    });
    const postAuthorById = new Map(postsForAuthor.map((p) => [p.id, p]));

    /** Per theme row: last generation failure per objective (cleared on success or relevance rejection). */
    const generationErrorsByThemeId = new Map<string, Record<string, string>>();
    for (const b of batch) {
      generationErrorsByThemeId.set(b.id, parseGenerationErrorsJson(b.response_generation_errors));
    }

    const flushGenerationErrors = async (themeRowId: string) => {
      const o = generationErrorsByThemeId.get(themeRowId) ?? {};
      await prisma.themesAnalysis.update({
        where: { id: themeRowId },
        data: {
          response_generation_errors: Object.keys(o).length > 0 ? o : Prisma.JsonNull,
        },
      });
    };

    const setObjectiveGenerationError = async (
      themeRowId: string,
      objectiveId: string,
      message: string
    ) => {
      const next = { ...(generationErrorsByThemeId.get(themeRowId) ?? {}) };
      next[objectiveId] = message.slice(0, MAX_STORED_GEN_ERR);
      generationErrorsByThemeId.set(themeRowId, next);
      await flushGenerationErrors(themeRowId);
    };

    const clearObjectiveGenerationError = async (themeRowId: string, objectiveId: string) => {
      const next = { ...(generationErrorsByThemeId.get(themeRowId) ?? {}) };
      if (!(objectiveId in next)) return;
      delete next[objectiveId];
      generationErrorsByThemeId.set(themeRowId, next);
      await flushGenerationErrors(themeRowId);
    };

    for (const row of batch) {
      if (maxTotal != null && stats.processed >= maxTotal) {
        break;
      }

      const objectiveResolutions = objectives.map((objective) => ({
        objective,
        resolved: resolveSourceReplyForThemeRow(row.platform, {
          source_reply_settings: objective.source_reply_settings,
          allowed_sources: objective.allowed_sources,
          excluded_sources: objective.excluded_sources,
          is_org_identified: objective.is_org_identified,
        }),
      }));

      const anySourceAllowed = objectiveResolutions.some((r) => !r.resolved.skip);

      if (!anySourceAllowed) {
        stats.skippedRowAllSourcesExcluded += 1;
        for (const { objective, resolved } of objectiveResolutions) {
          if (resolved.skip) {
            stats.skippedPlatform += 1;
            const detail = resolved.skipReason ?? "unknown";
            const src = resolved.canonicalSourceKey ?? "—";
            const hint =
              detail === "include_disabled"
                ? " (Response objective has this source unchecked — enable Include for that row in Edit project → Response objectives.)"
                : detail === "platform_unmapped"
                  ? " (ThemesAnalysis.platform does not match any canonical source key.)"
                  : detail === "legacy_platform_not_allowed"
                    ? " (Legacy allow/exclude list blocks this platform.)"
                    : "";
            console.log(
              `${LOG_PREFIX} eval theme=${row.id} themeName=${trimForLog(row.theme_name, 80)} ` +
                `platform=${row.platform} objective="${objective.name}" id=${objective.id} ` +
                `outcome=rejected_platform detail=${detail} canonicalSource=${src}${hint}`
            );
          }
        }
        continue;
      }

      stats.processed += 1;

      const fullText =
        contextByThemeId.get(row.id) ?? ((row.post_content || "").trim() || "(no content)");

      for (const { objective, resolved } of objectiveResolutions) {
        const pairKey = `${row.id}:${objective.id}`;
        const postAuthor = postAuthorById.get(row.post_id);

        if (existingPairs.has(pairKey)) {
          const ex = existingByPair.get(pairKey);
          const hasOutreach = Boolean((ex?.outreach_email_body ?? "").trim());
          if (ex && !hasOutreach) {
            const hasProductTextBackfill =
              Boolean(projectProduct?.my_product_name?.trim()) ||
              Boolean(projectProduct?.my_product_focus_text?.trim());
            let skipLinkedinOutreachDueToSupportiveComment = false;
            if (
              isLinkedInPlatform(row.platform) &&
              projectProduct &&
              hasProductTextBackfill &&
              postAuthor?.threadRefId?.trim()
            ) {
              const passesSubstance = await linkedInMatchedPostPassesProspectSubstanceGate({
                projectId,
                matchedPostDbId: row.post_id,
                threadRefId: postAuthor.threadRefId,
                matchedPostContent: postAuthor.content,
                themePostContentFallback: row.post_content,
              });
              if (!passesSubstance) {
                skipLinkedinOutreachDueToSupportiveComment = true;
                recordLinkedInSupportiveProspectSkip(
                  skippedSupportiveLinkedInThemes,
                  stats,
                  row.id,
                  row.post_id,
                  "outreach_backfill"
                );
              }
            }

            if (!skipLinkedinOutreachDueToSupportiveComment) {
              const { headline: liHeadBf } = getLinkedInAuthorFromExtraJson(
                postAuthor?.extraJson ?? null
              );
              const prospectIntelBf = await buildProspectIntelContextForOutreach({
                projectId,
                themesAnalysisId: row.id,
                postId: row.post_id,
                themeItemResponseId: ex.id,
                platform: row.platform,
                themeRelevancePercent: row.relevance_score ?? null,
                authorName: row.author_name,
                headlineFallback: liHeadBf,
                publicProfileScrape: null,
              });
              const o = await tryGenerateLinkedinOutreachForThemeItem(
                projectProduct,
                { projectId, matchedPostId: row.post_id },
                fullText,
                {
                  theme_name: row.theme_name,
                  post_url: row.post_url,
                  author_name: row.author_name,
                  platform: row.platform,
                },
                postAuthor,
                objective,
                LOG_PREFIX,
                null,
                prospectIntelBf
              );
              if (o) {
                await prisma.themeItemResponse.update({
                  where: { id: ex.id },
                  data: {
                    outreach_email_subject: o.email_subject,
                    outreach_email_body: o.email_body,
                  },
                });
                stats.outreachBackfilled += 1;
                console.log(
                  `${LOG_PREFIX} eval theme=${row.id} themeName=${trimForLog(row.theme_name, 80)} ` +
                    `platform=${row.platform} objective="${objective.name}" id=${objective.id} ` +
                    `outcome=outreach_backfilled themeItemResponseId=${ex.id}`
                );
              } else {
                stats.skippedHasResponse += 1;
                if (isLinkedInPlatform(row.platform) && projectProduct) {
                  const hasText =
                    Boolean(projectProduct.my_product_name?.trim()) ||
                    Boolean(projectProduct.my_product_focus_text?.trim());
                  if (isLinkedInPlatform(row.platform) && !hasText) {
                    console.log(
                      `${LOG_PREFIX} eval theme=${row.id} objective="${objective.name}" ` +
                        `outcome=skipped_has_response_outreach_would_need_my_product`
                    );
                  } else {
                    console.log(
                      `${LOG_PREFIX} eval theme=${row.id} themeName=${trimForLog(row.theme_name, 80)} ` +
                        `platform=${row.platform} objective="${objective.name}" id=${objective.id} ` +
                        `outcome=skipped_already_has_response_outreach_unfilled`
                    );
                  }
                } else {
                  console.log(
                    `${LOG_PREFIX} eval theme=${row.id} themeName=${trimForLog(row.theme_name, 80)} ` +
                      `platform=${row.platform} objective="${objective.name}" id=${objective.id} ` +
                      `outcome=skipped_already_has_response`
                  );
                }
              }
            } else {
              stats.skippedHasResponse += 1;
              console.log(
                `${LOG_PREFIX} eval theme=${row.id} themeName=${trimForLog(row.theme_name, 80)} ` +
                  `platform=${row.platform} objective="${objective.name}" id=${objective.id} ` +
                  `outcome=skipped_outreach_supportive_linkedIn_comment_only`
              );
            }
          } else {
            stats.skippedHasResponse += 1;
            console.log(
              `${LOG_PREFIX} eval theme=${row.id} themeName=${trimForLog(row.theme_name, 80)} ` +
                `platform=${row.platform} objective="${objective.name}" id=${objective.id} ` +
                `outcome=skipped_already_has_response`
            );
          }
          continue;
        }

        if (resolved.skip) {
          stats.skippedPlatform += 1;
          const detail = resolved.skipReason ?? "unknown";
          const src = resolved.canonicalSourceKey ?? "—";
          const hint =
            detail === "include_disabled"
              ? " (Response objective has this source unchecked — enable Include for that row in Edit project → Response objectives.)"
              : detail === "platform_unmapped"
                ? " (ThemesAnalysis.platform does not match any canonical source key.)"
                : detail === "legacy_platform_not_allowed"
                  ? " (Legacy allow/exclude list blocks this platform.)"
                  : "";
          console.log(
            `${LOG_PREFIX} eval theme=${row.id} themeName=${trimForLog(row.theme_name, 80)} ` +
              `platform=${row.platform} objective="${objective.name}" id=${objective.id} ` +
              `outcome=rejected_platform detail=${detail} canonicalSource=${src}${hint}`
          );
          continue;
        }

        try {
          const rel = await evaluateRelevance({
            objectiveDescription: objective.description || objective.name,
            relevanceGuidelines: objective.relevance_guidelines,
            platform: row.platform,
            fullText,
          });

          if (rel.relevance_score < RESPONSE_RELEVANCE_THRESHOLD) {
            stats.skippedLowRelevance += 1;
            await clearObjectiveGenerationError(row.id, objective.id);
            console.log(
              `${LOG_PREFIX} eval theme=${row.id} themeName=${trimForLog(row.theme_name, 80)} ` +
                `platform=${row.platform} objective="${objective.name}" id=${objective.id} ` +
                `outcome=rejected_relevance score=${rel.relevance_score.toFixed(3)} ` +
                `threshold=${RESPONSE_RELEVANCE_THRESHOLD} ` +
                `reason=${trimForLog(rel.reasoning)}`
            );
            continue;
          }

          console.log(
            `${LOG_PREFIX} eval theme=${row.id} themeName=${trimForLog(row.theme_name, 80)} ` +
              `platform=${row.platform} objective="${objective.name}" id=${objective.id} ` +
              `outcome=accepted_relevance score=${rel.relevance_score.toFixed(3)} ` +
              `reason=${trimForLog(rel.reasoning)}`
          );

          const hasProductText =
            Boolean(projectProduct?.my_product_name?.trim()) ||
            Boolean(projectProduct?.my_product_focus_text?.trim());
          const tryLinkedinOutreach =
            isLinkedInPlatform(row.platform) && projectProduct && hasProductText;

          const gen = await generateResponseText({
            platform: row.platform,
            persona: objective.persona,
            belongToOrg: resolved.belongToOrg,
            objectiveDescription: objective.description || objective.name,
            styleGuidelines: objective.style_guidelines,
            exampleResponsesJson: objective.example_responses,
            fullText,
            projectBrandNames,
            authorName: row.author_name ?? postAuthor?.authorName ?? null,
            authorId: row.author_id ?? postAuthor?.authorId ?? null,
          });

          let outreachSubject: string | null = null;
          let outreachBody: string | null = null;
          if (tryLinkedinOutreach) {
            let tryGenerateOutreach = true;
            if (postAuthor?.threadRefId?.trim()) {
              const passesSubstanceMain = await linkedInMatchedPostPassesProspectSubstanceGate({
                projectId,
                matchedPostDbId: row.post_id,
                threadRefId: postAuthor.threadRefId,
                matchedPostContent: postAuthor.content,
                themePostContentFallback: row.post_content,
              });
              if (!passesSubstanceMain) {
                tryGenerateOutreach = false;
                recordLinkedInSupportiveProspectSkip(
                  skippedSupportiveLinkedInThemes,
                  stats,
                  row.id,
                  row.post_id,
                  "main_generation"
                );
              }
            }
            if (tryGenerateOutreach) {
              const { headline: liHeadMain } = getLinkedInAuthorFromExtraJson(
                postAuthor?.extraJson ?? null
              );
              const prospectIntelMain = await buildProspectIntelContextForOutreach({
                projectId,
                themesAnalysisId: row.id,
                postId: row.post_id,
                themeItemResponseId: null,
                platform: row.platform,
                themeRelevancePercent: row.relevance_score ?? null,
                authorName: row.author_name,
                headlineFallback: liHeadMain,
                publicProfileScrape: null,
              });
              const out = await tryGenerateLinkedinOutreachForThemeItem(
                projectProduct,
                { projectId, matchedPostId: row.post_id },
                fullText,
                {
                  theme_name: row.theme_name,
                  post_url: row.post_url,
                  author_name: row.author_name,
                  platform: row.platform,
                },
                postAuthor,
                objective,
                LOG_PREFIX,
                null,
                prospectIntelMain
              );
              if (out) {
                outreachSubject = out.email_subject;
                outreachBody = out.email_body;
              }
            }
          } else if (isLinkedInPlatform(row.platform) && projectProduct && !hasProductText) {
            console.log(
              `${LOG_PREFIX} skip linkedin outreach email: set My product name or focus in project settings`
            );
          }

          // Upsert: unique (themes_analysis_id, response_objective_id) applies to soft-deleted rows too,
          // so a prior soft-deleted row would make create() throw P2002 while existingPairs misses it.
          const saved = await prisma.themeItemResponse.upsert({
            where: {
              themes_analysis_id_response_objective_id: {
                themes_analysis_id: row.id,
                response_objective_id: objective.id,
              },
            },
            create: {
              themes_analysis_id: row.id,
              response_objective_id: objective.id,
              platform: row.platform,
              relevance_score: rel.relevance_score,
              reasoning: rel.reasoning,
              target_user: gen.target_user,
              persona: gen.persona,
              response_text: gen.response_text,
              outreach_email_subject: outreachSubject,
              outreach_email_body: outreachBody,
            },
            update: {
              platform: row.platform,
              relevance_score: rel.relevance_score,
              reasoning: rel.reasoning,
              target_user: gen.target_user,
              persona: gen.persona,
              response_text: gen.response_text,
              outreach_email_subject: outreachSubject,
              outreach_email_body: outreachBody,
              deleted_at: null,
            },
            select: { id: true },
          });

          existingPairs.add(pairKey);
          stats.generated += 1;
          await clearObjectiveGenerationError(row.id, objective.id);
          console.log(
            `${LOG_PREFIX} response_saved theme=${row.id} objective="${objective.name}" ` +
              `objectiveId=${objective.id} themeItemResponseId=${saved.id}`
          );
        } catch (e) {
          stats.errors += 1;
          const msg = e instanceof Error ? e.message : String(e);
          await setObjectiveGenerationError(row.id, objective.id, msg);
          console.error(
            `${LOG_PREFIX} eval theme=${row.id} objective="${objective.name}" id=${objective.id} ` +
              `outcome=error error=${trimForLog(msg, 300)}`,
            e
          );
        }
      }
    }
  }

  console.log(
    `${LOG_PREFIX} complete project=${projectId} orchestrationRunId=${runId ?? "any"} ` +
      `processed=${stats.processed} generated=${stats.generated} outreachBackfilled=${stats.outreachBackfilled} ` +
      `skippedHasResponse=${stats.skippedHasResponse} ` +
      `skippedLinkedInSupportiveComment=${stats.skippedLinkedInSupportiveComment} ` +
      `skippedPlatform=${stats.skippedPlatform} skippedRowAllSourcesExcluded=${stats.skippedRowAllSourcesExcluded} ` +
      `skippedLowRelevance=${stats.skippedLowRelevance} errors=${stats.errors} batches=${stats.batches}`
  );

  return stats;
}

/**
 * After run-scoped sanitization: generate replies only for theme rows created in that analysis run.
 * Swallows errors so analysis finalization still succeeds; logs failures.
 */
export async function runThemeResponseGeneratorAfterSanitization(
  projectId: string,
  orchestrationRunId: string
): Promise<void> {
  const rid = orchestrationRunId.trim();
  if (!rid) return;

  try {
    const syn = await synthesizeConversationWithoutThemeAnalyses(projectId, rid);
    console.log(
      `${LOG_PREFIX} conversation-without-theme project=${projectId} run=${rid} ` +
        `created=${syn.createdThemesAnalysis} postsInRun=${syn.postsInRun}`
    );
  } catch (e) {
    console.error(
      `${LOG_PREFIX} conversation-without-theme failed project=${projectId} run=${rid}`,
      e
    );
  }

  try {
    const stats = await runThemeResponseGeneratorPipeline(projectId, {
      orchestrationRunId: rid,
    });
    console.log(
      `${LOG_PREFIX} after-sanitization project=${projectId} run=${rid} ` +
        `generated=${stats.generated} processed=${stats.processed} errors=${stats.errors}`
    );
  } catch (e) {
    console.error(`${LOG_PREFIX} after-sanitization failed project=${projectId} run=${rid}`, e);
  }
}
