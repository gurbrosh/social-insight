/**
 * Utility functions for normalizing keywords to be more natural and human-like
 * for social media monitoring
 */

/**
 * Normalize a single keyword according to social media best practices:
 * - Split compound phrases (e.g., "prompt & input security" → ["prompt security", "input security"])
 * - Remove generic words like "solutions"
 * - Make keywords more natural/human-like
 */
export function normalizeKeyword(keyword: string): string[] {
  if (!keyword || keyword.trim().length === 0) {
    return [];
  }

  let normalized = keyword.trim().toLowerCase();

  // Remove "solutions", "innovations", and similar generic words
  normalized = normalized
    .replace(/\b(solutions?|services?|tools?|platforms?|software|systems?|innovations?)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  // Remove leading generic words like "technology", "digital", "ai", etc.
  // Only remove if they're at the start and followed by another word
  const leadingWordsToRemove = /\b(technology|digital|ai|artificial intelligence|tech)\s+/i;
  if (leadingWordsToRemove.test(normalized)) {
    normalized = normalized.replace(leadingWordsToRemove, "").trim();
  }

  // Split compound phrases with "&" or "and"
  // For "prompt & input security", we want: ["prompt security", "input security"]
  const separators = [/\s+&\s+/, /\s+and\s+/i];
  let keywords: string[] = [normalized];

  for (const separator of separators) {
    const newKeywords: string[] = [];
    for (const kw of keywords) {
      if (separator.test(kw)) {
        // Split on separator
        const parts = kw
          .split(separator)
          .map((p) => p.trim())
          .filter((p) => p.length > 0);
        if (parts.length > 1) {
          // For phrases like "prompt & input security":
          // - Split into ["prompt", "input security"]
          // - If the last part contains multiple words, try to attach it to each first part
          // - Otherwise, just use the parts as-is

          const lastPart = parts[parts.length - 1];
          const lastPartWords = lastPart.split(/\s+/);

          if (lastPartWords.length > 1 && parts.length === 2) {
            // Two-part phrase where last part has multiple words
            // "prompt & input security" -> ["prompt security", "input security"]
            const firstPart = parts[0];
            const lastWord = lastPartWords[lastPartWords.length - 1];

            // Create combinations: first part + last word, and each middle part + last word
            for (let i = 0; i < parts.length; i++) {
              const part = parts[i];
              if (i === parts.length - 1) {
                // Last part: use as-is
                newKeywords.push(part);
              } else {
                // Earlier parts: combine with last word of the last part
                const combined = `${part} ${lastWord}`.trim();
                if (combined.length > 0) {
                  newKeywords.push(combined);
                }
              }
            }
          } else {
            // Simple split: just use the parts
            newKeywords.push(...parts);
          }
        } else {
          newKeywords.push(kw);
        }
      } else {
        newKeywords.push(kw);
      }
    }
    keywords = newKeywords;
  }

  // Clean up: remove empty strings, normalize spacing, remove duplicates
  // Also remove leading generic words from each keyword
  // Enforce 2-word maximum per keyword
  const cleaned = keywords
    .map((k) => {
      let cleanedKw = k.trim().replace(/\s+/g, " ");
      // Remove leading generic words from each keyword
      const leadingWordsToRemove = /\b(technology|digital|ai|artificial intelligence|tech)\s+/i;
      if (leadingWordsToRemove.test(cleanedKw)) {
        cleanedKw = cleanedKw.replace(leadingWordsToRemove, "").trim();
      }
      // Enforce 2-word maximum: take only first 2 words
      const words = cleanedKw.split(/\s+/);
      if (words.length > 2) {
        cleanedKw = words.slice(0, 2).join(" ");
      }
      return cleanedKw;
    })
    .filter((k) => k.length > 0 && k.length < 100) // Reasonable length limit
    .filter((k, index, self) => self.indexOf(k) === index); // Remove duplicates

  return cleaned.length > 0 ? cleaned : [normalized]; // Fallback to original if all were filtered out
}

/**
 * Normalize an array of keywords, applying all normalization rules
 */
export function normalizeKeywords(keywords: string[]): string[] {
  const normalizedSet = new Set<string>();

  for (const keyword of keywords) {
    const normalized = normalizeKeyword(keyword);
    normalized.forEach((kw) => normalizedSet.add(kw));
  }

  return Array.from(normalizedSet);
}

/**
 * Fix common typos in a keyword string.
 * Examples: "devlpoment" -> "development", "securtiy" -> "security"
 */
export function fixKeywordTypos(keyword: string): string {
  if (!keyword || keyword.trim().length === 0) {
    return keyword;
  }

  // Common typo corrections dictionary
  const typoCorrections: Record<string, string> = {
    // Development-related
    devlpoment: "development",
    devlopment: "development",
    developement: "development",
    devlopmnt: "development",

    // Security-related
    securtiy: "security",
    secuirty: "security",
    securiry: "security",

    // Application-related
    applicaiton: "application",
    appliction: "application",
    aplication: "application",

    // Technology-related
    techology: "technology",
    technolgy: "technology",

    // Management-related
    managment: "management",
    managemnt: "management",

    // Framework-related
    framwork: "framework",
    framewrk: "framework",

    // Platform-related
    platfrom: "platform",
    platoform: "platform",

    // Integration-related
    integraton: "integration",
    integartion: "integration",

    // Authentication-related
    authetnication: "authentication",
    authenticaion: "authentication",

    // Infrastructure-related
    infrastrucutre: "infrastructure",
    infrastrcuture: "infrastructure",
  };

  // Split by spaces to handle multi-word keywords
  const words = keyword.trim().split(/\s+/);
  const correctedWords = words.map((word) => {
    const wordLower = word.toLowerCase();
    // Check if word matches a typo (case-insensitive)
    for (const [typo, correction] of Object.entries(typoCorrections)) {
      if (wordLower === typo) {
        // Preserve original capitalization style
        if (word[0] === word[0].toUpperCase()) {
          return correction.charAt(0).toUpperCase() + correction.slice(1);
        }
        return correction;
      }
    }
    return word; // No correction needed
  });

  return correctedWords.join(" ");
}
