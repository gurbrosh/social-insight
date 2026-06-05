import type { CampaignOpenToWorkDetection } from "./open-to-work-export";

export type ProfileOpenToWorkResult = {
  open_to_work_detection: CampaignOpenToWorkDetection;
  open_to_work_source:
    | "profile_enrichment"
    | "inferred_text_weak"
    | "unavailable";
  open_to_work_raw_value: string | null;
};

const EXPLICIT_TRUE_KEYS = [
  "openToWork",
  "open_to_work",
  "isOpenToWork",
  "isOpenToWorkBadge",
] as const;

const EXPLICIT_FALSE_JOB_SEEKER_KEYS = ["isJobSeeker", "jobSeeking", "job_seeking"] as const;

function normStr(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function valueImpliesOpenToWork(v: unknown): boolean | null {
  if (v === true || v === "true") return true;
  if (v === false || v === "false") return false;
  const s = normStr(v).toLowerCase();
  if (!s) return null;
  if (/open\s*to\s*work|opentowork|actively\s+looking|seeking\s+new/.test(s)) return true;
  if (/not\s+open|not\s+seeking|not\s+looking/.test(s)) return false;
  return null;
}

function scanBadgeArrays(item: Record<string, unknown>): boolean | null {
  const keys = ["profileBadges", "badges", "frame", "hiringStatus"];
  for (const key of keys) {
    const v = item[key];
    if (Array.isArray(v)) {
      for (const badge of v) {
        const implied = valueImpliesOpenToWork(
          typeof badge === "string" ? badge : (badge as Record<string, unknown>)?.text ?? badge
        );
        if (implied != null) return implied;
      }
    } else {
      const implied = valueImpliesOpenToWork(v);
      if (implied != null) return implied;
    }
  }
  return null;
}

function textImpliesOpenToWorkWeak(text: string): boolean {
  return /#opentowork\b|\bopen\s+to\s+work\b|\bopen-to-work\b/i.test(text);
}

/**
 * Detect Open to Work from full profile actor payload.
 * Explicit actor fields take precedence over weak headline/about text.
 */
export function detectProfileOpenToWork(item: Record<string, unknown>): ProfileOpenToWorkResult {
  for (const key of EXPLICIT_TRUE_KEYS) {
    const implied = valueImpliesOpenToWork(item[key]);
    if (implied === true) {
      return {
        open_to_work_detection: "detected",
        open_to_work_source: "profile_enrichment",
        open_to_work_raw_value: normStr(item[key]) || key,
      };
    }
    if (implied === false) {
      return {
        open_to_work_detection: "not_detected",
        open_to_work_source: "profile_enrichment",
        open_to_work_raw_value: normStr(item[key]) || key,
      };
    }
  }

  for (const key of EXPLICIT_FALSE_JOB_SEEKER_KEYS) {
    if (item[key] === true) {
      return {
        open_to_work_detection: "detected",
        open_to_work_source: "profile_enrichment",
        open_to_work_raw_value: key,
      };
    }
    if (item[key] === false) {
      return {
        open_to_work_detection: "not_detected",
        open_to_work_source: "profile_enrichment",
        open_to_work_raw_value: key,
      };
    }
  }

  const badgeResult = scanBadgeArrays(item);
  if (badgeResult === true) {
    return {
      open_to_work_detection: "detected",
      open_to_work_source: "profile_enrichment",
      open_to_work_raw_value: "badges",
    };
  }
  if (badgeResult === false) {
    return {
      open_to_work_detection: "not_detected",
      open_to_work_source: "profile_enrichment",
      open_to_work_raw_value: "badges",
    };
  }

  const headline = normStr(item.headline);
  const about = normStr(item.about) || normStr(item.summary);
  const weakText = [headline, about].filter(Boolean).join(" ");
  if (weakText && textImpliesOpenToWorkWeak(weakText)) {
    return {
      open_to_work_detection: "detected",
      open_to_work_source: "inferred_text_weak",
      open_to_work_raw_value: weakText.slice(0, 200),
    };
  }

  return {
    open_to_work_detection: "unknown",
    open_to_work_source: "unavailable",
    open_to_work_raw_value: null,
  };
}
