# AI Agent Instructions for CrunchyCone Vanilla Starter Project

## Setup (Run in Order) - Agent Guidelines

```bash
npm install                    # 1. Dependencies first
npm run setup-env             # 2. Environment (.env + AUTH_SECRET + hooks)
npm run db:reset --yes        # 3. Database
npm run dev:open              # 4. Start server
```

**Schema Changes**: `npx prisma migrate dev --name "description"` (never just `generate`)

**Agent Rule**: Always follow this exact setup order. Never skip steps or run commands out of sequence.

## Overview

Production-ready Next.js starter with Auth.js v4, admin dashboard, roles, TypeScript, Tailwind CSS, Prisma ORM, shadcn/ui.

**Agent Behavior**: Before making any changes, understand this is a complete starter project. Always edit existing files rather than creating new ones unless absolutely necessary.

## Key Structure

- `app/` - Next.js App Router (actions, admin, auth pages, API routes)
- `components/` - React components (ui, auth, admin, profile)
- `lib/` - Auth.js config, permissions, Prisma clients, utilities
- `themes/` - TypeScript theme system (light, dark, ocean, forest, midnight)
- `prisma/` - Schema, migrations, seeding

**Agent Rule**: Always check existing structure before creating new files. Follow established patterns in each directory.

## Database Models

**Core Models**: User, UserProfile, Role, UserRole (many-to-many)
**Patterns**: ULID IDs (auto-generated), soft deletes (`deleted_at`), timestamps
**Query**: Always filter `deleted_at: null` for active records

**Agent Rules**:
- **ALWAYS** use soft deletes: set `deleted_at: new Date()` instead of actual deletion
- **ALWAYS** filter `deleted_at: null` in queries for active records
- **ALWAYS** use ULID IDs for new records (auto-generated)
- **NEVER** create direct foreign key relationships - use junction tables for many-to-many

## Authentication (Auth.js v4)

**Providers**: Credentials (email/password), Email (magic links), Google OAuth, GitHub OAuth
**Sessions**: JWT with Prisma adapter
**Console Email**: Development magic links logged to console

**Key Functions**: `getCurrentUser()`, `hasRole()`, `isAdmin()`, `checkAdminExists()`

**Auth Flows**:
- Setup: Check admin exists → redirect to setup if none
- Sign-up: Register → auto sign-in
- Sign-in: Email/password or magic link
- Reset: JWT token (1hr) → new password

**Sessions**: JWT in HTTP-only cookies, `auth()` for server, `useSession()` for client

**Agent Rules**:
- **ALWAYS** check authentication in protected routes: `const session = await auth()`
- **ALWAYS** return 401 for unauthorized API requests
- **ALWAYS** use `hasRole()` for role-based access control
- **NEVER** expose sensitive user data in client components
- **Client**: Use `useSession()`, `signIn()`, `signOut()`
- **Server**: Use `const session = await auth()`

## Server Actions vs API Routes

**Server Actions**: Form submissions, DB mutations, admin ops, revalidation
**API Routes**: External integrations, OAuth callbacks, file uploads, webhooks

**Server Action Pattern**:
1. Auth check (`await auth()`)
2. Validate data
3. DB operation
4. `revalidatePath()`
5. Redirect/return

**Real-time Updates**: Use `revalidatePath()` after mutations for immediate UI updates

**Agent Rules**:
- **NEVER** mix Server Actions with fetch() calls
- **ALWAYS** use Server Actions for form submissions and DB mutations
- **ALWAYS** call `revalidatePath()` after data changes
- **ALWAYS** validate input data with Zod schemas
- **API Routes**: Only for external integrations, not internal data operations

## Dynamic Rendering - CRITICAL

**ALWAYS use `export const dynamic = "force-dynamic";` for:**

**Pages requiring dynamic rendering:**
- All admin pages (`/admin/*`)
- Pages with authentication checks
- Pages accessing environment variables/file system
- Pages making database queries at render time

**API routes requiring dynamic rendering:**
- Routes using CLI commands (`execSync`, `spawn`, `exec`)
- Routes with external API calls or file system access
- Routes with database operations or authentication
- CrunchyCone integration routes (`/api/admin/environment/*`, `/api/admin/crunchycone-*`)

**Agent Rules**:
- **CRITICAL**: Missing dynamic export causes build timeouts and Docker failures
- **ALWAYS** add `export const dynamic = "force-dynamic";` to pages/routes with:
  - CLI commands, file system operations, external APIs, auth checks, DB operations
- **NEVER** assume static generation will work for dynamic content

**Pattern**:
```typescript
import { NextResponse } from "next/server";

// Force dynamic rendering
export const dynamic = "force-dynamic";

export async function GET() { ... }
```

## Admin Dashboard

**Pages**: Dashboard, Users, Roles, Database Viewer, Media Manager, Settings
**Features**: Search, pagination, role management, password reset, media management, storage configuration
**Protection**: All routes/APIs require admin role, self-protection (can't remove own admin)
**API**: User/role management endpoints at `/api/admin/*`
**Settings**: Email configuration, storage provider configuration with help dialogs

**Agent Rules**:
- **ALWAYS** check admin role: `if (!await isAdmin()) return NextResponse.json({error: "Unauthorized"}, {status: 401})`
- **ALWAYS** implement self-protection: users cannot remove their own admin role
- **ALWAYS** use pagination for large datasets
- **ALWAYS** add `export const dynamic = "force-dynamic";` to admin pages/APIs

## Media Manager

**Features**: File upload, visibility controls, search, pagination, file details
**Storage**: Powered by crunchycone-lib storage providers (LocalStorage, AWS S3, DigitalOcean Spaces, Azure Blob, Google Cloud Storage, CrunchyCone)
**File Operations**: Upload, view, download, delete, visibility toggle (public/private)
**UI**: Dialog-based upload, dropdown menus for actions, file type icons, flash effects
**Pagination**: Server-side pagination with 20 files per page, only shown when needed
**Search**: Server-side text search across file names and paths
**API**: File management endpoints at `/api/admin/media/*` and `/api/storage/*`

**Agent Rules**:
- **ALWAYS** use crunchycone-lib for storage operations
- **ALWAYS** implement proper file validation and security checks
- **ALWAYS** use server-side pagination and search
- **NEVER** expose direct file system paths to client

## Components

**shadcn/ui**: Button, Card, Form, Input, Dialog, Table, Toast, Checkbox, etc.
**Custom**: SignInForm (tabs), SignUpForm, UserManagementPanel, RoleManagementPanel, MediaUploader

**Agent UI Component Rules**:
1. **ALWAYS check existing** `components/ui/` first - Never create custom UI when shadcn/ui exists
2. **Install from registry** when needed: `npx shadcn@latest add [component]`
3. **Combine existing components** before creating custom ones
4. **Follow shadcn patterns** - Use Tailwind, CVA variants, maintain accessibility
5. **NEVER use** Material-UI, Ant Design, or other UI libraries

## Pages

**Public**: Home, sign-in, sign-up, setup-admin
**User**: Profile
**Admin**: Dashboard, users, roles, database, media, settings

**Agent Rules**:
- **ALWAYS** implement proper route protection
- **ALWAYS** add loading states and error boundaries
- **ALWAYS** use established layout patterns

## Profile System

**Features**: User info display, OAuth linking/unlinking (with safety checks), auto profile sync
**OAuth**: Google + GitHub integration with account linking, profile enrichment, avatar sync

**Agent Rules**:
- **ALWAYS** implement safety checks before unlinking OAuth accounts
- **ALWAYS** sync profile data automatically when linking accounts
- **NEVER** allow users to unlink their only authentication method

## OAuth Providers

**Google**: Google Cloud Console + env vars (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`)
**GitHub**: GitHub OAuth App + env vars (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`)
**Features**: Auto UI, account linking, profile sync, role assignment, avatar sync
**Details**: Complete setup guide in `docs/auth-providers.md`

**Agent Rules**:
- **ALWAYS** check provider environment variables before enabling
- **ALWAYS** handle OAuth errors gracefully
- **ALWAYS** implement proper account linking logic

## Database Support

**Types**: SQLite (dev), Turso (libSQL), PostgreSQL, MySQL
**Config**: `DATABASE_URL` + `TURSO_AUTH_TOKEN` (for Turso)

**Turso Features**: Auto-migration system, tracking table, schema generation, seeding
**Production**: Docker-ready, auto-init, safe restarts

**Commands**: `npx prisma migrate dev`, `npm run db:reset`, `npm run db:seed`

**Best Practices**: Transactions, soft deletes, proper indexes
**Workflow**: Schema change → migrate (not generate) → auto client generation

**Agent Rules**:
- **NEVER** use `npx prisma generate` alone - always use `npx prisma migrate dev`
- **ALWAYS** use transactions for multi-table operations
- **ALWAYS** test migrations in development before production
- **ALWAYS** backup production data before major migrations

## Environment Variables

**Required**: `AUTH_SECRET`, `AUTH_URL`, `DATABASE_URL`, `EMAIL_FROM`, `NEXT_PUBLIC_APP_URL`
**Optional**: `TURSO_AUTH_TOKEN` (for Turso), OAuth provider vars, storage provider vars
**OAuth**: `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET`, provider toggles
**Storage**: `CRUNCHYCONE_STORAGE_PROVIDER`, provider-specific keys (AWS, Azure, GCP, DigitalOcean)
**Logging**: `NODE_ENV`, `LOG_LEVEL`, `PRISMA_LOG_LEVEL` for structured logging and query debugging
**Auto-generated**: `npm run setup-env` creates .env with AUTH_SECRET

**Agent Rules**:
- **NEVER** commit environment variables to version control
- **ALWAYS** validate required environment variables at startup
- **ALWAYS** use .env.example as template for new variables
- **NEVER** log sensitive environment variables

## Development

**Workflow**: Schema → migrate → server actions → components → pages
**Security**: Role checks, self-protection, bcrypt, HTTP-only cookies, JWT expiry
**Logging**: Set `NODE_ENV=production` and `LOG_LEVEL=debug` for structured JSON logs with PII sanitization
**Linting**: `npm run lint` - zero errors/warnings maintained with automatic fixes
**Pre-commit**: Git hooks automatically run `npm run lint` and `npm run build` before commits to ensure code quality - install with `npm run hooks:install`

**Agent Rules**:
- **ALWAYS** run `npm run lint` before committing
- **ALWAYS** fix all TypeScript errors before proceeding
- **ALWAYS** test changes locally before pushing
- **Pre-commit hooks automatically enforce code quality**

## Email System

**Current**: Console provider (dev-friendly)
**Templates**: Verification, password reset, magic link, auto-preview on selection
**Production**: SendGrid, Resend, AWS SES, SMTP (see `docs/email-providers.md`)
**Pattern**: Swappable provider interface
**Integration**: Full crunchycone-lib email service integration with availability checking

**Agent Rules**:
- **ALWAYS** use crunchycone-lib email service
- **ALWAYS** test email templates in development
- **NEVER** hardcode email content - use template system

## CrunchyCone-lib Integration

**Storage**: Complete file management with LocalStorage, AWS S3, Azure Blob, Google Cloud Storage, DigitalOcean Spaces, CrunchyCone support
**Email**: Multi-provider email service (Console, SMTP, SendGrid, Resend, AWS SES, CrunchyCone)
**Features**: Provider availability checking, authentication status, dynamic configuration, connection testing
**APIs**: Server-side integration with proper error handling and logging
**Configuration**: Admin settings UI with provider-specific help dialogs and setup instructions

**Agent Rules**:
- **ALWAYS** use crunchycone-lib for storage and email operations
- **ALWAYS** implement proper error handling for external services
- **ALWAYS** check provider availability before using

## Theme System

**Themes**: Light, Dark, Ocean, Forest, Midnight, System
**Features**: TypeScript-based, dynamic toggle, persistent preferences, Tailwind v4 ready
**Structure**: `themes/base/` (light, dark), `themes/custom/` (ocean, forest, midnight)
**Utilities**: `getAllThemes()`, `getTheme()`, `validateTheme()`, `generateThemeCSS()`

**Agent Rules**:
- **ALWAYS** use TypeScript theme system instead of hardcoded values
- **ALWAYS** support both light and dark variants
- **NEVER** modify theme files directly - use theme utilities

## Recent Updates

- **Production Logging**: Structured JSON logging with PII sanitization, configurable via `LOG_LEVEL` and `NODE_ENV`
- **Email Templates**: Auto-preview functionality - templates automatically render when switching selections
- **TypeScript**: Zero linting errors/warnings - full type safety with proper union types and null checks
- **Docker**: Node.js 24, optimized database file copying, Prisma migration status checks, cache management
- **Storage Configuration**: Added Google Cloud Storage support, comprehensive admin settings UI with help dialogs
- **MJML Warnings**: Configured webpack to suppress crunchycone-lib MJML dependency warnings
- **Media Manager**: Complete file management with crunchycone-lib integration, pagination, search
- **CrunchyCone-lib**: Full email and storage provider integration with availability checking
- **Auth.js v4**: Complete migration from custom JWT, Prisma adapter, console email provider
- **Prisma**: Client Extensions API, modernized config, ULID auto-generation, structured query logging
- **Themes**: TypeScript system with 5 themes, type-safe registry
- **Git**: Local database exclusions
- **Pre-commit Hooks**: Automatic lint and build checks before commits

## Storage Configuration

**Providers**: LocalStorage, AWS S3, DigitalOcean Spaces, Azure Blob Storage, Google Cloud Storage, CrunchyCone
**Features**: Connection testing, provider-specific help dialogs, environment variable management
**CrunchyCone**: CLI authentication checking, project configuration validation
**UI**: Admin settings interface with clickable setup links and comprehensive instructions
**API**: `/app/actions/storage-settings.ts` for configuration management

**Environment Variables by Provider**:
- **LocalStorage**: `CRUNCHYCONE_LOCALSTORAGE_PATH`, `CRUNCHYCONE_LOCALSTORAGE_BASE_URL`
- **AWS S3**: `CRUNCHYCONE_AWS_ACCESS_KEY_ID`, `CRUNCHYCONE_AWS_SECRET_ACCESS_KEY`, `CRUNCHYCONE_AWS_REGION`, `CRUNCHYCONE_AWS_BUCKET`, `CRUNCHYCONE_AWS_CLOUDFRONT_DOMAIN`
- **DigitalOcean**: `CRUNCHYCONE_DO_ACCESS_KEY_ID`, `CRUNCHYCONE_DO_SECRET_ACCESS_KEY`, `CRUNCHYCONE_DO_REGION`, `CRUNCHYCONE_DO_BUCKET`, `CRUNCHYCONE_DO_CDN_ENDPOINT`
- **Azure**: `CRUNCHYCONE_AZURE_ACCOUNT_NAME`, `CRUNCHYCONE_AZURE_ACCOUNT_KEY`, `CRUNCHYCONE_AZURE_CONTAINER_NAME`, `CRUNCHYCONE_AZURE_SAS_TOKEN`, `CRUNCHYCONE_AZURE_CONNECTION_STRING`, `CRUNCHYCONE_AZURE_CDN_URL`
- **Google Cloud**: `CRUNCHYCONE_GCP_PROJECT_ID`, `CRUNCHYCONE_GCP_KEY_FILE`, `CRUNCHYCONE_GCS_BUCKET`, `CRUNCHYCONE_GCP_CDN_URL`
- **CrunchyCone**: Uses CLI auth + `crunchycone.toml` project config

**Agent Rules**:
- **ALWAYS** validate storage provider configuration before using
- **ALWAYS** implement proper error handling for storage operations
- **NEVER** expose storage credentials to client-side code

## Troubleshooting

**Common Issues**: No admin loop (`npm run db:seed`), DB locked (restart), type errors (`npx prisma generate`)
**Debug**: `rm -f db/prod.db && npm run db:reset`, `npm run build`
**Cache Issues**: `rm -rf .next` to clear Next.js/Turbopack cache when encountering build errors
**Linting**: `npm run lint --fix` to automatically fix formatting and style issues
**MJML Warnings**: Automatically suppressed via webpack configuration in `next.config.ts`

**Agent Rules**:
- **ALWAYS** clear Next.js cache when encountering build errors
- **ALWAYS** run database reset when encountering migration issues
- **ALWAYS** check environment variables when services fail
- **NEVER** ignore TypeScript errors - fix them immediately

## Docker Deployment

**Features**: Node.js 24, optimized multi-stage builds, automatic database file copying
**Auto-Detection**: Cloudflare, Render, Fly.io, GCP based on env vars
**Database Setup**: Auto-detects SQLite/Turso/PostgreSQL/MySQL, runs migrations with status checks
**Migration Optimization**: Skips unnecessary migrations, early exit for up-to-date databases
**Zero Config**: Platform-specific ports, migration modes, error handling, cache management

**Agent Rules**:
- **CRITICAL**: Always add `export const dynamic = "force-dynamic";` to prevent build timeouts
- **ALWAYS** test Docker builds locally before deployment
- **NEVER** use localhost database URLs in Docker containers
- **ALWAYS** implement proper health checks

## Documentation

See `docs/` folder: email providers, auth providers, theme customization

**Agent Rules**:
- **ALWAYS** update documentation when adding new features
- **NEVER** create documentation files unless explicitly requested
- **ALWAYS** reference existing documentation patterns

## Cursor AI Rules

**Location**: `.cursor/rules/` folder
**Files**: project, database, auth, admin, prisma, server-actions, themes, setup
**Benefits**: Consistent patterns, context-aware assistance, anti-pattern prevention

**Agent Rules**:
- **ALWAYS** consult relevant `.cursor/rules/` files before making changes
- **ALWAYS** follow established patterns from rule files
- **NEVER** create new patterns when existing ones exist

## Contributing

Follow patterns, add types, handle errors, update docs, test thoroughly, maintain security

**Agent Rules**:
- **ALWAYS** follow existing code patterns and conventions
- **ALWAYS** add proper TypeScript types
- **ALWAYS** implement error handling
- **ALWAYS** test changes thoroughly
- **ALWAYS** maintain security best practices
- **Pre-commit hooks automatically enforce code quality**

## Agent-Specific Anti-Patterns to Avoid

**Critical Mistakes**:
- Creating new files when editing existing ones would suffice
- Using `prisma generate` instead of `prisma migrate dev`
- Mixing Server Actions with fetch() calls
- Creating custom UI components when shadcn/ui exists
- Bypassing authentication checks in protected routes
- Not using soft delete patterns for data removal
- **CRITICAL**: Missing `export const dynamic = "force-dynamic"` on pages/routes with CLI commands, file system operations, external APIs, or auth checks
- **DOCKER**: Ignoring build timeouts or hangs - always indicates missing dynamic exports
- **DOCKER**: Using localhost database URLs in containerized builds
- **DOCKER**: Not testing builds locally before Docker deployment
- Not running `npm run lint` before committing (now automated with pre-commit hooks)
- Committing TypeScript errors or linting issues
- Exposing sensitive data in client-side code
- Creating documentation files without explicit request

## Agent Quality Assurance Checklist

- [ ] Relevant `.cursor/rules/` files consulted
- [ ] Existing patterns followed (check similar implementations)
- [ ] Authentication properly implemented (`await auth()` in protected routes)
- [ ] Type safety maintained (no TypeScript errors)
- [ ] Error handling included (try/catch, proper error responses)
- [ ] Security best practices followed (no exposed secrets/credentials)
- [ ] Soft delete patterns used for data removal
- [ ] `export const dynamic = "force-dynamic";` added where needed
- [ ] Server Actions used for forms/DB operations, API Routes for external integrations
- [ ] shadcn/ui components used instead of custom UI
- [ ] Database queries filter `deleted_at: null` for active records
- [ ] `revalidatePath()` called after data mutations
- [ ] Pre-commit hooks will automatically verify lint and build pass

## Rule Integration Framework

All agents should follow patterns defined in `.cursor/rules/` before making any code changes or architectural decisions.

### Core Rule Files

📋 **Base Rules**: `.cursor/rules/project.md` - Core project patterns, conventions, anti-patterns
📋 **Setup Rules**: `.cursor/rules/setup.md` - Environment setup, installation, initialization flows
📋 **Git Hooks**: Automatic pre-commit hooks run `npm run lint` and `npm run build` before commits

### Domain-Specific Rules

#### Authentication & Security
📋 **Auth Rules**: `.cursor/rules/auth.md` - Auth flows, session handling, security patterns

#### Database Operations
📋 **Database Rules**: `.cursor/rules/database.md` - Query patterns, migrations, best practices
📋 **Prisma Rules**: `.cursor/rules/prisma.md` - Schema changes, client usage, migration patterns

#### Application Architecture
📋 **Server Actions**: `.cursor/rules/server-actions.md` - Action patterns, validation, revalidation
📋 **Admin Rules**: `.cursor/rules/admin.md` - Dashboard patterns, permissions, role management
📋 **Dynamic Rendering Rules**: `.cursor/rules/10-CRITICAL-dynamic-rendering.mdc` - Build optimization, performance
📋 **Docker Build Troubleshooting**: `.cursor/rules/11-TROUBLESHOOT-docker-builds.mdc` - Production deployment issues

#### UI & Theming
📋 **Theme Rules**: `.cursor/rules/themes.md` - Theme system, customization, TypeScript patterns

## Agent Integration with CLAUDE.md

This document provides comprehensive agent guidance while CLAUDE.md serves as the project reference:

- **AGENTS.md**: Complete agent behavior guide with all project information and rules
- **CLAUDE.md**: High-level project overview and quick reference
- **`.cursor/rules/`**: Specific implementation patterns and anti-patterns

For implementation details, always reference the specific rule files in `.cursor/rules/` and follow the patterns established in this document.