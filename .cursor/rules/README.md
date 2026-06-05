# Cursor AI Rules

This directory contains Cursor AI rules that help maintain code consistency and provide implementation guidance for the production starter template project.

## Rules Overview

### 1. **project.mdc** - Overall Project Architecture

- **Purpose**: Provides high-level overview of the entire project structure and conventions
- **Key Concepts**: Architecture patterns, technology stack, common operations
- **When to Use**: Understanding project structure, extension points, production considerations
- **Always Applied**: This rule is always active to provide context

### 2. **prisma.mdc** - Prisma Schema Change Handling

- **Purpose**: Guides developers through the correct workflow when modifying database schemas
- **Key Concepts**: Migration-first approach, ULID implementation, soft deletes
- **When to Use**: Any time you modify `prisma/schema.prisma`

### 3. **database.mdc** - Database Design and Query Patterns

- **Purpose**: Defines database patterns, relationships, and security considerations
- **Key Concepts**: ULID IDs, soft deletes, transaction patterns, relationship queries
- **When to Use**: Writing database queries, designing models, understanding data flow

### 4. **server-actions.mdc** - Server Actions Best Practices

- **Purpose**: Establishes Server Actions as the primary pattern for data mutations
- **Key Concepts**: Authentication patterns, revalidation strategies, error handling
- **When to Use**: Creating forms, handling user input, database operations

### 5. **auth.mdc** - Authentication Implementation Guidelines

- **Purpose**: Comprehensive guide to authentication flows and patterns
- **Key Concepts**: JWT sessions, role-based access, Server Action auth patterns
- **When to Use**: Implementing auth features, protecting routes, handling permissions

### 6. **admin.mdc** - Admin Dashboard Guidelines

- **Purpose**: Defines patterns for admin functionality and access control
- **Key Concepts**: Role management, user administration, database viewer
- **When to Use**: Building admin features or modifying admin routes

### 7. **themes.mdc** - Theme System Implementation

- **Purpose**: Explains how to work with the theme system
- **Key Concepts**: Adding themes, CSS variables, dark mode support
- **When to Use**: Customizing appearance or adding new themes

### 8. **setup.mdc** - Project Setup Automation

- **Purpose**: Automates initial project configuration
- **Key Concepts**: Dependency installation, environment setup, database initialization
- **When to Use**: Automatically applied when setting up a new project
- **Always Applied**: This rule is always active during initial setup

### 9. **build-workflow.mdc** - Build Verification and Commit Rules

- **Purpose**: Enforces build verification before commits to prevent broken code
- **Key Concepts**: Pre-commit builds, TypeScript error fixing, dependency management
- **When to Use**: Before every commit, when fixing build errors
- **Always Applied**: This rule is always active to ensure code quality

## How Rules Work

Cursor AI uses these rules to:

1. **Provide Context**: Understand project-specific patterns and conventions
2. **Guide Implementation**: Suggest the correct approach for common tasks
3. **Maintain Consistency**: Ensure new code follows established patterns
4. **Prevent Errors**: Warn about common pitfalls and anti-patterns

## Key Project Patterns

### Database IDs

- All models use ULID (Universally Unique Lexicographically Sortable Identifier)
- Format: 26-character strings like `01JZK5AT1CBD1SBW5T3JQ60VPR`
- Generated automatically by Prisma middleware
- Sortable by creation time

### Authentication

- JWT-based sessions stored in HTTP-only cookies
- Role-based access control (RBAC)
- Magic link and password authentication
- Protected routes check permissions server-side

### Data Mutations

- Server Actions are the primary pattern (not API routes)
- Always include `revalidatePath()` after mutations
- Use transactions for multi-table operations
- Handle errors with user-friendly messages

### UI Components

- Built with shadcn/ui and Tailwind CSS
- Dark mode support via next-themes
- Form components use Server Actions directly
- Admin components include real-time updates

## Adding New Rules

To add a new rule:

1. Create a `.mdc` file in this directory
2. Add frontmatter with `description` and `globs`
3. Write comprehensive guidelines
4. Update this README with the new rule

Example structure:

```markdown
---
description: Brief description of what this rule covers
globs: ["files/to/match/**/*"]
---

# Rule Title

## Overview

Explain the purpose and when to use this rule

## Key Concepts

List important concepts developers should understand

## Examples

Provide code examples and patterns
```

## Best Practices

1. **Read Rules First**: Before implementing features, check relevant rules
2. **Follow Patterns**: Use established patterns for consistency
3. **Update Rules**: Keep rules current with implementation changes
4. **Ask Questions**: If unsure, the rules provide guidance

## Related Documentation

- Main project documentation: `/CLAUDE.md`
- API documentation: `/docs/` folder
- Component examples: Throughout the codebase
