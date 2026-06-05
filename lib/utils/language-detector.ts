/**
 * Language Detection Utility
 * Uses franc-min to detect language from text content
 */

import { franc } from "franc-min";

// ISO 639-3 to ISO 639-1 mapping for common languages
const languageMap: Record<string, string | null> = {
  eng: "en", // English
  spa: "es", // Spanish
  fra: "fr", // French
  deu: "de", // German
  ita: "it", // Italian
  por: "pt", // Portuguese
  rus: "ru", // Russian
  jpn: "ja", // Japanese
  kor: "ko", // Korean
  cmn: "zh", // Chinese (Mandarin)
  ara: "ar", // Arabic
  hin: "hi", // Hindi
  nld: "nl", // Dutch
  pol: "pl", // Polish
  tur: "tr", // Turkish
  vie: "vi", // Vietnamese
  tha: "th", // Thai
  swe: "sv", // Swedish
  dan: "da", // Danish
  fin: "fi", // Finnish
  nor: "no", // Norwegian
  und: null, // Undefined/Unknown
};

/**
 * Detect language from text content
 * @param text - Text content to analyze
 * @param minLength - Minimum text length required for detection (default: 10)
 * @returns ISO 639-1 language code (e.g., "en") or null if unknown/too short
 */
export function detectLanguage(text: string | null | undefined, minLength = 10): string | null {
  if (!text || text.trim().length < minLength) {
    return null;
  }

  try {
    // franc returns ISO 639-3 code (3 letters)
    const detected = franc(text, { minLength });

    // Convert to ISO 639-1 (2 letters) using our mapping
    const languageCode = languageMap[detected];

    return languageCode || null;
  } catch (error) {
    console.error("Error detecting language:", error);
    return null;
  }
}

/**
 * Get language name from code
 */
export function getLanguageName(code: string | null): string {
  const names: Record<string, string> = {
    en: "English",
    es: "Spanish",
    fr: "French",
    de: "German",
    it: "Italian",
    pt: "Portuguese",
    ru: "Russian",
    ja: "Japanese",
    ko: "Korean",
    zh: "Chinese",
    ar: "Arabic",
    hi: "Hindi",
    nl: "Dutch",
    pl: "Polish",
    tr: "Turkish",
    vi: "Vietnamese",
    th: "Thai",
    sv: "Swedish",
    da: "Danish",
    fi: "Finnish",
    no: "Norwegian",
  };

  return code ? names[code] || code.toUpperCase() : "Unknown";
}
