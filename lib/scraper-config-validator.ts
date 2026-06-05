/**
 * Validate scraper config_json: must be valid JSON.
 * Supports placeholders {{keywords}}, {{keyword}}, {{urls}}, {{url}} for validation.
 * Normalizes smart quotes, BOM, and trims before parsing.
 */
export function validateScraperConfigJson(
  raw: string
): { ok: true } | { ok: false; error: string } {
  const trimmed = raw.trim().replace(/^\uFEFF/, "");
  const normalized = trimmed
    .replace(/\u201C/g, '"')
    .replace(/\u201D/g, '"')
    .replace(/\u2018/g, "'")
    .replace(/\u2019/g, "'");
  const tryParse = (str: string): boolean => {
    try {
      JSON.parse(str);
      return true;
    } catch {
      return false;
    }
  };
  if (tryParse(normalized)) return { ok: true };
  // Replace placeholders (case-insensitive for keywords/keyword) so validation can parse
  const withPlaceholders = normalized
    .replace(/"\{\{keywords\}\}"/gi, '"placeholder1,placeholder2"')
    .replace(/\[\s*"\{\{keywords\}\}"\s*\]/gi, '["placeholder1", "placeholder2"]')
    .replace(/\{\{keywords\}\}/gi, '["placeholder1", "placeholder2"]')
    .replace(/"\{\{keyword\}\}"/gi, '"placeholder"')
    .replace(/\{\{keyword\}\}/gi, '"placeholder"')
    .replace(/"\{\{urls\}\}"/g, '"https://discord.com/channels/123/456"')
    .replace(/\{\{urls\}\}/g, '["https://example.com"]')
    .replace(/"\{\{url\}\}"/g, '"https://example.com"')
    .replace(/\{\{url\}\}/g, '"https://example.com"')
    .replace(/\[user_selected_discord_urls\]/g, '"https://discord.com/channels/123/456"');
  if (tryParse(withPlaceholders)) return { ok: true };
  try {
    JSON.parse(withPlaceholders);
  } catch (e) {
    const message = e instanceof SyntaxError ? e.message : "Invalid JSON";
    return { ok: false, error: `Invalid JSON configuration: ${message}` };
  }
  return { ok: true };
}
