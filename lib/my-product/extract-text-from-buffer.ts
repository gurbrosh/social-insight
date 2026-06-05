export type ExtractTextResult =
  | { ok: true; text: string; truncated: boolean }
  | { ok: false; error: string };

const MAX_OUT = 200_000;

function truncate(s: string): { text: string; truncated: boolean } {
  if (s.length <= MAX_OUT) return { text: s, truncated: false };
  return { text: s.slice(0, MAX_OUT) + "\n…[truncated]", truncated: true };
}

function extFromName(filename: string): string {
  const i = filename.lastIndexOf(".");
  if (i < 0) return "";
  return filename.slice(i + 1).toLowerCase();
}

/**
 * Extract plain text from an uploaded file buffer (by filename extension).
 */
export async function extractTextFromBuffer(
  buffer: Buffer,
  filename: string,
  contentTypeHint?: string | null
): Promise<ExtractTextResult> {
  const ext = extFromName(filename);
  const ct = (contentTypeHint || "").toLowerCase();

  if (ext === "txt" || ext === "md" || ext === "markdown" || ct.includes("text/plain")) {
    try {
      const t = buffer.toString("utf8");
      const { text, truncated } = truncate(t);
      return { ok: true, text, truncated };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Decode failed" };
    }
  }

  if (ext === "pdf" || ct.includes("application/pdf")) {
    try {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: buffer });
      const textResult = await parser.getText();
      await parser.destroy();
      const raw = (textResult.text || "").replace(/\s+/g, " ").trim();
      const { text, truncated } = truncate(raw);
      return { ok: true, text, truncated };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "PDF parse failed" };
    }
  }

  if (
    ext === "docx" ||
    ct.includes("application/vnd.openxmlformats-officedocument.wordprocessingml")
  ) {
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      const raw = result.value || "";
      const { text, truncated } = truncate(raw.replace(/\s+/g, " ").trim());
      return { ok: true, text, truncated };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "DOCX parse failed" };
    }
  }

  if (ext === "html" || ext === "htm" || ct.includes("text/html")) {
    try {
      const cheerio = await import("cheerio");
      const $ = cheerio.load(buffer.toString("utf8"));
      $("script, style, noscript").remove();
      const t = $("body").text() || $.root().text();
      const cleaned = t.replace(/\s+/g, " ").trim();
      const { text, truncated } = truncate(cleaned);
      return { ok: true, text, truncated };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "HTML parse failed" };
    }
  }

  return {
    ok: false,
    error: `Unsupported file type (.${ext || "unknown"}). Use txt, md, pdf, docx, or html.`,
  };
}
