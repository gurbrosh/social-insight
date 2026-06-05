/**
 * Complete color system for shadcn/ui themes
 * All colors use HSL format: "hue saturation% lightness%"
 */
export interface ThemeColors {
  // Base colors
  background: string;
  foreground: string;

  // Card colors
  card: string;
  cardForeground: string;

  // Popover colors
  popover: string;
  popoverForeground: string;

  // Primary colors (brand/main actions)
  primary: string;
  primaryForeground: string;

  // Secondary colors (supporting actions)
  secondary: string;
  secondaryForeground: string;

  // Muted colors (disabled/subtle elements)
  muted: string;
  mutedForeground: string;

  // Accent colors (highlights/focus states)
  accent: string;
  accentForeground: string;

  // Destructive colors (errors/delete actions)
  destructive: string;
  destructiveForeground: string;

  // Interactive elements
  border: string;
  input: string;
  ring: string;
}

/**
 * Theme category types
 */
export type ThemeCategory = "base" | "custom";

/**
 * Complete theme definition
 */
export interface Theme {
  /** Unique theme identifier (used as CSS class) */
  name: string;

  /** Human-readable theme name */
  label: string;

  /** Theme description for UI */
  description: string;

  /** Theme category */
  category: ThemeCategory;

  /** Complete color palette */
  colors: ThemeColors;

  /** Border radius value */
  radius: string;

  /** Optional icon component name for theme toggle */
  icon?: string;

  /** Optional emoji for theme display */
  emoji?: string;
}

/**
 * Theme registry type
 */
export interface ThemeRegistry {
  [key: string]: Theme;
}

/**
 * Theme validation result
 */
export interface ThemeValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * CSS generation options
 */
export interface CSSGenerationOptions {
  /** Include CSS comments */
  includeComments?: boolean;

  /** Minify output */
  minify?: boolean;

  /** CSS variable prefix */
  variablePrefix?: string;
}
