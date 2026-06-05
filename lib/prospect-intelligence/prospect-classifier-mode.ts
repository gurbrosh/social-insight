export type ProspectClassifierMode = "deterministic" | "full";

export function parseProspectClassifierMode(
  raw: string | undefined
): ProspectClassifierMode | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "deterministic" || v === "deterministic-only") return "deterministic";
  if (v === "full" || v === "hybrid" || v === "hybrid-full") return "full";
  return null;
}

export function resolveProspectClassifierMode(
  explicit?: ProspectClassifierMode
): ProspectClassifierMode {
  if (explicit) return explicit;
  const fromEnv = parseProspectClassifierMode(process.env.PROSPECT_CLASSIFIER_MODE);
  if (fromEnv) return fromEnv;
  return "full";
}
