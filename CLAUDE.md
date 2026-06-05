# CrunchyCone Vanilla Starter Project

## Setup (Run in Order)

```bash
npm install                    # 1. Dependencies first
npm run setup-env             # 2. Environment (.env + AUTH_SECRET + hooks)
npm run db:reset --yes        # 3. Database
npm run dev:open              # 4. Start server
```

**Schema Changes**: `npx prisma migrate dev --name "description"` (never just `generate`)

## Overview

Production-ready Next.js starter with Auth.js v4, admin dashboard, roles, TypeScript, Tailwind CSS, Prisma ORM, shadcn/ui.

## Key Structure

- `app/` - Next.js App Router (actions, admin, auth pages, API routes)
- `components/` - React components (ui, auth, admin, profile)
- `lib/` - Auth.js config, permissions, Prisma clients, utilities
- `themes/` - TypeScript theme system (light, dark, ocean, forest, midnight)
- `prisma/` - Schema, migrations, seeding

## Database Models

**Core Models**: User, UserProfile, Role, UserRole (many-to-many)
**Patterns**: ULID IDs (auto-generated), soft deletes (`deleted_at`), timestamps
**Query**: Always filter `deleted_at: null` for active records

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

**Usage**:

- Client: `useSession()`, `signIn()`, `signOut()`
- Server: `const session = await auth()`
- API: Check session, return 401 if unauthorized

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

**Don't Mix**: Use Server Actions directly in forms, not fetch() calls

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

**Why critical:**
- Prevents build timeouts from external processes
- Avoids memory issues during static generation
- Prevents authentication errors during build
- Essential for Docker/container deployments

**Pattern:**
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

## Media Manager

**Features**: File upload, visibility controls, search, pagination, file details
**Storage**: Powered by crunchycone-lib storage providers (LocalStorage, AWS S3, DigitalOcean Spaces, Azure Blob, Google Cloud Storage, CrunchyCone)
**File Operations**: Upload, view, download, delete, visibility toggle (public/private)
**UI**: Dialog-based upload, dropdown menus for actions, file type icons, flash effects
**Pagination**: Server-side pagination with 20 files per page, only shown when needed
**Search**: Server-side text search across file names and paths
**API**: File management endpoints at `/api/admin/media/*` and `/api/storage/*`

## Components

**shadcn/ui**: Button, Card, Form, Input, Dialog, Table, Toast, Checkbox, etc.
**Custom**: SignInForm (tabs), SignUpForm, UserManagementPanel, RoleManagementPanel, MediaUploader

**UI Component Rules**:

1. **Always check existing** `components/ui/` first - Never create custom UI when shadcn/ui exists
2. **Install from registry** when needed: `npx shadcn@latest add [component]`
3. **Combine existing components** before creating custom ones
4. **Follow shadcn patterns** - Use Tailwind, CVA variants, maintain accessibility
5. **Never use** Material-UI, Ant Design, or other UI libraries

## Pages

**Public**: Home, sign-in, sign-up, setup-admin
**User**: Profile
**Admin**: Dashboard, users, roles, database, media, settings

## Profile System

**Features**: User info display, OAuth linking/unlinking (with safety checks), auto profile sync
**OAuth**: Google + GitHub integration with account linking, profile enrichment, avatar sync

## OAuth Providers

**Google**: Google Cloud Console + env vars (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`)
**GitHub**: GitHub OAuth App + env vars (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`)
**Features**: Auto UI, account linking, profile sync, role assignment, avatar sync
**Details**: Complete setup guide in `docs/auth-providers.md`

## Database Support

**Types**: SQLite (dev), Turso (libSQL), PostgreSQL, MySQL
**Config**: `DATABASE_URL` + `TURSO_AUTH_TOKEN` (for Turso)

**Turso Features**: Auto-migration system, tracking table, schema generation, seeding
**Production**: Docker-ready, auto-init, safe restarts

**Commands**: `npx prisma migrate dev`, `npm run db:reset`, `npm run db:seed`

**Best Practices**: Transactions, soft deletes, proper indexes
**Workflow**: Schema change → migrate (not generate) → auto client generation

## Environment Variables

**Required**: `AUTH_SECRET`, `AUTH_URL`, `DATABASE_URL`, `EMAIL_FROM`, `NEXT_PUBLIC_APP_URL`
**Optional**: `TURSO_AUTH_TOKEN` (for Turso), OAuth provider vars, storage provider vars
**OAuth**: `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET`, provider toggles
**Storage**: `CRUNCHYCONE_STORAGE_PROVIDER`, provider-specific keys (AWS, Azure, GCP, DigitalOcean)
**Logging**: `NODE_ENV`, `LOG_LEVEL`, `PRISMA_LOG_LEVEL` for structured logging and query debugging
**Auto-generated**: `npm run setup-env` creates .env with AUTH_SECRET

## Development

**Workflow**: Schema → migrate → server actions → components → pages
**Security**: Role checks, self-protection, bcrypt, HTTP-only cookies, JWT expiry
**Logging**: Set `NODE_ENV=production` and `LOG_LEVEL=debug` for structured JSON logs with PII sanitization
**Linting**: `npm run lint` - zero errors/warnings maintained with automatic fixes
**Pre-commit**: Git hooks automatically run `npm run lint` and `npm run build` before commits to ensure code quality - install with `npm run hooks:install`

## Email System

**Current**: Console provider (dev-friendly)
**Templates**: Verification, password reset, magic link, auto-preview on selection
**Production**: SendGrid, Resend, AWS SES, SMTP (see `docs/email-providers.md`)
**Pattern**: Swappable provider interface
**Integration**: Full crunchycone-lib email service integration with availability checking

## CrunchyCone-lib Integration

**Storage**: Complete file management with LocalStorage, AWS S3, Azure Blob, Google Cloud Storage, DigitalOcean Spaces, CrunchyCone support
**Email**: Multi-provider email service (Console, SMTP, SendGrid, Resend, AWS SES, CrunchyCone)
**Features**: Provider availability checking, authentication status, dynamic configuration, connection testing
**APIs**: Server-side integration with proper error handling and logging
**Configuration**: Admin settings UI with provider-specific help dialogs and setup instructions

## Theme System

**Themes**: Light, Dark, Ocean, Forest, Midnight, System
**Features**: TypeScript-based, dynamic toggle, persistent preferences, Tailwind v4 ready
**Structure**: `themes/base/` (light, dark), `themes/custom/` (ocean, forest, midnight)
**Utilities**: `getAllThemes()`, `getTheme()`, `validateTheme()`, `generateThemeCSS()`

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

## Troubleshooting

**Common Issues**: No admin loop (`npm run db:seed`), DB locked (restart), type errors (`npx prisma generate`)
**Debug**: `rm -f db/prod.db && npm run db:reset`, `npm run build`
**Cache Issues**: `rm -rf .next` to clear Next.js/Turbopack cache when encountering build errors
**Linting**: `npm run lint --fix` to automatically fix formatting and style issues
**MJML Warnings**: Automatically suppressed via webpack configuration in `next.config.ts`

## Docker Deployment

**Features**: Node.js 24, optimized multi-stage builds, automatic database file copying
**Auto-Detection**: Cloudflare, Render, Fly.io, GCP based on env vars
**Database Setup**: Auto-detects SQLite/Turso/PostgreSQL/MySQL, runs migrations with status checks
**Migration Optimization**: Skips unnecessary migrations, early exit for up-to-date databases
**Zero Config**: Platform-specific ports, migration modes, error handling, cache management

## Documentation

See `docs/` folder: email providers, auth providers, theme customization

## Cursor AI Rules

**Location**: `.cursor/rules/` folder
**Files**: project, database, auth, admin, prisma, server-actions, themes, setup
**Benefits**: Consistent patterns, context-aware assistance, anti-pattern prevention

## Contributing

Follow patterns, add types, handle errors, update docs, test thoroughly, maintain security

# important-instruction-reminders

Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (\*.md) or README files. Only create documentation files if explicitly requested by the User.

## shadcn/ui Quick Rules

- **Check existing first** - `components/ui/` before creating custom
- **Install when missing** - `npx shadcn@latest add [component]`
- **Combine before custom** - Build with existing primitives
- **Follow patterns** - Tailwind, variants, accessibility
