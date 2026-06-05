# shadcn/ui Component Preference Rules

## Component Selection Hierarchy

When a user requests UI functionality, follow this strict hierarchy:

### 1. Check Existing shadcn/ui Components (FIRST PRIORITY)

Before implementing ANY UI component, check if it already exists in `components/ui/`:

- Button, Card, Dialog, Form, Input, Label, Select, Table, Toast, Alert, Badge, Avatar
- Tabs, DropdownMenu, Separator, PasswordInput (custom extension)
- Always prefer these over custom implementations

### 2. Check shadcn/ui Registry (SECOND PRIORITY)

If not installed locally, check if available at https://ui.shadcn.com/docs/components/:

- Common components to check: Sheet, Drawer, Command, Popover, Tooltip, Switch
- Data display: DataTable, Calendar, DatePicker, Charts
- Navigation: NavigationMenu, Breadcrumb, Pagination
- Feedback: Progress, Skeleton, Spinner
- If available, install using: `npx shadcn@latest add [component-name]`

### 3. Combine/Extend shadcn/ui Components (THIRD PRIORITY)

Before writing custom components, try combining existing shadcn/ui components:

- Example: Modal with form = Dialog + Form components
- Example: User card = Card + Avatar + Badge components
- Example: Data grid = Table + Pagination + Input (for search)

### 4. Custom Components (LAST RESORT)

Only create custom components when:

- No shadcn/ui component exists for the use case
- The requirement is highly specific to the application
- Always follow shadcn/ui patterns (Tailwind, Radix UI primitives, CVA)

## Pattern Matching

### When user asks for common UI patterns, map to shadcn/ui:

| User Request                    | Use shadcn/ui Component                      |
| ------------------------------- | -------------------------------------------- |
| "modal", "popup"                | Dialog                                       |
| "dropdown", "menu"              | DropdownMenu or Select                       |
| "notification", "alert message" | Toast or Alert                               |
| "loading", "spinner"            | Skeleton or custom with lucide-react Loader2 |
| "sidebar", "drawer"             | Sheet (install if needed)                    |
| "tooltip", "hint"               | Tooltip (install if needed)                  |
| "toggle", "switch"              | Switch (install if needed)                   |
| "tabs", "tab panel"             | Tabs                                         |
| "data grid", "table"            | Table with Pagination                        |
| "date picker"                   | Calendar/DatePicker (install if needed)      |
| "autocomplete", "search"        | Command (install if needed)                  |
| "progress bar"                  | Progress (install if needed)                 |
| "breadcrumbs"                   | Breadcrumb (install if needed)               |
| "collapsible", "accordion"      | Accordion (install if needed)                |
| "slider", "range"               | Slider (install if needed)                   |

## Implementation Rules

### When installing new shadcn/ui components:

1. Always check dependencies first
2. Run: `npx shadcn@latest add [component-name]`
3. Import from `@/components/ui/[component]`
4. Follow the component's documentation for props and variants

### When extending shadcn/ui components:

1. Create new component in same style
2. Use CVA for variants
3. Use Tailwind classes (no separate CSS files)
4. Maintain accessibility features
5. Example: PasswordInput extends Input with visibility toggle

### Component styling priority:

1. Use component's built-in variants (size, variant props)
2. Use className prop with Tailwind utilities
3. Never use inline styles or separate CSS

## Anti-patterns to AVOID

❌ DON'T install Material-UI, Ant Design, or other UI libraries
❌ DON'T write custom modals/dialogs without checking Dialog component
❌ DON'T create custom form components without using Form primitives
❌ DON'T use vanilla HTML inputs without Input component styling
❌ DON'T implement custom toast/notification systems
❌ DON'T write CSS modules or styled-components

## Quick Reference Commands

```bash
# Check what's installed
ls components/ui/

# Install new component
npx shadcn@latest add [component-name]

# Install multiple components
npx shadcn@latest add dialog sheet tooltip

# Update components
npx shadcn@latest update
```

## Response Template

When user requests UI functionality, respond with:

1. "I'll use the existing [shadcn/ui component] for this"
2. "Let me install the [component] from shadcn/ui which is perfect for this"
3. "I'll combine [component1] and [component2] from shadcn/ui to create this"
4. Only if no option exists: "There's no shadcn/ui component for this specific need, so I'll create a custom component following shadcn/ui patterns"

## Current Project Components

### Already Installed:

- **Alert** - Information and error messages
- **Avatar** - User profile images with fallback
- **Badge** - Status indicators and labels
- **Button** - All button interactions
- **Card** - Container components with header/content structure
- **Dialog** - Modal dialogs and popups
- **DropdownMenu** - Context menus and action menus
- **Form** - Complete form system with validation
- **Input** - Text inputs and form fields
- **Label** - Form labels
- **PasswordInput** - Custom extension with visibility toggle
- **Select** - Dropdown selection
- **Separator** - Visual dividers
- **Table** - Data tables with sorting
- **Tabs** - Tab navigation
- **Toast** - Notification system
- **Toaster** - Toast container

### Usage Examples in Project:

- SignInForm uses Tabs for email/magic link switching
- Admin panels use Table for data display
- UserManagementPanel uses DropdownMenu for actions
- All forms use Form + Input + Button combination
- Notifications use Toast via useToast hook
