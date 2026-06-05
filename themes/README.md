# 🎨 Theme System

This project uses a TypeScript-based theme system that provides type safety, maintainability, and future-proofing for Tailwind CSS v4.

## 📁 Directory Structure

```
themes/
├── types.ts              # TypeScript interfaces and types
├── index.ts               # Theme registry and utility functions
├── base/                  # Core system themes
│   ├── light.ts          # Light theme
│   └── dark.ts           # Dark theme
└── custom/                # Custom themes
    ├── ocean.ts          # Ocean Blue theme
    ├── forest.ts         # Forest Green theme
    └── midnight.ts       # Midnight Purple theme
```

## 🚀 Quick Start

### Using Themes in Components

```typescript
import { getAllThemes, getTheme, getThemesByCategory } from "@/themes";

// Get all themes
const allThemes = getAllThemes();

// Get specific theme
const oceanTheme = getTheme("ocean");

// Get themes by category
const customThemes = getThemesByCategory("custom");
```

### Theme Toggle Integration

The theme toggle automatically reads from the theme registry:

```typescript
import { getThemesByCategory } from "@/themes";

const baseThemes = getThemesByCategory("base");
const customThemes = getThemesByCategory("custom");
```

## 🎯 Adding a New Theme

### Step 1: Create Theme File

Create a new file in `themes/custom/yourtheme.ts`:

```typescript
import { Theme } from "../types";

export const yourTheme: Theme = {
  name: "your-theme", // CSS class name
  label: "Your Theme", // Display name
  description: "Amazing colors", // Description
  category: "custom", // Category
  icon: "Star", // Lucide icon name
  emoji: "⭐", // Optional emoji
  radius: "0.5rem", // Border radius
  colors: {
    // All color variables in HSL format
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

Add your theme to `themes/index.ts`:

```typescript
// Import your theme
import { yourTheme } from "./custom/yourtheme";

// Add to registry
export const themes: ThemeRegistry = {
  // ... existing themes
  "your-theme": yourTheme,
};

// Export for direct import
export { yourTheme };
```

### Step 3: Generate CSS

Add the CSS to `app/globals.css`:

```typescript
import { generateThemeCSS } from "@/themes";

const css = generateThemeCSS(yourTheme);
// Copy the generated CSS to globals.css
```

### Step 4: Update ThemeProvider

Add your theme to the provider in `app/layout.tsx`:

```typescript
<ThemeProvider
  themes={["light", "dark", "system", "ocean", "forest", "midnight", "your-theme"]}
  // ... other props
>
```

## 🎨 Color Guidelines

### HSL Format

All colors use HSL format: `"hue saturation% lightness%"`

Examples:

- `"210 100% 50%"` = Bright blue
- `"120 50% 30%"` = Dark green
- `"0 80% 60%"` = Red

### Color Roles

| Color         | Purpose            | Example           |
| ------------- | ------------------ | ----------------- |
| `background`  | Main background    | Page background   |
| `foreground`  | Main text          | Body text         |
| `primary`     | Brand/main actions | Buttons, links    |
| `secondary`   | Supporting actions | Secondary buttons |
| `muted`       | Disabled/subtle    | Placeholders      |
| `accent`      | Highlights/focus   | Focus states      |
| `destructive` | Errors/danger      | Delete buttons    |
| `border`      | Borders            | Card borders      |
| `input`       | Form inputs        | Input backgrounds |
| `ring`        | Focus rings        | Focus outlines    |

## 🧪 Theme Validation

Validate themes for consistency:

```typescript
import { validateTheme, validateAllThemes } from "@/themes";

// Validate single theme
const result = validateTheme(yourTheme);
console.log(result.isValid, result.errors, result.warnings);

// Validate all themes
const allResults = validateAllThemes();
```

## 🔧 Utility Functions

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

### Theme Management

```typescript
import {
  getAllThemes,
  getTheme,
  getThemesByCategory,
  getThemeNames,
  getNextThemesConfig,
} from "@/themes";

// Get theme names for next-themes
const themeNames = getNextThemesConfig();

// Get all theme names
const names = getThemeNames();
```

## 🎭 Theme Preview Component

Use the built-in theme preview:

```typescript
import { ThemePreview } from "@/components/theme-preview";

// Shows all themes with interactive switcher
<ThemePreview />
```

## 🔮 Future Features

### Automatic CSS Generation

Run build-time script to generate CSS:

```bash
node scripts/generate-themes.js
```

### Theme Builder

Create themes visually:

```typescript
import { createCustomTheme } from "@/themes";

const newTheme = createCustomTheme({
  basePalette: ["#0066CC", "#00AA44"],
  options: { darkMode: true },
});
```

### Theme Marketplace

Share themes between projects:

```typescript
import { exportTheme, importTheme } from "@/themes";

const themeJSON = exportTheme(oceanTheme);
const importedTheme = importTheme(themeJSON);
```

## 📱 Best Practices

### 1. Consistent Naming

- Use kebab-case for theme names
- Choose descriptive, memorable names
- Group related themes with prefixes

### 2. Color Accessibility

- Ensure WCAG AA contrast (4.5:1 minimum)
- Test with color blindness simulators
- Provide sufficient visual hierarchy

### 3. Maintainability

- Document color choices in comments
- Use semantic color names
- Test themes across all components

### 4. Performance

- Keep theme objects lightweight
- Use CSS variables for runtime switching
- Minimize generated CSS size

## 🚀 Tailwind v4 Compatibility

This theme system is designed for Tailwind v4:

- ✅ **CSS Variables** - Native v4 support
- ✅ **Zero Runtime** - Build-time generation
- ✅ **Type Safety** - Enhanced TypeScript integration
- ✅ **Future Proof** - Ready for v4 features

## 🆘 Troubleshooting

### Theme Not Applying

1. Check theme is registered in `themes/index.ts`
2. Verify CSS is added to `globals.css`
3. Confirm theme name in ThemeProvider

### TypeScript Errors

1. Run `npm run build` to check types
2. Ensure all color properties are defined
3. Verify imports match exports

### Color Issues

1. Use HSL format: `"210 50% 30%"`
2. Check contrast ratios
3. Test in both light and dark contexts

## 📚 Examples

See existing themes in `themes/custom/` for reference implementations.

Happy theming! 🎨✨
