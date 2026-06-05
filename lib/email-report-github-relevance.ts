import { openaiChatJsonObject } from "@/lib/response-generator/openai-json";
import { parseMyProductSummaryJson } from "@/lib/my-product/summary-types";

export type GithubRepoForScoring = {
  /** Post.id */
  postId: number;
  repoFullName: string;
  titleLine: string;
  summaryLine: string;
  topicsLine: string;
};

/**
 * Build a single text block describing the project's product for LLM scoring.
 */
export function buildProductDescriptionForEmailReport(project: {
  name: string;
  description: string | null;
  monitoring_focus: string | null;
  my_product_name: string | null;
  my_product_focus_text: string | null;
  my_product_summary_json: string | null;
}): string {
  const parts: string[] = [];
  const summary = parseMyProductSummaryJson(project.my_product_summary_json);
  if (project.my_product_name?.trim()) {
    parts.push(`Product name: ${project.my_product_name.trim()}`);
  }
  if (project.my_product_focus_text?.trim()) {
    parts.push(`Focus: ${project.my_product_focus_text.trim()}`);
  }
  if (summary?.highLevelDescription?.trim()) {
    parts.push(`Summary: ${summary.highLevelDescription.trim()}`);
  }
  if (summary?.keyInnovativeIdeas?.length) {
    parts.push(`Key ideas: ${summary.keyInnovativeIdeas.join("; ")}`);
  }
  if (summary?.differentiators?.trim()) {
    parts.push(`Differentiators: ${summary.differentiators.trim()}`);
  }
  if (summary?.intendedClients?.trim()) {
    parts.push(`Intended clients: ${summary.intendedClients.trim()}`);
  }
  if (project.monitoring_focus?.trim()) {
    parts.push(`Monitoring focus: ${project.monitoring_focus.trim()}`);
  }
  if (project.description?.trim()) {
    parts.push(`Project description: ${project.description.trim()}`);
  }
  if (parts.length === 0) {
    parts.push(`Project: ${project.name}`);
  }
  return parts.join("\n");
}

/**
 * Returns relevance 0–100 per postId. Missing keys get null (caller excludes or uses fallback).
 */
export async function scoreGithubReposAgainstProduct(
  productDescription: string,
  repos: GithubRepoForScoring[]
): Promise<Map<number, number | null>> {
  const out = new Map<number, number | null>();
  if (repos.length === 0) return out;

  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.warn(
      "[github-product-relevance] OPENAI_API_KEY missing; GitHub product relevance scores skipped"
    );
    for (const r of repos) out.set(r.postId, null);
    return out;
  }

  const payload = repos.map((r) => ({
    postId: r.postId,
    repo: r.repoFullName,
    title: r.titleLine,
    summary: r.summaryLine,
    topics: r.topicsLine,
  }));

  const system = `You score how relevant each open-source repository is to the described product (0 = unrelated, 100 = highly relevant for the product's goals and customers). Respond with JSON only: {"scores":[{"postId":number,"relevance":number}]}. relevance must be an integer from 0 to 100.`;

  const user = `Product context:\n${productDescription}\n\nRepositories:\n${JSON.stringify(payload, null, 2)}`;

  try {
    const parsed = await openaiChatJsonObject({
      modelKind: "relevance",
      system,
      user,
      temperature: 0.2,
      maxTokens: 2048,
    });

    const scores = parsed.scores;
    if (!Array.isArray(scores)) {
      throw new Error("Invalid scores array");
    }
    for (const row of scores) {
      if (
        row &&
        typeof row === "object" &&
        typeof (row as { postId?: unknown }).postId === "number" &&
        typeof (row as { relevance?: unknown }).relevance === "number"
      ) {
        const postId = (row as { postId: number }).postId;
        let rel = Math.round((row as { relevance: number }).relevance);
        rel = Math.max(0, Math.min(100, rel));
        out.set(postId, rel);
      }
    }
  } catch (e) {
    console.error("[github-product-relevance] GitHub product relevance LLM failed:", e);
    for (const r of repos) out.set(r.postId, null);
    return out;
  }

  for (const r of repos) {
    if (!out.has(r.postId)) out.set(r.postId, null);
  }
  return out;
}
