import {
  classifyProspectDeterministic,
  type ClassifierOptions,
  type ProspectLlmReconciler,
} from "./classify";
import { buildDeterministicProspectContext } from "./deterministic-context";
import { shouldInvokeLlmReconciler } from "./llm-invoke-policy";
import {
  mergeLlmPatchesIntoClassification,
  openAiProspectLlmReconciler,
} from "./llm-reconciler";
import { applyPostLlmValidation } from "./post-llm-validate";
import {
  type ProspectClassifierMode,
  resolveProspectClassifierMode,
} from "./prospect-classifier-mode";
import type { ProspectClassification, ProspectEvidence } from "./types";

export type ClassifyProspectOptions = ClassifierOptions & {
  mode?: ProspectClassifierMode;
  llmReconciler?: ProspectLlmReconciler;
  /** When true, always call LLM in full mode (disables cost gating). */
  forceLlm?: boolean;
};

export type ClassifyProspectResult = {
  classification: ProspectClassification;
  mode: ProspectClassifierMode;
  llmInvoked: boolean;
  llmInvokeReasons: string[];
  classifierModeLabel: string;
};

function appendReason(classification: ProspectClassification, suffix: string): void {
  classification.reason = `${classification.reason} ${suffix}`.trim();
}

/**
 * Hybrid prospect classification: deterministic evidence/guardrails, optional LLM semantic
 * reconciliation, then deterministic post-LLM validation.
 */
export async function classifyProspect(
  evidence: ProspectEvidence[],
  options: ClassifyProspectOptions = {}
): Promise<ClassifyProspectResult> {
  const mode = resolveProspectClassifierMode(options.mode);
  const draft = classifyProspectDeterministic(evidence, options);
  const ctx = buildDeterministicProspectContext(evidence, options, draft);

  if (mode === "deterministic") {
    const classification = applyPostLlmValidation(draft, ctx);
    return {
      classification,
      mode,
      llmInvoked: false,
      llmInvokeReasons: [],
      classifierModeLabel: "deterministic",
    };
  }

  const decision = shouldInvokeLlmReconciler(ctx);
  const invoke = options.forceLlm === true || decision.invoke;

  if (!invoke) {
    const classification = applyPostLlmValidation(draft, ctx);
    appendReason(classification, `[hybrid:llm-skipped ${decision.reasons.join(",")}]`);
    return {
      classification,
      mode,
      llmInvoked: false,
      llmInvokeReasons: decision.reasons,
      classifierModeLabel: "hybrid-deterministic-only",
    };
  }

  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error(
      "OPENAI_API_KEY is required for full (hybrid) classification when LLM reconciliation is needed"
    );
  }

  const reconciler = options.llmReconciler ?? openAiProspectLlmReconciler;
  const reconcileOut = await reconciler.reconcile({
    evidence,
    draftClassification: draft,
    deterministicContext: ctx,
    invokeReasons: decision.reasons,
  });

  let merged = mergeLlmPatchesIntoClassification(draft, reconcileOut.patches);
  merged = {
    ...merged,
    classifierVersion: `${draft.classifierVersion ?? "1.0.0"}-hybrid-llm`,
    reason: `${draft.reason} [hybrid-llm ${decision.reasons.join(",")}]`.trim(),
  };

  const classification = applyPostLlmValidation(merged, ctx);

  return {
    classification,
    mode,
    llmInvoked: true,
    llmInvokeReasons: decision.reasons,
    classifierModeLabel: "hybrid-full",
  };
}

/** @deprecated Use classifyProspect with mode `full`. */
export async function classifyProspectHybrid(
  evidence: ProspectEvidence[],
  options?: ClassifyProspectOptions
): Promise<ProspectClassification> {
  const result = await classifyProspect(evidence, { ...options, mode: "full" });
  return result.classification;
}
