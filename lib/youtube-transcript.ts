/**
 * Extract plain-text transcript from YouTube scraper output.
 * Scraper provides subtitles[].srt (SRT format: sequence, timestamp line, text lines).
 */

/**
 * Convert SRT subtitle content to plain text (strip sequence numbers and timestamps).
 */
export function srtToPlainText(srt: string): string {
  if (!srt || typeof srt !== "string") return "";
  const lines = srt.trim().split(/\r?\n/);
  const textLines: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    // Skip sequence number (digits only)
    if (/^\d+$/.test(line)) {
      i++;
      continue;
    }
    // Skip timestamp line (e.g. "00:00:0,080 --> 00:00:2,400")
    if (/^\d{2}:\d{2}:\d{2}[,.]\d+.*-->.*/.test(line) || /^\d{2}:\d{2}:\d{2}[,.]\d+/.test(line)) {
      i++;
      continue;
    }
    if (line.length > 0) {
      textLines.push(line);
    }
    i++;
  }
  return textLines.join("\n").trim();
}

/**
 * Extract transcript from a YouTube scraper item.
 * 1. Prefer subtitles: first available subtitle's .srt string.
 * 2. Fall back to text (video description) when subtitles are null/empty — treat as transcript for filtering and relevance.
 */
export function extractTranscriptFromYouTubeItem(item: any): string | null {
  const subtitles = item?.subtitles;
  if (Array.isArray(subtitles) && subtitles.length > 0) {
    const first = subtitles[0];
    const srt = first?.srt ?? (typeof first === "string" ? first : null);
    if (srt && typeof srt === "string") {
      const plain = srtToPlainText(srt);
      if (plain.length > 0) return plain;
    }
  }
  // Fall back to text (video description) — treat like transcript for filtering and relevance
  const text = item?.text;
  if (text && typeof text === "string") {
    const trimmed = text.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}
