import type { Prisma } from "@prisma/client";
import { getLinkedInAuthorFromExtraJson } from "@/lib/linkedin-prospects-csv/extra-json";
import { extractProfileExperienceRolesFromExtraJson } from "./extract-profile-experience";
import { parseExperienceItemsFromMetadata } from "./load-profile-employment";
import type { ExperienceItemSource, ProfileExperienceRole } from "./profile-experience-types";
import {
  inferExperienceItemSourceFromAnalysisMethod,
  parseAnalysisMethodFromMetadata,
  validateProfileExperienceRoles,
} from "./validate-profile-experience";

export type ProfileFetchStatus =
  | "ok"
  | "auth_wall"
  | "http_error"
  | "timeout"
  | "too_short"
  | "not_attempted";

export type SourceAvailability =
  | "none"
  | "post_extra_json"
  | "person_employment_cache"
  | "public_profile_html"
  | "openai_inference";

/** Best-effort parse of embedded Voyager-style position JSON from public profile HTML. */
export function extractExperienceRolesFromProfileHtml(html: string): ProfileExperienceRole[] {
  const m = /profilePosition|fsd_profilePosition|PositionGroup|"EXPERIENCE"/i.exec(html);
  const start = m?.index != null ? m.index : 0;
  const win = html.slice(start, start + 400_000);
  const roles: ProfileExperienceRole[] = [];
  const titleRe =
    /"title"\s*:\s*\{[^}]*"text"\s*:\s*"((?:[^"\\]|\\.)*)"[^}]*\}[^}]*"companyName"\s*:\s*\{[^}]*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  const altRe =
    /"companyName"\s*:\s*\{[^}]*"text"\s*:\s*"((?:[^"\\]|\\.)*)"[^}]*\}[^}]*"title"\s*:\s*\{[^}]*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g;

  const unescape = (s: string) =>
    s.replace(/\\"/g, '"').replace(/\\n/g, " ").replace(/\\u0026/g, "&").trim();

  for (const match of win.matchAll(titleRe)) {
    const title = unescape(match[1] ?? "");
    const company = unescape(match[2] ?? "");
    if (!title && !company) continue;
    roles.push({
      title: title || company,
      company: company || "",
      experienceItemSource: "public_profile_html_experience_section",
      evidenceExcerpt: `HTML Experience embed: ${title} @ ${company}`.slice(0, 500),
    });
    if (roles.length >= 8) break;
  }
  if (roles.length === 0) {
    for (const match of win.matchAll(altRe)) {
      const company = unescape(match[1] ?? "");
      const title = unescape(match[2] ?? "");
      if (!title && !company) continue;
      roles.push({
        title: title || company,
        company: company || "",
        experienceItemSource: "public_profile_html_experience_section",
        evidenceExcerpt: `HTML Experience embed: ${title} @ ${company}`.slice(0, 500),
      });
      if (roles.length >= 8) break;
    }
  }
  const seen = new Set<string>();
  return roles.filter((r) => {
    const key = `${r.title}|${r.company}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function detectExperienceSignalsInHtml(html: string): {
  experienceSectionFound: boolean;
  structuredExperienceArrayFound: boolean;
  jsonLdWorksFor: boolean;
  embeddedCompanyNameHits: number;
} {
  const experienceSectionFound =
    /profilePosition|fsd_profilePosition|PositionGroup|"EXPERIENCE"|experienceSection|pagedListComponent.*experience/i.test(
      html
    );
  const structuredExperienceArrayFound =
    /"companyName"\s*:\s*\{[^}]*"text"\s*:/.test(html) &&
    /profilePosition|PositionGroup|"EXPERIENCE"/i.test(html);
  let jsonLdWorksFor = false;
  for (const m of html.matchAll(
    /<script type="application\/ld\+json">([^<]+)<\/script>/gi
  )) {
    try {
      const j = JSON.parse(m[1].trim()) as unknown;
      const list = Array.isArray(j) ? j : [j];
      for (const o of list) {
        if (!o || typeof o !== "object") continue;
        if ((o as { "@type"?: string })["@type"] !== "Person") continue;
        const w = (o as { worksFor?: unknown }).worksFor;
        if (w) {
          jsonLdWorksFor = true;
          break;
        }
      }
    } catch {
      /* */
    }
    if (jsonLdWorksFor) break;
  }
  const embeddedCompanyNameHits = (
    html.match(/"companyName"\s*:\s*\{[^}]*"text"\s*:/g) ?? []
  ).length;
  return {
    experienceSectionFound,
    structuredExperienceArrayFound,
    jsonLdWorksFor,
    embeddedCompanyNameHits,
  };
}

export async function fetchPublicProfileHtmlForProbe(
  profileUrl: string
): Promise<{ html: string | null; status: ProfileFetchStatus }> {
  const u = profileUrl.trim();
  if (!/^https?:\/\//i.test(u)) {
    return { html: null, status: "not_attempted" };
  }
  const UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  try {
    const res = await fetch(u, {
      redirect: "follow",
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { html: null, status: "http_error" };
    const html = await res.text();
    if (html.length < 2_000) return { html: null, status: "too_short" };
    if (/authwall|consent|challenge|login|checkpoint/gi.test(html)) {
      return { html: null, status: "auth_wall" };
    }
    return { html, status: "ok" };
  } catch {
    return { html: null, status: "timeout" };
  }
}

export type ProfileExperienceProbeResult = {
  profileUrl: string;
  headline: string;
  profileFetchAttempted: "yes" | "no";
  profileFetchStatus: ProfileFetchStatus;
  sourceAvailable: SourceAvailability;
  sourceType: string;
  rawProfileHtmlAvailable: "yes" | "no";
  experienceSectionFound: "yes" | "no";
  structuredExperienceArrayFound: "yes" | "no";
  postExtraJsonRoleCount: number;
  cachedDbRawRoleCount: number;
  cachedAnalysisMethod: string;
  openaiAttempted: "yes" | "no";
  openaiRawRoleCount: number;
  openaiAnalysisMethod: string;
  rawProfileExperienceInputCount: number;
  validProfileExperienceInputCount: number;
  rejectedProfileExperienceInputCount: number;
  acceptedExperienceItems: string;
  rejectedExperienceItems: string;
  rejectionReason: string;
  evidenceExcerpt: string;
  currentTitle: string;
  currentCompany: string;
  employmentSource: string;
  employmentConfidence: string;
};

function formatRolesBrief(roles: ProfileExperienceRole[]): string {
  return roles
    .slice(0, 5)
    .map((r) => `${r.title} @ ${r.company} [${r.experienceItemSource ?? "?"}]`)
    .join(" | ");
}

export async function probeProfileExperienceSources(args: {
  profileUrl: string;
  extraJson?: Prisma.JsonValue | null;
  validationMetadata?: string | null;
  headlineHint?: string | null;
  tryOpenAi?: boolean;
}): Promise<ProfileExperienceProbeResult> {
  const profileUrl = args.profileUrl.trim();
  const headline =
    args.headlineHint?.trim() ||
    getLinkedInAuthorFromExtraJson(args.extraJson).headline?.trim() ||
    "";

  const postRoles = extractProfileExperienceRolesFromExtraJson(args.extraJson);
  const cachedRoles = parseExperienceItemsFromMetadata(args.validationMetadata);
  const analysisMethod = parseAnalysisMethodFromMetadata(args.validationMetadata) ?? "";

  const { html, status: fetchStatus } = await fetchPublicProfileHtmlForProbe(profileUrl);
  const htmlSignals = html
    ? detectExperienceSignalsInHtml(html)
    : {
        experienceSectionFound: false,
        structuredExperienceArrayFound: false,
        jsonLdWorksFor: false,
        embeddedCompanyNameHits: 0,
      };

  let sourceAvailable: SourceAvailability = "none";
  let sourceType = "none";
  let combinedRaw: ProfileExperienceRole[] = [];

  if (postRoles.length > 0) {
    sourceAvailable = "post_extra_json";
    sourceType = "scraper_payload_experience_array";
    combinedRaw = postRoles.map((r) => ({
      ...r,
      experienceItemSource: r.experienceItemSource ?? "scraper_payload_experience_array",
    }));
  } else if (cachedRoles.length > 0) {
    sourceAvailable = "person_employment_cache";
    sourceType = inferExperienceItemSourceFromAnalysisMethod(analysisMethod);
    combinedRaw = cachedRoles.map((r) => ({
      ...r,
      experienceItemSource:
        r.experienceItemSource ?? inferExperienceItemSourceFromAnalysisMethod(analysisMethod),
    }));
  } else if (html) {
    const htmlRoles = extractExperienceRolesFromProfileHtml(html);
    if (htmlRoles.length > 0) {
      sourceAvailable = "public_profile_html";
      sourceType = "public_profile_html_experience_section";
      combinedRaw = htmlRoles;
    } else if (htmlSignals.structuredExperienceArrayFound) {
      sourceAvailable = "public_profile_html";
      sourceType = "public_profile_html_experience_section (signals only, parse failed)";
    }
  }

  let openaiAttempted: "yes" | "no" = "no";
  let openaiRawRoleCount = 0;
  let openaiAnalysisMethod = "";

  if (args.tryOpenAi && process.env.OPENAI_API_KEY?.trim()) {
    openaiAttempted = "yes";
    const { fetchLinkedInEmploymentViaOpenAI } = await import("./enrich-linkedin-profile-employment");
    const fetched = await fetchLinkedInEmploymentViaOpenAI({
      profileUrl,
      headlineHint: headline,
      tryPublicHtml: Boolean(html),
    });
    openaiAnalysisMethod = fetched.analysisMethod;
    openaiRawRoleCount = fetched.experienceItems.length;
    if (combinedRaw.length === 0 && fetched.experienceItems.length > 0) {
      sourceAvailable = "openai_inference";
      sourceType = inferExperienceItemSourceFromAnalysisMethod(fetched.analysisMethod);
      combinedRaw = fetched.experienceItems;
    }
  }

  const validated = validateProfileExperienceRoles(combinedRaw, {
    headline,
    analysisMethod: analysisMethod || openaiAnalysisMethod,
  });

  const primary = validated.roles[0];
  let employmentSource = "unknown";
  let employmentConfidence = "0";
  let currentTitle = "";
  let currentCompany = "";

  if (validated.roles.length > 0) {
    const { resolveProspectEmployment } = await import("./resolve-employment");
    const resolved = resolveProspectEmployment({
      experienceRoles: validated.roles,
      structuredProfile: null,
      headlineEmployment: null,
      headlineAmbiguous: true,
    });
    employmentSource = resolved.employmentSource;
    employmentConfidence = String(resolved.employmentConfidence);
    currentTitle = resolved.currentTitle ?? "";
    currentCompany = resolved.currentCompany ?? "";
  }

  const rejectedItems = combinedRaw.filter(
    (r) => !validated.roles.some((v) => v.title === r.title && v.company === r.company)
  );

  return {
    profileUrl,
    headline: headline.slice(0, 300),
    profileFetchAttempted: "yes",
    profileFetchStatus: fetchStatus,
    sourceAvailable,
    sourceType,
    rawProfileHtmlAvailable: html ? "yes" : "no",
    experienceSectionFound: htmlSignals.experienceSectionFound ? "yes" : "no",
    structuredExperienceArrayFound: htmlSignals.structuredExperienceArrayFound ? "yes" : "no",
    postExtraJsonRoleCount: postRoles.length,
    cachedDbRawRoleCount: cachedRoles.length,
    cachedAnalysisMethod: analysisMethod,
    openaiAttempted,
    openaiRawRoleCount,
    openaiAnalysisMethod,
    rawProfileExperienceInputCount: combinedRaw.length,
    validProfileExperienceInputCount: validated.roles.length,
    rejectedProfileExperienceInputCount: validated.rejectedCount,
    acceptedExperienceItems: formatRolesBrief(validated.roles),
    rejectedExperienceItems: formatRolesBrief(rejectedItems),
    rejectionReason: validated.rejectionReasons.slice(0, 3).join("; "),
    evidenceExcerpt: (primary?.evidenceExcerpt ?? "").slice(0, 400),
    currentTitle,
    currentCompany,
    employmentSource,
    employmentConfidence,
  };
}
