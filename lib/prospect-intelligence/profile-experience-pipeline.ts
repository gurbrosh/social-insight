import type { AppPrismaClient } from "@/lib/prisma";
import { extractProfileExperienceRolesFromExtraJson } from "./extract-profile-experience";

export type ProfileExperiencePipelineStatus = {
  /** Experience role arrays are produced by OpenAI in linkedin-profile-validator when validation runs. */
  collectionImplemented: boolean;
  /** Primary store: PersonEmployment.validation_metadata.experienceItems (JSON). */
  storageLocation: string;
  /** Also merged from post extraJson when scraper embeds experience arrays (currently rare). */
  secondaryStorage: string;
  /** Wired via gatherEvidenceFromPostRow → profileExperienceRoles → evidence metadata. */
  availableToGatherEvidence: boolean;
  /** Random sample script loads PersonEmployment + extraJson via mergeProfileExperienceRoles. */
  availableToRandomSample: boolean;
  prisma: {
    personEmploymentRowCount: number;
    personEmploymentWithValidationMetadata: number;
    linkedinProjectProfileCount: number;
  };
  postExtraJsonSample: {
    postsChecked: number;
    postsWithExperienceRoles: number;
    typicalAuthorFields: string[];
  };
  whyInputCountZeroWhenEmpty: string;
  enrichmentStep: string;
};

/**
 * Audit why profile_experience_input_count is 0 in classification exports.
 * Does not call external APIs.
 */
export async function auditProfileExperiencePipeline(
  prisma: AppPrismaClient,
  options?: { postSampleSize?: number }
): Promise<ProfileExperiencePipelineStatus> {
  const sampleSize = options?.postSampleSize ?? 500;
  const personEmploymentRowCount = await prisma.personEmployment.count();
  const personEmploymentWithValidationMetadata = await prisma.personEmployment.count({
    where: { validation_metadata: { not: null } },
  });
  const linkedinProjectProfileCount = await prisma.projectProfile.count({
    where: { platform: "linkedin", deleted_at: null },
  });

  const posts = await prisma.post.findMany({
    where: { platform: "linkedin" },
    take: sampleSize,
    select: { extraJson: true },
  });

  let postsWithExperienceRoles = 0;
  let typicalAuthorFields: string[] = [];
  for (const p of posts) {
    const roles = extractProfileExperienceRolesFromExtraJson(p.extraJson);
    if (roles.length > 0) postsWithExperienceRoles++;
    if (!typicalAuthorFields.length && p.extraJson && typeof p.extraJson === "object") {
      const author = (p.extraJson as Record<string, unknown>).author;
      if (author && typeof author === "object") {
        typicalAuthorFields = Object.keys(author as object).slice(0, 16);
      }
    }
  }

  const whyInputCountZeroWhenEmpty =
    personEmploymentRowCount === 0 && postsWithExperienceRoles === 0
      ? "No PersonEmployment rows and no experience arrays in post extraJson — classifier receives zero roles, so profile_experience_input_count is 0 and current_company uses headline fallback only."
      : personEmploymentRowCount > 0 && postsWithExperienceRoles === 0
        ? "PersonEmployment exists but may lack experienceItems in validation_metadata; check JSON payload."
        : "Some experience roles exist in DB or extraJson — profile_experience_input_count should be > 0 for matching profiles.";

  return {
    collectionImplemented: true,
    storageLocation: "PersonEmployment.validation_metadata.experienceItems",
    secondaryStorage: "Post.extraJson (experience/positions arrays when scraper provides them)",
    availableToGatherEvidence: true,
    availableToRandomSample: true,
    prisma: {
      personEmploymentRowCount,
      personEmploymentWithValidationMetadata,
      linkedinProjectProfileCount,
    },
    postExtraJsonSample: {
      postsChecked: posts.length,
      postsWithExperienceRoles,
      typicalAuthorFields,
    },
    whyInputCountZeroWhenEmpty,
    enrichmentStep:
      "Run POST /api/projects/validate-linkedin-profiles with OpenAI for target profile URLs (populates experienceItems). Optional: extend Apify LinkedIn profile scraper to persist full experience arrays into post extraJson.",
  };
}

export function formatPipelineStatusReport(status: ProfileExperiencePipelineStatus): string {
  const lines = [
    "--- Profile experience data pipeline ---",
    `Is experience/roles data collected? ${status.collectionImplemented ? "yes (via profile validation / optional scraper)" : "no"}`,
    `Where stored: ${status.storageLocation}`,
    `Secondary: ${status.secondaryStorage}`,
    `Available to gatherEvidenceFromPostRow? ${status.availableToGatherEvidence ? "yes" : "no"}`,
    `Available to random sample/export? ${status.availableToRandomSample ? "yes" : "no"}`,
    `Prisma PersonEmployment rows: ${status.prisma.personEmploymentRowCount} (with validation_metadata: ${status.prisma.personEmploymentWithValidationMetadata})`,
    `Prisma ProjectProfile (linkedin): ${status.prisma.linkedinProjectProfileCount}`,
    `Post extraJson sample (${status.postExtraJsonSample.postsChecked} posts): ${status.postExtraJsonSample.postsWithExperienceRoles} with experience role arrays`,
    `Typical author fields in extraJson: ${status.postExtraJsonSample.typicalAuthorFields.join(", ") || "(none)"}`,
    `Why profile_experience_input_count is 0: ${status.whyInputCountZeroWhenEmpty}`,
    `Enrichment needed: ${status.enrichmentStep}`,
  ];
  return lines.join("\n");
}
