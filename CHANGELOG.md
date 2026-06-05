# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Updated jose from v5 to v6 for Edge Runtime authentication
- Improved import specificity in edge-auth.ts for better tree-shaking
- Updated zod from v3 to v4 with new error customization syntax
  - Changed `message` parameter to `error` in all schemas
  - Updated validation in SignUpForm, SignInForm, SetupAdminForm, ForgotPasswordPage, and RoleManagementPanel

### Removed

- Removed @types/bcryptjs dependency as bcryptjs v3 now includes its own TypeScript definitions

### Updated

- Updated Prisma and @prisma/client from v6.11.0 to v6.13.0
- Updated @hookform/resolvers from v5.1.1 to v5.2.1
- Updated react-hook-form from v7.59.0 to v7.61.1
- Updated @typescript-eslint/eslint-plugin and @typescript-eslint/parser from v8.35.1 to v8.38.0
- Updated eslint from v9.30.0 to v9.32.0

## [0.1.0] - 2025-07-01

### Added

- Initial release of CrunchyCone Vanilla Starter Project
- Complete authentication system with email/password and magic links
- JWT-based session management with HTTP-only cookies
- Role-based access control (RBAC) with user and admin roles
- Admin dashboard with user and role management
- First-time admin setup flow
- Email service with provider pattern
- Full dark mode support using next-themes
- Comprehensive documentation in docs/ folder
- Cursor IDE integration files
- SQLite database with Prisma ORM
- Soft delete pattern for all models
- shadcn/ui component library integration
- TypeScript for type safety
- Server Components and Server Actions
- Responsive design for all screen sizes

### Security

- Password hashing with bcrypt
- Secure JWT token generation and validation
- HTTP-only cookies for session storage
- CSRF protection with SameSite cookies
- Input validation with Zod
- Protected admin routes and APIs
- Prevention of self-demotion for admin users

### Documentation

- Comprehensive README with quick start guide
- Technical documentation in CLAUDE.md
- Email provider implementation guide
- Authentication provider implementation guide
- Theme customization guide
- Cursor IDE MDC files for better AI assistance
