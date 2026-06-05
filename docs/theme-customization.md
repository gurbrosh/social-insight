# Theme Customization Guide

This guide explains how to create and customize themes using the TypeScript-based theme system in the CrunchyCone Vanilla Starter Project.

## Overview

The application uses a modern TypeScript theme system featuring:

- **Type Safety**: Complete TypeScript interfaces for theme definitions
- **Organization**: Themes structured in `base/` and `custom/` folders
- **Dynamic Loading**: Theme toggle automatically reads from registry
- **Validation**: Built-in theme validation and utility functions
- **Future-Proof**: Ready for Tailwind CSS v4

## Current Theme System

### Directory Structure

```
themes/
├── types.ts              # TypeScript interfaces and types
├── index.ts               # Theme registry and utility functions
├── base/                  # Core system themes
│   ├── light.ts          # Light theme
│   └── dark.ts           # Dark theme
└── custom/                # Custom themes
    ├── ocean.ts          # Ocean Blue theme 🌊
    ├── forest.ts         # Forest Green theme 🌲
    └── midnight.ts       # Midnight Purple theme 🌙
```

### Theme Structure

Each theme is a TypeScript object implementing the `Theme` interface:

```typescript
export interface Theme {
  name: string; // CSS class name (e.g., "ocean")
  label: string; // Display name (e.g., "Ocean Blue")
  description: string; // Theme description
  category: "base" | "custom";
  colors: ThemeColors; // Complete color palette
  radius: string; // Border radius
  icon?: string; // Optional Lucide icon name
  emoji?: string; // Optional emoji
}
```

### Color System

All colors use HSL format: `"hue saturation% lightness%"`

```typescript
export interface ThemeColors {
  // Base colors
  background: string; // Main page background
  foreground: string; // Primary text color

  // Component colors
  card: string; // Card backgrounds
  cardForeground: string; // Card text
  popover: string; // Popover backgrounds
  popoverForeground: string; // Popover text

  // Action colors
  primary: string; // Brand/main buttons
  primaryForeground: string; // Primary button text
  secondary: string; // Secondary buttons
  secondaryForeground: string; // Secondary button text

  // State colors
  muted: string; // Disabled/subtle elements
  mutedForeground: string; // Muted text
  accent: string; // Highlights/focus
  accentForeground: string; // Accent text
  destructive: string; // Error/delete actions
  destructiveForeground: string; // Destructive text

  // Interactive elements
  border: string; // Borders
  input: string; // Input backgrounds
  ring: string; // Focus rings
}
```

## Creating a New Theme

### Step 1: Create Theme File

Create `themes/custom/yourtheme.ts`:

```typescript
import { Theme } from "../types";

export const yourTheme: Theme = {
  name: "your-theme",
  label: "Your Theme",
  description: "Amazing custom colors",
  category: "custom",
  emoji: "⭐",
  radius: "0.5rem",
  colors: {
    background: "210 100% 98%",
    foreground: "210 100% 10%",
    card: "210 50% 100%",
    cardForeground: "210 100% 10%",
    popover: "210 50% 100%",
    popoverForeground: "210 100% 10%",
    primary: "200 100% 50%",
    primaryForeground: "210 100% 98%",
    secondary: "190 60% 85%",
    secondaryForeground: "210 100% 10%",
    muted: "200 30% 90%",
    mutedForeground: "210 50% 40%",
    accent: "190 80% 70%",
    accentForeground: "210 100% 10%",
    destructive: "350 80% 55%",
    destructiveForeground: "210 100% 98%",
    border: "210 40% 85%",
    input: "210 40% 85%",
    ring: "200 100% 50%",
  },
};
```

### Step 2: Register Theme

Add to `themes/index.ts`:

```typescript
// Import your theme
import { yourTheme } from "./custom/yourtheme";

// Add to theme registry
export const themes: ThemeRegistry = {
  // ... existing themes
  "your-theme": yourTheme,
};

// Export for direct access
export { yourTheme };
```

### Step 3: Generate CSS

Use the utility function to generate CSS:

```typescript
import { generateThemeCSS } from "@/themes";

const css = generateThemeCSS(yourTheme);
console.log(css);
```

Add the generated CSS to `app/globals.css`:

```css
.your-theme {
  --background: 210 100% 98%;
  --foreground: 210 100% 10%;
  --card: 210 50% 100%;
  /* ... other CSS variables */
}
```

### Step 4: Update ThemeProvider

Add your theme to `app/layout.tsx`:

```typescript
<ThemeProvider
  themes={["light", "dark", "system", "ocean", "forest", "midnight", "your-theme"]}
  defaultTheme="system"
  enableSystem
  disableTransitionOnChange
>
  {children}
</ThemeProvider>
```

## Using Theme Utilities

### Access Theme Data

```typescript
import { getAllThemes, getTheme, getThemesByCategory, getThemeNames } from "@/themes";

// Get all themes
const allThemes = getAllThemes();

// Get specific theme
const oceanTheme = getTheme("ocean");

// Get themes by category
const customThemes = getThemesByCategory("custom");
const baseThemes = getThemesByCategory("base");

// Get theme names for next-themes
const themeNames = getThemeNames();
```

### Validate Themes

```typescript
import { validateTheme, validateAllThemes } from "@/themes";

// Validate single theme
const result = validateTheme(yourTheme);
if (!result.isValid) {
  console.log("Errors:", result.errors);
  console.log("Warnings:", result.warnings);
}

// Validate all themes
const allResults = validateAllThemes();
```

### Generate CSS

```typescript
import { generateThemeCSS, generateAllThemesCSS } from "@/themes";

// Generate CSS for one theme
const css = generateThemeCSS(oceanTheme, {
  includeComments: true,
  minify: false,
});

// Generate CSS for all custom themes
const allCSS = generateAllThemesCSS({
  includeComments: true,
});
```

## Color Guidelines

### HSL Format Examples

- `"210 100% 50%"` = Bright blue (hsl(210, 100%, 50%))
- `"120 50% 30%"` = Dark green
- `"0 80% 60%"` = Red
- `"0 0% 100%"` = White
- `"0 0% 0%"` = Black

### Color Relationships

1. **Background/Foreground**: Ensure high contrast (4.5:1 minimum)
2. **Primary**: Should stand out as brand color
3. **Secondary**: Complementary to primary
4. **Muted**: Subtle, for disabled states
5. **Destructive**: Clear danger indication (reds)

### Accessibility

- **WCAG AA**: 4.5:1 contrast ratio for normal text
- **WCAG AAA**: 7:1 contrast ratio for enhanced accessibility
- **Test tools**: WebAIM Contrast Checker, Stark, etc.

## Theme Examples

### Seasonal Theme

```typescript
export const springTheme: Theme = {
  name: "spring",
  label: "Spring Fresh",
  description: "Fresh greens and soft pastels",
  category: "custom",
  emoji: "🌸",
  radius: "0.375rem",
  colors: {
    background: "100 30% 98%",
    foreground: "100 30% 10%",
    primary: "110 60% 45%",
    secondary: "90 40% 80%",
    accent: "140 50% 60%",
    destructive: "350 70% 50%",
    // ... other colors
  },
};
```

### High Contrast Theme

```typescript
export const highContrastTheme: Theme = {
  name: "high-contrast",
  label: "High Contrast",
  description: "Maximum contrast for accessibility",
  category: "custom",
  emoji: "🔳",
  radius: "0.25rem",
  colors: {
    background: "0 0% 100%",
    foreground: "0 0% 0%",
    primary: "0 0% 0%",
    primaryForeground: "0 0% 100%",
    border: "0 0% 0%",
    // ... other colors with maximum contrast
  },
};
```

### Dark Variant Theme

```typescript
export const neonTheme: Theme = {
  name: "neon",
  label: "Neon Cyber",
  description: "Cyberpunk-inspired dark theme",
  category: "custom",
  emoji: "⚡",
  radius: "0.75rem",
  colors: {
    background: "240 20% 8%",
    foreground: "300 100% 85%",
    primary: "300 100% 60%",
    secondary: "180 100% 40%",
    accent: "60 100% 50%",
    destructive: "0 100% 60%",
    // ... other colors
  },
};
```

## Advanced Features

### Theme Validation

The system includes built-in validation:

```typescript
// Validates required properties, color format, contrast ratios
const validation = validateTheme(theme);

if (!validation.isValid) {
  // Handle validation errors
  validation.errors.forEach((error) => console.error(error));
  validation.warnings.forEach((warning) => console.warn(warning));
}
```

### CSS Generation Options

```typescript
const css = generateThemeCSS(theme, {
  includeComments: true, // Add helpful comments
  minify: false, // Pretty-print CSS
  variablePrefix: "--", // CSS variable prefix
});
```

### Dynamic Theme Loading

Themes are automatically available in the theme toggle:

```typescript
// components/theme-toggle.tsx automatically reads from registry
import { getThemesByCategory } from "@/themes";

const customThemes = getThemesByCategory("custom");
// Renders all custom themes in dropdown
```

## Best Practices

### 1. Naming Conventions

- Use kebab-case for theme names (`ocean-blue`, not `OceanBlue`)
- Choose descriptive, memorable names
- Avoid overly generic names (`blue`, `green`)

### 2. Color Selection

- Start with a primary color you love
- Generate harmonious palettes (use tools like Coolors.co)
- Ensure sufficient contrast for accessibility
- Test with colorblind simulation tools

### 3. Organization

- Group related themes (e.g., `neon-blue`, `neon-purple`)
- Document inspiration/source in description
- Use consistent radius values within theme families

### 4. Testing

- Test all UI components with your theme
- Check both light and dark contexts
- Verify accessibility with screen readers
- Test on different devices/screens

## Migration from Old System

If updating from the old CSS-based system:

### Old Way (CSS Variables)

```css
.theme-ocean {
  --background: 210 100% 98%;
  --foreground: 210 100% 10%;
  /* ... */
}
```

### New Way (TypeScript Objects)

```typescript
export const oceanTheme: Theme = {
  name: "ocean",
  label: "Ocean Blue",
  colors: {
    background: "210 100% 98%",
    foreground: "210 100% 10%",
    // ...
  },
};
```

### Benefits of New System

- ✅ **Type Safety**: Catch errors at compile time
- ✅ **Better DX**: IntelliSense and autocomplete
- ✅ **Validation**: Built-in theme validation
- ✅ **Utilities**: CSS generation and management tools
- ✅ **Scalability**: Easy to add new themes and features

## Troubleshooting

### Theme Not Appearing

1. Check theme is registered in `themes/index.ts`
2. Verify CSS is added to `app/globals.css`
3. Confirm theme name in ThemeProvider themes array
4. Check browser dev tools for CSS variable application

### TypeScript Errors

1. Ensure all required `ThemeColors` properties are defined
2. Use correct HSL format: `"210 50% 30%"`
3. Run `npm run build` to check for type errors

### Color Issues

1. Verify HSL format (no `hsl()` wrapper)
2. Check contrast ratios meet accessibility standards
3. Test theme across all components

### Performance Issues

1. Limit number of custom themes
2. Minify generated CSS in production
3. Consider lazy loading for large theme collections

## Future Enhancements

The theme system is designed for extensibility:

- **Automatic CSS Generation**: Build-time script generation
- **Theme Builder UI**: Visual theme creation tool
- **Theme Marketplace**: Share themes between projects
- **Advanced Validation**: Contrast ratio checking, color harmony analysis
- **Theme Animations**: Smooth transitions between themes

For more examples and inspiration, see the existing themes in `themes/custom/`.

Happy theming! 🎨
