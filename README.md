# CrunchyCone Vanilla Starter Project

A production-ready Next.js starter template with authentication, admin dashboard, and role-based access control.

## Features

- 🔐 **Complete Authentication System**
  - Email/password authentication with secure bcrypt hashing
  - Magic link passwordless authentication
  - **OAuth providers**: Google OAuth and GitHub OAuth (fully integrated)
  - **Account linking**: Connect multiple OAuth accounts to one profile
  - **Profile sync**: Automatic name and avatar synchronization
  - Auth.js v4 with Prisma adapter for production-grade authentication
  - JWT-based sessions with HTTP-only cookies
  - Password reset with email verification
  - Email verification flow
  - Secure token management with expiration
  - Session management and logout

- 👥 **User Management & RBAC**
  - User profiles with soft delete pattern
  - Role-based access control (RBAC)
  - Default roles: user and admin (system protected)
  - Custom role creation and management
  - **Comprehensive admin dashboard** with user, role, media, and settings management
  - First-time admin setup flow
  - User search and pagination
  - Role assignment/removal with protections

- 🎨 **Modern UI/UX & TypeScript Theme System**
  - Built with shadcn/ui components
  - Tailwind CSS for responsive styling
  - **TypeScript-based theme system** with organized theme definitions
  - **Multiple themes**: Light, Dark, Ocean (🌊), Forest (🌲), Midnight (🌙)
  - **System theme detection** with persistent preferences
  - **Type-safe theme management** with validation utilities
  - **Tailwind v4 ready** architecture for future compatibility
  - Responsive design for all screen sizes
  - Loading states, error handling, and success feedback
  - Accessible design with proper contrast ratios

- 📧 **Email System**
  - **CrunchyCone-lib integration** with multiple provider support
  - Console email provider for development
  - **Auto-preview email templates** with real-time template switching
  - Ready-to-use templates for verification, reset, and magic links
  - Support for SendGrid, Resend, AWS SES, SMTP, Mailgun, CrunchyCone
  - **Admin configuration UI** with provider availability checking
  - HTML and text email formats with MJML support

- 📁 **File Management & Storage**
  - **Media Manager** with complete file management interface
  - **Multiple storage providers**: LocalStorage, AWS S3, DigitalOcean Spaces, Azure Blob, Google Cloud Storage, CrunchyCone
  - **File operations**: Upload, view, download, delete, visibility controls (public/private)
  - **Advanced features**: Server-side pagination, search, file details dialog
  - **Admin storage configuration** with connection testing and setup help
  - **CrunchyCone-lib powered** with seamless provider switching

- 🛠️ **Developer Experience**
  - **TypeScript with zero linting errors** - complete type safety and code quality
  - **Structured JSON logging** with PII sanitization for production debugging
  - **Prisma ORM with modern Client Extensions API** (SQLite, production database ready)
  - **Automatic ULID generation** for all database records
  - Server Components and Server Actions
  - Comprehensive documentation and guides
  - Cursor IDE integration with smart rules
  - Database migrations and seeding
  - Project reset functionality
  - Cross-platform development support

- 🔧 **Production Ready**
  - Environment-based configuration with structured logging
  - Security best practices built-in
  - Comprehensive error handling with PII sanitization
  - API rate limiting considerations
  - Deployment-ready structure with optimized Docker builds
  - Database migration system with status checks
  - Production logging and monitoring hooks

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Database**: SQLite/Turso with Prisma ORM
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui
- **Authentication**: Auth.js v4 with JWT, bcrypt, and OAuth providers
- **Email**: CrunchyCone-lib multi-provider email service
- **Storage**: CrunchyCone-lib with 6 storage providers
- **Theme**: next-themes with system detection

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- Git

### Installation

1. Clone the repository:

```bash
git clone https://github.com/crunchycone/crunchycone-starter-template.git
cd crunchycone-starter-template
```

2. Reset the project to initial state:

```bash
npm install
npm run reset
```

3. Start the development server:

```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser

### 🎯 Quick Setup with Cursor IDE

If you're using [Cursor IDE](https://cursor.com/), you can set up this project with a single command:

1. **Clone and Open in Cursor**:

```bash
git clone https://github.com/yourusername/crunchycone-vanilla-starter-project.git
cd crunchycone-vanilla-starter-project
cursor .
```

2. **Auto-Setup with AI**: In Cursor, simply ask Claude:

```
"setup this project"
```

Claude will automatically:

- ✅ Install all dependencies (`npm install`)
- ✅ Reset the database to fresh state (`npm run reset`)
- ✅ Generate a secure JWT_SECRET automatically
- ✅ Start the development server (`npm run dev`)
- ✅ Open [http://localhost:3000](http://localhost:3000) for you

3. **Create Admin Account**: Visit the opened localhost URL and:

- You'll be redirected to `/auth/setup-admin`
- Enter your email and password for the admin account
- Start using the application immediately

**Why use Cursor?** This project includes comprehensive `.cursor/rules` that help Cursor understand the codebase structure, authentication patterns, database models, and development workflows. Cursor can help you extend the project, add new features, and maintain best practices automatically.

### First-Time Setup

When you first run the application:

1. You'll be redirected to `/auth/setup-admin`
2. Create the first admin account
3. This account will have full admin privileges

## Project Structure

```
crunchycone-vanilla-starter-project/
├── app/                      # Next.js App Router
│   ├── actions/             # Server Actions
│   ├── admin/               # Admin dashboard pages
│   ├── api/                 # API routes
│   ├── auth/                # Authentication pages
│   └── page.tsx             # Home page
├── components/              # React components
│   ├── ui/                  # shadcn/ui components
│   ├── auth/                # Auth components
│   └── admin/               # Admin components
├── lib/                     # Utility functions
│   ├── auth/                # Authentication utilities
│   └── email/               # Email service
├── themes/                  # TypeScript theme system
│   ├── types.ts             # Theme TypeScript interfaces
│   ├── index.ts             # Theme registry and utilities
│   ├── base/                # Core system themes (light, dark)
│   └── custom/              # Custom themes (ocean, forest, midnight)
├── prisma/                  # Database configuration
│   ├── schema.prisma        # Database schema
│   └── seed.ts              # Seed script
└── docs/                    # Documentation
```

## Supported User Flows

### 🚀 First-Time Setup Flow

1. **Fresh Installation** → Visit any page
2. **No Admin Detection** → Automatic redirect to `/auth/setup-admin`
3. **Admin Account Creation** → Create first administrator account
4. **Database Initialization** → Sets up default roles and first admin user
5. **Ready to Use** → Application is now fully configured

### 👤 User Registration & Authentication Flows

#### Standard Sign-Up Flow

1. **Visit Sign-Up** → `/auth/signup`
2. **Enter Details** → Email, password, optional profile information
3. **Email Verification** → Receive verification email (console logged in dev)
4. **Verify Email** → Click link in email → `/auth/verify-email?token=...`
5. **Account Activated** → Can now sign in

#### Email/Password Sign-In Flow

1. **Visit Sign-In** → `/auth/signin`
2. **Enter Credentials** → Email and password
3. **Authentication** → Server verifies credentials
4. **Session Created** → JWT token in HTTP-only cookie
5. **Redirect to Dashboard** → Home page or intended destination

#### Magic Link Sign-In Flow

1. **Visit Sign-In** → `/auth/signin` → Magic Link tab
2. **Enter Email** → Request magic link
3. **Email Sent** → Receive magic link email (console logged in dev)
4. **Click Link** → Automatic sign-in via `/api/auth/magic-link?token=...`
5. **Authenticated** → Redirected to home with success message

#### Password Reset Flow

1. **Forgot Password** → Click "Forgot your password?" on sign-in page
2. **Request Reset** → `/auth/forgot-password` → Enter email
3. **Email Sent** → Receive reset link (console logged in dev)
4. **Reset Password** → Click link → `/auth/reset-password?token=...`
5. **New Password** → Enter and confirm new password
6. **Success** → Redirected to sign-in with confirmation

### 🛡️ Admin Management Flows

#### User Management

1. **Access Admin Panel** → `/admin/users` (admin only)
2. **Search Users** → Real-time search by email
3. **View User Details** → Profile information and roles
4. **Manage Roles** → Add/remove roles from users
5. **Send Password Reset** → Send reset email to any user
6. **Protection** → Cannot remove own admin role

#### Role Management

1. **Access Role Panel** → `/admin/roles` (admin only)
2. **View All Roles** → System and custom roles listed
3. **Create Custom Role** → Add new roles beyond user/admin
4. **Delete Roles** → Remove custom roles (if no users assigned)
5. **Protection** → Cannot delete system roles (user, admin)

### 🎨 TypeScript Theme System Flows

#### Theme Switching

1. **Theme Toggle** → Available on all pages (top-right) with dynamic theme loading
2. **Multiple Options** → Light, Dark, Ocean (🌊), Forest (🌲), Midnight (🌙), System
3. **Type-Safe Management** → TypeScript interfaces ensure theme consistency
4. **Persistence** → Theme choice saved across sessions
5. **System Detection** → Automatically follows OS theme preference
6. **Organized Structure** → Themes defined in `/themes/` with clear categorization

#### Theme Development

1. **Create Theme File** → Add new theme in `themes/custom/yourtheme.ts`
2. **Type Safety** → Use TypeScript interfaces for theme structure
3. **Register Theme** → Add to theme registry in `themes/index.ts`
4. **Auto CSS Generation** → Use utility functions to generate CSS
5. **Validation** → Built-in theme validation and testing utilities

### 📁 Media Manager & Storage Flows

#### File Upload & Management

1. **Access Media Manager** → `/admin/media` (admin only)
2. **Upload Files** → Dialog-based upload with drag & drop
3. **File Operations** → View, download, delete, toggle visibility (public/private)
4. **Search & Pagination** → Server-side search and paginated results (20 per page)
5. **File Details** → Comprehensive file information dialog
6. **Flash Effects** → Visual feedback for newly uploaded files

#### Storage Configuration

1. **Access Settings** → `/admin/settings` → Storage Configuration section
2. **Choose Provider** → LocalStorage, AWS S3, DigitalOcean Spaces, Azure Blob, Google Cloud Storage, CrunchyCone
3. **Configure Credentials** → Provider-specific settings with help dialogs
4. **Test Connection** → Verify settings work correctly (cloud providers only)
5. **Save Configuration** → Apply settings and switch providers seamlessly
6. **CrunchyCone Setup** → CLI authentication and project validation

### 🔧 Developer & Admin Workflows

#### Project Reset Flow

1. **Reset Command** → `npm run reset` or `npm run reset --yes`
2. **Confirmation** → Interactive prompt (unless --yes flag)
3. **Database Reset** → Removes existing database
4. **Fresh Setup** → Recreates schema and seeds data
5. **Environment Setup** → Copies .env.example if needed
6. **Ready State** → Returns to first-time setup state

#### Database Management

1. **Migrations** → `npx prisma migrate dev --name "description"`
2. **Client Generation** → Automatic after migrations
3. **Seeding** → `npm run db:seed` for default data
4. **Studio Access** → `npm run db:studio` for GUI management

### 📧 Email System Flows

#### Email Provider Configuration

1. **Access Settings** → `/admin/settings` → Email Configuration section
2. **Choose Provider** → Console, SMTP, SendGrid, Resend, AWS SES, Mailgun, CrunchyCone
3. **Configure Settings** → Provider-specific credentials with help dialogs
4. **Test Configuration** → Send test email to verify setup
5. **CrunchyCone Integration** → CLI authentication checking and project validation
6. **Save Settings** → Apply configuration and switch providers

#### Email Verification Flows

#### Email Verification

- **Purpose** → Verify user email addresses
- **Trigger** → Automatic after sign-up
- **Expiry** → 24 hours
- **Action** → Click link to verify email

#### Password Reset

- **Purpose** → Reset forgotten passwords
- **Trigger** → User request via forgot password form
- **Expiry** → 1 hour
- **Action** → Click link to set new password

#### Magic Link

- **Purpose** → Passwordless authentication
- **Trigger** → User request via sign-in form
- **Expiry** → 24 hours
- **Action** → Click link for automatic sign-in

### 🔒 Security & Protection Flows

#### Admin Protection

- **Self-Demotion Prevention** → Admin cannot remove own admin role
- **Last Admin Protection** → Cannot delete the last admin user
- **System Role Protection** → Cannot delete user/admin roles

#### Session Management

- **HTTP-Only Cookies** → Secure token storage
- **Automatic Expiry** → Sessions expire after 7 days
- **Logout Functionality** → Manual session termination
- **Cross-Device** → Independent sessions per device

## Key Features Explained

### Authentication Architecture

The authentication system uses a multi-layered approach:

- **Password Hashing**: bcrypt with salt rounds for secure storage
- **JWT Tokens**: Stateless authentication with different token types
- **Session Management**: HTTP-only cookies for CSRF protection
- **Token Types**: access, verification, reset, magic_link

### Role-Based Access Control (RBAC)

- **System Roles**: `user` (default) and `admin` (elevated permissions)
- **Custom Roles**: Create additional roles for specific permissions
- **Role Assignment**: Many-to-many relationship between users and roles
- **Permission Checks**: Server-side validation using `hasRole()` and `isAdmin()`

### Database Design Patterns

All models follow consistent patterns:

- **Standard Fields**: `id` (ULID), `created_at`, `updated_at`, `deleted_at`
- **ULID Auto-Generation**: All IDs automatically generated using Prisma Client Extensions
- **Soft Deletes**: Records marked as deleted, never physically removed
- **Relationships**: Proper foreign keys and indexes
- **Transactions**: Multi-table operations wrapped in database transactions

## Development

### Database Commands

```bash
# Generate Prisma client
npx prisma generate

# Create a new migration
npx prisma migrate dev --name your-migration-name

# Reset database (drop, create, migrate, seed)
npm run db:reset

# Open Prisma Studio
npm run db:studio

# Run seed script
npm run db:seed

# Reset project to initial state (with confirmation)
npm run reset

# Reset project without confirmation prompt
npm run reset --yes
```

### Distribution Commands

```bash
# Create distribution package for sharing/deployment
npm run distribute
```

The `npm run distribute` command creates a clean distribution package that:

- ✅ Excludes `.git`, `node_modules`, `.next`, and build artifacts
- ✅ Excludes environment files (keeps `.env.example`)
- ✅ Excludes database files (for fresh setup)
- ✅ Includes setup script for easy installation
- ✅ Creates timestamped distribution folder
- ✅ Includes distribution documentation

**Usage:**

1. Run `npm run distribute` in your project
2. Navigate to the created distribution folder
3. Zip the folder: `zip -r distribution-name.zip project-folder/`
4. Share the zip file with others

**Recipients can then:**

1. Extract the zip file
2. Run `./setup.sh` (or follow manual setup in DISTRIBUTION.md)
3. Start developing immediately

### Project Reset

The `npm run reset` command resets the project to its initial state:

- Removes existing database
- Creates fresh database with schema and seed data
- Copies .env.example to .env (if needed)
- **Automatically generates a secure JWT_SECRET** (only if using default value)
- Cleans Next.js build cache
- Prompts for confirmation before proceeding (unless `--yes` flag is used)

**Options:**

- `npm run reset` - Interactive mode with confirmation prompt
- `npm run reset --yes` (or `-y`) - Skip confirmation and reset immediately
- `npm run reset --new-secret` - Also generates a new JWT_SECRET
- `npm run reset --yes --new-secret` - Skip confirmation and generate new JWT_SECRET

This is useful for:

- Setting up the project for new developers
- Starting fresh during development
- Demonstrating the first-time setup flow
- Automated scripts and CI/CD pipelines (use `--yes` flag)

### Adding New Features

1. **Database Changes**: Update `prisma/schema.prisma` and run migrations
2. **Server Actions**: Add to `app/actions/`
3. **API Routes**: Create in `app/api/`
4. **Components**: Build in `components/`
5. **Pages**: Add to `app/`

### Email Configuration

By default, emails are logged to the console. To use a real email provider:

1. Choose a provider (SendGrid, Resend, AWS SES, SMTP)
2. Follow the guide in `docs/email-providers.md`
3. Update environment variables
4. Initialize the provider in your app

## Environment Variables

Create a `.env` file with these variables:

### Core Application

```env
# Authentication
AUTH_SECRET="your-secret-key-change-in-production"  # Auto-generated during setup
AUTH_URL="http://localhost:3000"

# Email
EMAIL_FROM="noreply@crunchycone.app"

# Application
NEXT_PUBLIC_APP_URL="http://localhost:3000"

# Email Provider (optional)
EMAIL_PROVIDER="console"  # or sendgrid, resend, aws-ses, smtp
```

### OAuth Providers (Optional)

Add OAuth providers by configuring credentials and enabling them:

```env
# Google OAuth
NEXT_PUBLIC_ENABLE_GOOGLE_AUTH=true
GOOGLE_CLIENT_ID="your-google-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="GOCSPX-your-google-client-secret"

# GitHub OAuth
NEXT_PUBLIC_ENABLE_GITHUB_AUTH=true
GITHUB_CLIENT_ID="your-github-client-id"
GITHUB_CLIENT_SECRET="your-github-client-secret"

# Authentication Method Toggles
NEXT_PUBLIC_ENABLE_EMAIL_PASSWORD=true  # Default: true
NEXT_PUBLIC_ENABLE_MAGIC_LINK=false     # Default: false
```

**Setup Guide**: See [docs/auth-providers.md](./docs/auth-providers.md) for complete OAuth setup instructions including:

- Creating OAuth apps in Google Cloud Console and GitHub
- Configuring callback URLs
- Testing OAuth flows
- Account linking and profile synchronization

### Database Configuration

**For SQLite (Local Development):**

```env
DATABASE_URL="file:./db/prod.db"
```

**For Turso (Production):**

```env
DATABASE_URL="libsql://[your-database-url]"
TURSO_AUTH_TOKEN="[your-auth-token]"
```

**For PostgreSQL:**

```env
DATABASE_URL="postgresql://user:password@host:port/database"
```

**For MySQL:**

```env
DATABASE_URL="mysql://user:password@host:port/database"
```

## Security Considerations

- ✅ Passwords hashed with bcrypt
- ✅ JWT tokens with appropriate expiry
- ✅ HTTP-only cookies for sessions
- ✅ CSRF protection with SameSite cookies
- ✅ Input validation with Zod
- ✅ SQL injection protection via Prisma
- ✅ Admin role protection

## Production Deployment

### Pre-deployment Checklist

1. [ ] Change `JWT_SECRET` to a secure random value
2. [ ] Configure a production email provider (via admin settings)
3. [ ] Configure a production storage provider (via admin settings)
4. [ ] Set up proper `NEXT_PUBLIC_APP_URL`
5. [ ] Enable HTTPS
6. [ ] Configure database backups
7. [ ] Set up monitoring and logging
8. [ ] Review and update CORS settings
9. [ ] Test all authentication flows
10. [ ] Test file upload and storage functionality
11. [ ] Verify email delivery in production

or - just use the CrunchyCone Platform (coming soon!)

### Database

For production, choose from supported options:

**Database:**
- **Turso (libSQL)** - Recommended for production (edge database, SQLite compatible)
- **PostgreSQL** - Traditional production database
- **MySQL** - Alternative traditional database
- **SQLite** - Local development only

**Storage:**
- **LocalStorage** - File system storage (development/single server)
- **AWS S3** - Amazon cloud storage with optional CloudFront CDN
- **DigitalOcean Spaces** - DigitalOcean object storage with CDN
- **Azure Blob Storage** - Microsoft cloud storage with CDN
- **Google Cloud Storage** - Google cloud storage with CDN
- **CrunchyCone** - Integrated cloud storage (requires CLI setup)

**Email:**
- **Console** - Development only (logged to console)
- **SMTP** - Generic SMTP (Gmail, Outlook, Yahoo, custom)
- **SendGrid** - Transactional email service
- **Resend** - Modern email API
- **AWS SES** - Amazon email service
- **Mailgun** - Email delivery service
- **CrunchyCone** - Integrated email service

The application includes automatic database detection and migration:

- **SQLite** (`file:`) - Standard Prisma migrations
- **Turso** (`libsql:`) - Custom migration system with `turso-migrate.js`
- **PostgreSQL/MySQL** - Standard Prisma migrations

Update the `DATABASE_URL` (and `TURSO_AUTH_TOKEN` for Turso) accordingly. The Docker image will automatically detect and handle the appropriate database setup.

## Container Deployment

This project includes a production-ready multi-stage Dockerfile with automatic platform detection and database migration support. Deploy to any container platform:

**Supported Platforms:**
- **[Render.com](https://render.com)** - Simple container deployments with automatic builds
- **[Fly.io](https://fly.io)** - Global edge deployment with automatic scaling
- **[Cloudflare Containers](https://developers.cloudflare.com/containers/)** - Edge-first serverless platform
- **[Google Cloud Run](https://cloud.google.com/run)** - Fully managed containerized applications
- **[DigitalOcean App Platform](https://www.digitalocean.com/products/app-platform)** - Simple container hosting
- **[AWS App Runner](https://aws.amazon.com/apprunner)** - Container-based web applications
- **[Railway](https://railway.app)** - Developer-first deployment platform

**Docker Features:**
- ✅ Node.js 24 with multi-stage build for optimized production images
- ✅ Automatic database file copying and platform detection with migration status checks
- ✅ Security hardening with non-root user and health checks
- ✅ Next.js standalone output for minimal container size
- ✅ Build cache management and migration optimization

**Setup Guide:** See [docs/container-deployment.md](./docs/container-deployment.md) for complete deployment instructions including platform-specific configuration, environment variables, and step-by-step setup guides.

## Testing

```bash
# Run linting (zero errors/warnings maintained)
npm run lint

# Run linting with automatic fixes
npm run lint --fix

# Build for production
npm run build

# Test structured logging (production mode)
NODE_ENV=production LOG_LEVEL=debug npm run build
```

## Documentation

Detailed guides are available in the `docs/` folder:

- [Container Deployment Guide](./docs/container-deployment.md)
- [Email Providers Guide](./docs/email-providers.md)
- [Authentication Providers Guide](./docs/auth-providers.md)
- [Theme Customization Guide](./docs/theme-customization.md)
- [Technical Documentation (CLAUDE.md)](./CLAUDE.md)

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

## Support

For issues, questions, or contributions:

- Open an issue on GitHub
- Check existing documentation
- Review closed issues for solutions

## Acknowledgments

- Built with [Next.js](https://nextjs.org/)
- UI components from [shadcn/ui](https://ui.shadcn.com/)
- Database ORM by [Prisma](https://www.prisma.io/)
- Styled with [Tailwind CSS](https://tailwindcss.com/)

---

Built with ❤️ and lots of 🍨 by the CrunchyCone team
# Trigger deployment
