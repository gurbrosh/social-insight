import { Theme, ThemeRegistry, ThemeValidationResult, CSSGenerationOptions } from "./types";

// Base themes
import { lightTheme } from "./base/light";
import { darkTheme } from "./base/dark";

// Custom themes
import { oceanTheme } from "./custom/ocean";
import { forestTheme } from "./custom/forest";
import { midnightTheme } from "./custom/midnight";

/**
 * Complete theme registry
 * Add new themes here to make them available throughout the app
 */
export const themes: ThemeRegistry = {
  light: lightTheme,
  dark: darkTheme,
  ocean: oceanTheme,
  forest: forestTheme,
  midnight: midnightTheme,
};

/**
 * Get all available theme names
 */
export const getThemeNames = (): string[] => {
  return Object.keys(themes);
};

/**
 * Get themes by category
 */
export const getThemesByCategory = (category: "base" | "custom"): Theme[] => {
  return Object.values(themes).filter((theme) => theme.category === category);
};

/**
 * Get a specific theme by name
 */
export const getTheme = (name: string): Theme | undefined => {
  return themes[name];
};

/**
 * Get all themes as array
 */
export const getAllThemes = (): Theme[] => {
  return Object.values(themes);
};

/**
 * Get theme names for next-themes provider
 */
export const getNextThemesConfig = (): string[] => {
  // Include system theme and all custom themes
  return [
    "light",
    "dark",
    "system",
    ...getThemeNames().filter((name) => !["light", "dark"].includes(name)),
  ];
};

/**
 * Generate CSS from a theme object
 */
export const generateThemeCSS = (theme: Theme, options: CSSGenerationOptions = {}): string => {
  const { includeComments = true, minify = false, variablePrefix = "--" } = options;

  const cssLines: string[] = [];

  // Add theme selector
  cssLines.push(`.${theme.name} {`);

  if (includeComments) {
    cssLines.push(`  /* ${theme.label} - ${theme.description} */`);
  }

  // Add color variables
  Object.entries(theme.colors).forEach(([key, value]) => {
    const cssVar = key.replace(/([A-Z])/g, "-$1").toLowerCase();
    cssLines.push(`  ${variablePrefix}${cssVar}: ${value};`);
  });

  // Add radius variable
  cssLines.push(`  ${variablePrefix}radius: ${theme.radius};`);

  cssLines.push("}");

  if (minify) {
    return cssLines.join("").replace(/\s+/g, " ").trim();
  }

  return cssLines.join("\n");
};

/**
 * Generate CSS for all themes
 */
export const generateAllThemesCSS = (options: CSSGenerationOptions = {}): string => {
  const { includeComments = true } = options;

  const cssBlocks: string[] = [];

  if (includeComments) {
    cssBlocks.push("/* Generated Theme Styles */");
    cssBlocks.push("/* This file is auto-generated from theme objects */");
    cssBlocks.push("");
  }

  // Generate CSS for each theme (skip light and dark as they're handled separately)
  const customThemes = Object.values(themes).filter(
    (theme) => !["light", "dark"].includes(theme.name)
  );

  customThemes.forEach((theme) => {
    cssBlocks.push(generateThemeCSS(theme, options));
    if (!options.minify) {
      cssBlocks.push(""); // Add spacing between themes
    }
  });

  return cssBlocks.join("\n");
};

/**
 * Validate theme object
 */
export const validateTheme = (theme: Theme): ThemeValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check required fields
  if (!theme.name) errors.push("Theme name is required");
  if (!theme.label) errors.push("Theme label is required");
  if (!theme.category) errors.push("Theme category is required");

  // Check color format (basic HSL validation)
  Object.entries(theme.colors).forEach(([key, value]) => {
    if (!value || typeof value !== "string") {
      errors.push(`Color '${key}' must be a string`);
    } else if (!/^\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%$/.test(value.trim())) {
      warnings.push(`Color '${key}' should be in HSL format (e.g., "210 100% 50%")`);
    }
  });

  // Check radius format
  if (!theme.radius || !theme.radius.includes("rem")) {
    warnings.push("Radius should use rem units for consistency");
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
};

/**
 * Validate all themes
 */
export const validateAllThemes = (): Record<string, ThemeValidationResult> => {
  const results: Record<string, ThemeValidationResult> = {};

  Object.entries(themes).forEach(([name, theme]) => {
    results[name] = validateTheme(theme);
  });

  return results;
};

// Export types for external use
export type { Theme, ThemeRegistry, ThemeValidationResult, CSSGenerationOptions } from "./types";

// Export individual themes for direct import
export { lightTheme, darkTheme, oceanTheme, forestTheme, midnightTheme };
