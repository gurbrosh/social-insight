/**
 * Stored in Project.my_product_summary_json (camelCase JSON).
 */
export type MyProductSummaryJson = {
  highLevelDescription: string;
  keyInnovativeIdeas: string[];
  differentiators: string | null;
  intendedClients: string | null;
};

export function parseMyProductSummaryJson(
  raw: string | null | undefined
): MyProductSummaryJson | null {
  if (raw == null || raw.trim() === "") return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const highLevelDescription =
      typeof o.highLevelDescription === "string" ? o.highLevelDescription : "";
    const keyInnovativeIdeas = Array.isArray(o.keyInnovativeIdeas)
      ? o.keyInnovativeIdeas.filter((x): x is string => typeof x === "string")
      : [];
    const differentiators =
      o.differentiators === null || o.differentiators === undefined
        ? null
        : typeof o.differentiators === "string"
          ? o.differentiators
          : null;
    const intendedClients =
      o.intendedClients === null || o.intendedClients === undefined
        ? null
        : typeof o.intendedClients === "string"
          ? o.intendedClients
          : null;
    return { highLevelDescription, keyInnovativeIdeas, differentiators, intendedClients };
  } catch {
    return null;
  }
}

export function stringifyMyProductSummaryJson(s: MyProductSummaryJson): string {
  return JSON.stringify(s);
}
