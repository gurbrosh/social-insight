/**
 * Title similarity and deduplication for email report sections (aligned with lib/news-analysis.ts).
 */

export function calculateTitleSimilarity(title1: string, title2: string): number {
  const normalize = (str: string) => str.toLowerCase().trim().replace(/\s+/g, " ");
  const norm1 = normalize(title1);
  const norm2 = normalize(title2);

  if (norm1 === norm2) return 1.0;

  const words1 = new Set(norm1.split(" "));
  const words2 = new Set(norm2.split(" "));
  const intersection = new Set([...words1].filter((x) => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  const jaccard = intersection.size / union.size;

  let phraseBonus = 0;
  for (const word of words1) {
    if (norm2.includes(word)) {
      const phrase1 = norm1.substring(
        norm1.indexOf(word),
        Math.min(norm1.indexOf(word) + 50, norm1.length)
      );
      const phrase2 = norm2.substring(
        norm2.indexOf(word),
        Math.min(norm2.indexOf(word) + 50, norm2.length)
      );
      const words1_sub = phrase1.split(" ").slice(0, 4);
      const words2_sub = phrase2.split(" ").slice(0, 4);
      let commonLength = 0;
      for (let i = 0; i < Math.min(words1_sub.length, words2_sub.length); i++) {
        if (words1_sub[i] === words2_sub[i]) {
          commonLength++;
        } else {
          break;
        }
      }
      if (commonLength >= 3) {
        phraseBonus += 0.3;
      }
    }
  }

  return Math.min(jaccard + phraseBonus, 1.0);
}

const DEFAULT_SIMILARITY_THRESHOLD = 0.6;

/**
 * Dedupe by title similarity; keeps first item in sort order (call after sorting by score desc).
 * Extra fields (e.g. `raw`) are preserved on each item.
 */
export function deduplicateByTitle<T extends { id: string; title: string }>(
  items: T[],
  similarityThreshold: number = DEFAULT_SIMILARITY_THRESHOLD
): T[] {
  if (items.length === 0) return items;

  const result: T[] = [];
  const processed = new Set<string>();

  for (let i = 0; i < items.length; i++) {
    if (processed.has(items[i].id)) continue;

    const current = items[i];
    for (let j = i + 1; j < items.length; j++) {
      if (processed.has(items[j].id)) continue;
      if (calculateTitleSimilarity(current.title, items[j].title) > similarityThreshold) {
        processed.add(items[j].id);
      }
    }

    result.push(current);
    processed.add(current.id);
  }

  return result;
}

export function excerptForDedupe(text: string | null | undefined, maxLen = 200): string {
  const t = (text || "").trim();
  if (!t) return "";
  return t.length <= maxLen ? t : t.slice(0, maxLen);
}
