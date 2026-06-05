import type { ProspectClassification } from "@/lib/prospect-intelligence/types";
import type { CampaignCandidate, CampaignCandidateSourceType } from "./types";

export type CampaignOpenToWorkDetection = "detected" | "not_detected" | "unknown";
export type CampaignOpenToWorkSource =
  | "company_search"
  | "post_based"
  | "profile_enrichment"
  | "unavailable";

const OTW_DETECTED_STATUSES = new Set(["text_signal_detected", "public_signal_detected"]);
const OTW_PROFILE_FLAGS = new Set([
  "open_to_work_text_signal",
  "open_to_work_public_signal",
  "job_seeker_signal",
  "job_search_signal",
]);

/** Apify company-employees payload keys that would carry an explicit OTW signal (none in short mode today). */
const APIFY_COMPANY_OTW_KEYS = [
  "openToWork",
  "open_to_work",
  "isOpenToWork",
  "openToWorkStatus",
  "openToWorkBadge",
] as const;

export function apifyCompanyItemHasOpenToWorkSignal(item: Record<string, unknown>): boolean {
  for (const key of APIFY_COMPANY_OTW_KEYS) {
    const v = item[key];
    if (v === true || v === "true") return true;
    if (typeof v === "string" && /open\s*to\s*work|opentowork/i.test(v)) return true;
  }
  const headline = [item.headline, item.summary, item.tagline]
    .filter((x) => typeof x === "string")
    .join(" ");
  return /#opentowork\b|\bopen\s+to\s+work\b/i.test(headline);
}

function headlineImpliesOpenToWork(headline: string | null | undefined): boolean {
  if (!headline?.trim()) return false;
  return /#opentowork\b|\bopen\s+to\s+work\b|\bopen-to-work\b/i.test(headline);
}

function classificationShowsOpenToWork(classification: ProspectClassification): boolean {
  const status = classification.openToWorkDetection?.status;
  if (status && OTW_DETECTED_STATUSES.has(status)) return true;
  if (classification.profileFlags.some((f) => OTW_PROFILE_FLAGS.has(f))) return true;
  if (classification.excludedRoleFlags.includes("open_to_work")) return true;
  return false;
}

function classificationAffirmativeNoOpenToWork(classification: ProspectClassification): boolean {
  const status = classification.openToWorkDetection?.status;
  if (status !== "not_observed") return false;
  if (classificationShowsOpenToWork(classification)) return false;
  if (classification.roleCategories.includes("job_seeker")) return false;
  return true;
}

function primarySourceType(sourceTypes: CampaignCandidateSourceType[]): CampaignCandidateSourceType {
  if (sourceTypes.includes("post_based_candidate")) return "post_based_candidate";
  if (sourceTypes.includes("cold_company_search")) return "cold_company_search";
  return sourceTypes[0] ?? "cold_company_search";
}

/**
 * Phase 2: company / role search usually has no OTW badge in the actor payload.
 * Unknown OTW must not drive disqualification (no matcher hit on open_to_work).
 */
export function deriveCampaignOpenToWorkFields(args: {
  candidate: CampaignCandidate;
  classification?: ProspectClassification;
  hadCachedEmployment?: boolean;
  apifyHadOpenToWork?: boolean;
}): {
  open_to_work_detection: CampaignOpenToWorkDetection;
  open_to_work_source: CampaignOpenToWorkSource;
  open_to_work_status_detail: string;
} {
  const { candidate, classification, hadCachedEmployment, apifyHadOpenToWork } = args;

  const companyOnly =
    candidate.source_types.includes("cold_company_search") &&
    !candidate.source_types.includes("post_based_candidate");
  const headlineOtw = headlineImpliesOpenToWork(candidate.headline);

  if (!classification) {
    return {
      open_to_work_detection: "unknown",
      open_to_work_source: "unavailable",
      open_to_work_status_detail: "",
    };
  }

  const statusDetail = classification.openToWorkDetection?.status ?? "";

  if (companyOnly && !hadCachedEmployment && !apifyHadOpenToWork && !headlineOtw) {
    return {
      open_to_work_detection: "unknown",
      open_to_work_source: "unavailable",
      open_to_work_status_detail: statusDetail,
    };
  }

  if (classificationShowsOpenToWork(classification) || headlineOtw) {
    let source: CampaignOpenToWorkSource = "unavailable";
    if (hadCachedEmployment) source = "profile_enrichment";
    else if (candidate.source_types.includes("post_based_candidate")) source = "post_based";
    else if (candidate.source_types.includes("cold_company_search")) source = "company_search";

    return {
      open_to_work_detection: "detected",
      open_to_work_source: source,
      open_to_work_status_detail: statusDetail,
    };
  }

  if (classificationAffirmativeNoOpenToWork(classification)) {
    const source: CampaignOpenToWorkSource =
      hadCachedEmployment
        ? "profile_enrichment"
        : primarySourceType(candidate.source_types) === "post_based_candidate"
          ? "post_based"
          : "company_search";

    return {
      open_to_work_detection: "not_detected",
      open_to_work_source: source,
      open_to_work_status_detail: statusDetail,
    };
  }

  return {
    open_to_work_detection: "unknown",
    open_to_work_source: companyOnly ? "unavailable" : "company_search",
    open_to_work_status_detail: statusDetail,
  };
}
