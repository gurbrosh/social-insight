import type {
  ProspectClassification,
  ProspectOutreachBucket,
  ProspectRoutingRuleDefinition,
  RuleCondition,
  RuleEngineInput,
  RuleEngineResult,
  RoutingRecommendation,
} from "./types";

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function investorFlag(c: ProspectClassification): boolean {
  return c.roleCategories.includes("investor");
}

function openToWorkFlag(c: ProspectClassification): boolean {
  return (
    c.excludedRoleFlags.includes("open_to_work") ||
    c.roleCategories.includes("job_seeker")
  );
}

function evaluateCondition(
  condition: RuleCondition,
  input: RuleEngineInput
): boolean {
  const { classification: cl, platform, themeRelevancePercent, headlineText, competitorMatched } =
    input;
  const h = norm(headlineText);

  switch (condition.field) {
    case "roleCategory": {
      const has = condition.values.some((v) => cl.roleCategories.includes(v));
      return condition.op === "in" ? has : !has;
    }
    case "excludedRoleFlags": {
      const has = condition.values.some((v) => cl.excludedRoleFlags.includes(v));
      return condition.op === "in" ? has : !has;
    }
    case "functionTags": {
      const has = condition.values.some((v) => cl.functionTags.includes(v));
      return condition.op === "in" ? has : !has;
    }
    case "seniority": {
      if (condition.op === "eq") {
        return condition.values.length > 0 && cl.seniority === condition.values[0];
      }
      return condition.values.includes(cl.seniority);
    }
    case "companySizeSignal": {
      if (condition.op === "eq") {
        return condition.values.length > 0 && cl.companySizeSignal === condition.values[0];
      }
      return condition.values.includes(cl.companySizeSignal);
    }
    case "currentCompany": {
      const cc = (cl.currentCompany ?? "").trim();
      if (!cc) return false;
      const n = norm(cc);
      return condition.patterns.some((p) => n.includes(norm(p)));
    }
    case "currentTitle": {
      const t = norm(cl.currentTitle ?? "");
      if (!t) return false;
      return condition.keywords.some((k) => t.includes(norm(k)));
    }
    case "headline": {
      return condition.keywords.some((k) => h.includes(norm(k)));
    }
    case "platform": {
      return norm(platform) === norm(condition.value);
    }
    case "themeRelevance": {
      if (themeRelevancePercent == null) return false;
      return condition.op === "gte"
        ? themeRelevancePercent >= condition.value
        : themeRelevancePercent <= condition.value;
    }
    case "classificationConfidence": {
      const conf = cl.confidence;
      if (condition.op === "gte") return conf >= (condition.value ?? 0);
      if (condition.op === "lte") return conf <= (condition.value ?? 1);
      const lo = condition.value ?? 0;
      const hi = condition.max ?? 1;
      return conf >= lo && conf <= hi;
    }
    case "employmentConfidence": {
      return condition.op === "gte"
        ? cl.employmentConfidence >= condition.value
        : cl.employmentConfidence <= condition.value;
    }
    case "competitorList": {
      return competitorMatched;
    }
    case "investorFlag": {
      const on = investorFlag(cl);
      return condition.op === "isTrue" ? on : !on;
    }
    case "openToWorkFlag": {
      const on = openToWorkFlag(cl);
      return condition.op === "isTrue" ? on : !on;
    }
    case "needsReview": {
      const on = cl.needsReview;
      return condition.op === "isTrue" ? on : !on;
    }
    default: {
      const _exhaustive: never = condition;
      return _exhaustive;
    }
  }
}

function routingToDefaultBucket(target: RoutingRecommendation): ProspectOutreachBucket | null {
  switch (target) {
    case "unrouted":
      return "manual_review";
    case "email_outreach":
      return "email";
    case "linkedin_outreach":
      return "linkedin";
    case "both":
      return "both";
    case "exclude":
      return "excluded";
    case "manual_review":
      return "manual_review";
    case "investor_nurture":
      return "investor_nurture";
    case "competitor_watch":
      return "competitor_watch";
    default: {
      const _e: never = target;
      return _e;
    }
  }
}

function isTerminalAction(
  action: import("./types").RuleAction
): boolean {
  return action.type === "exclude_from_outreach" || action.type === "manual_review";
}

/**
 * Ordered rules (priority asc). First matching rule applies actions; terminal actions stop further rules.
 * Starts from classifier `routingRecommendation` and refines with rule outputs.
 */
export function evaluateRoutingRules(
  rules: ProspectRoutingRuleDefinition[],
  input: RuleEngineInput
): RuleEngineResult {
  const sorted = [...rules].filter((r) => r.enabled).sort((a, b) => a.priority - b.priority);

  let bucket: ProspectOutreachBucket | null = routingToDefaultBucket(
    input.classification.routingRecommendation
  );
  let routingRecommendation: RoutingRecommendation = input.classification.routingRecommendation;
  const outreachTags: string[] = [...input.classification.outreachTags];
  let templateId: string | null = null;
  let suppressTitleCompanyPersonalization = false;
  let requireManualApproval = false;
  let matchedRuleId: string | null = null;
  let matchedRuleName: string | null = null;
  let reason = "Awaiting routing rules (classifier unrouted).";
  let stoppedEarly = false;

  for (const rule of sorted) {
    if (rule.conditions.length === 0) continue;

    const results = rule.conditions.map((c) => evaluateCondition(c, input));
    const match =
      rule.conditionLogic === "all" ? results.every(Boolean) : results.some(Boolean);

    if (!match) continue;

    matchedRuleId = rule.id;
    matchedRuleName = rule.name;
    reason = `Matched rule "${rule.name}" (priority ${rule.priority}).`;

    for (const action of rule.actions) {
      switch (action.type) {
        case "exclude_from_outreach":
          bucket = "excluded";
          routingRecommendation = "exclude";
          stoppedEarly = true;
          break;
        case "manual_review":
          bucket = "manual_review";
          routingRecommendation = "manual_review";
          stoppedEarly = true;
          break;
        case "route":
          routingRecommendation = action.target;
          const b = routingToDefaultBucket(action.target);
          if (b) bucket = b;
          break;
        case "set_bucket":
          bucket = action.bucket;
          break;
        case "add_tag":
          outreachTags.push(...action.tags);
          break;
        case "assign_template":
          templateId = action.templateId;
          break;
        case "assign_sequence":
          // reserved for future automation
          break;
        case "suppress_title_company_personalization":
          suppressTitleCompanyPersonalization = true;
          break;
        case "require_manual_approval":
          requireManualApproval = true;
          break;
        default: {
          const _e: never = action;
          void _e;
          break;
        }
      }

      if (isTerminalAction(action)) {
        stoppedEarly = true;
        break;
      }
    }

    if (stoppedEarly) break;
  }

  return {
    bucket,
    routingRecommendation,
    outreachTags,
    templateId,
    suppressTitleCompanyPersonalization,
    requireManualApproval,
    matchedRuleId,
    matchedRuleName,
    reason,
    stoppedEarly,
  };
}
