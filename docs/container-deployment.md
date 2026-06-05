# Container Deployment Guide

This guide covers deploying the CrunchyCone Vanilla Starter Project to various container platforms.

## Overview

The project includes a production-ready multi-stage Dockerfile with:
- ✅ **Node.js 24** with multi-stage build for optimized production images
- ✅ **Automatic database file copying** and platform detection (Render, Cloudflare, Fly.io, etc.)
- ✅ **Database auto-migration with status checks** on startup (SQLite, Turso, PostgreSQL, MySQL)
- ✅ **Migration optimization** - skips unnecessary migrations for better startup performance
- ✅ **Security hardening** with non-root user and proper file permissions
- ✅ **Next.js standalone output** for minimal container size
- ✅ **Build cache management** with optimized .next directory handling
- ✅ **Health check** endpoint at `/api/health`
- ✅ **Graceful shutdown** handling

## Supported Platforms

### Render.com
Simple container deployments with automatic builds and managed databases.

**Configuration:**
```yaml
# render.yaml (optional)
services:
  - type: web
    name: crunchycone-app
    env: docker
    dockerfilePath: ./Dockerfile
    envVars:
      - key: DATABASE_URL
        value: postgresql://username:password@host:port/database
      - key: AUTH_SECRET
        generateValue: true
      - key: NEXT_PUBLIC_APP_URL
        value: https://your-app.onrender.com
```

**Required Environment Variables:**
- `DATABASE_URL` - PostgreSQL connection string (Render provides managed PostgreSQL)
- `AUTH_SECRET` - Generate in Render dashboard
- `NEXT_PUBLIC_APP_URL` - Your Render app URL
- `EMAIL_FROM` - Your email address

**Deployment Steps:**
1. Connect your GitHub repository to Render
2. Create a new Web Service, select Docker environment
3. Set environment variables in Render dashboard
4. Deploy automatically on git push

### Fly.io
Global edge deployment with automatic scaling and built-in PostgreSQL.

**Configuration:**
```toml
# fly.toml
app = "your-app-name"
primary_region = "dfw"

[build]
  dockerfile = "Dockerfile"

[env]
  NEXT_TELEMETRY_DISABLED = "1"
  NODE_ENV = "production"

[[services]]
  http_checks = []
  internal_port = 3000
  protocol = "tcp"
```

**Required Secrets (set via `flyctl secrets set`):**
- `DATABASE_URL` - Use Turso or external PostgreSQL
- `AUTH_SECRET` - Generate secure random string
- `NEXT_PUBLIC_APP_URL` - Your Fly app URL
- `EMAIL_FROM` - Your email address

**Deployment Steps:**
1. Install flyctl: `curl -L https://fly.io/install.sh | sh`
2. Login: `flyctl auth login`
3. Initialize: `flyctl launch`
4. Set secrets: `flyctl secrets set AUTH_SECRET=your-secret`
5. Deploy: `flyctl deploy`

### Google Cloud Run
Fully managed containerized applications with auto-scaling and Cloud SQL integration.

**Configuration:**
```yaml
# cloudbuild.yaml (optional)
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', 'gcr.io/$PROJECT_ID/crunchycone-app', '.']
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', 'gcr.io/$PROJECT_ID/crunchycone-app']
```

**Required Environment Variables:**
- `DATABASE_URL` - Cloud SQL PostgreSQL or Turso
- `AUTH_SECRET` - Store in Secret Manager
- `NEXT_PUBLIC_APP_URL` - Your Cloud Run service URL
- `EMAIL_FROM` - Your email address

**Deployment Steps:**
1. Enable Cloud Run and Container Registry APIs
2. Build and push image: `gcloud builds submit --tag gcr.io/PROJECT_ID/crunchycone-app`
3. Deploy to Cloud Run: `gcloud run deploy --image gcr.io/PROJECT_ID/crunchycone-app --platform managed`
4. Set environment variables in Cloud Run console

### DigitalOcean App Platform
Simple container hosting with managed databases and automatic SSL.

**Configuration:**
```yaml
# .do/app.yaml (optional)
name: crunchycone-app
services:
- name: web
  source_dir: /
  dockerfile_path: Dockerfile
  http_port: 3000
  instance_count: 1
  instance_size_slug: basic-xxs
  envs:
  - key: NEXT_TELEMETRY_DISABLED
    value: "1"
  - key: NODE_ENV
    value: production
```

**Required Environment Variables:**
- `DATABASE_URL` - Managed PostgreSQL or Turso
- `AUTH_SECRET` - Generate in App Platform dashboard
- `NEXT_PUBLIC_APP_URL` - Your App Platform URL
- `EMAIL_FROM` - Your email address

**Deployment Steps:**
1. Create new App in DigitalOcean App Platform
2. Connect GitHub repository
3. Select Dockerfile deployment
4. Configure environment variables
5. Deploy from dashboard

### AWS App Runner
Container-based web applications with automatic scaling and load balancing.

**Required Environment Variables:**
- `DATABASE_URL` - RDS PostgreSQL, Aurora, or Turso
- `AUTH_SECRET` - Store in AWS Systems Manager Parameter Store
- `NEXT_PUBLIC_APP_URL` - Your App Runner service URL
- `EMAIL_FROM` - Your email address

**Deployment Steps:**
1. Create ECR repository for your container
2. Build and push image to ECR
3. Create App Runner service with ECR image
4. Configure environment variables and secrets
5. Deploy and configure custom domain

### Railway
Developer-first deployment platform with built-in PostgreSQL and Redis.

**Required Environment Variables:**
- `DATABASE_URL` - Railway PostgreSQL or external database
- `AUTH_SECRET` - Generate in Railway dashboard
- `NEXT_PUBLIC_APP_URL` - Your Railway app URL
- `EMAIL_FROM` - Your email address

**Deployment Steps:**
1. Connect GitHub repository to Railway
2. Select Dockerfile deployment
3. Add PostgreSQL service (optional)
4. Configure environment variables
5. Deploy automatically on git push

### Cloudflare Containers
Edge-first serverless platform with global deployment and D1 database.

**Required Environment Variables:**
- `DATABASE_URL` - External PostgreSQL or Turso (D1 not supported yet)
- `AUTH_SECRET` - Store in Cloudflare Workers secrets
- `NEXT_PUBLIC_APP_URL` - Your Cloudflare app URL
- `EMAIL_FROM` - Your email address

**Deployment Steps:**
1. Install Wrangler CLI: `npm install -g wrangler`
2. Login: `wrangler login`
3. Configure wrangler.toml for container deployment
4. Deploy: `wrangler deploy`

## Environment Variables Reference

### Required for All Platforms

```env
# Authentication
AUTH_SECRET=your-secure-random-secret-min-32-chars
AUTH_URL=https://your-app-domain.com
NEXT_PUBLIC_APP_URL=https://your-app-domain.com

# Database (choose one)
DATABASE_URL=postgresql://user:pass@host:port/db
# OR for Turso
DATABASE_URL=libsql://your-turso-db-url
TURSO_AUTH_TOKEN=your-turso-token

# Email
EMAIL_FROM=noreply@yourdomain.com
```

### Optional OAuth Providers

```env
# Google OAuth
NEXT_PUBLIC_ENABLE_GOOGLE_AUTH=true
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-google-client-secret

# GitHub OAuth
NEXT_PUBLIC_ENABLE_GITHUB_AUTH=true
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret

# Authentication Method Toggles
NEXT_PUBLIC_ENABLE_EMAIL_PASSWORD=true  # Default: true
NEXT_PUBLIC_ENABLE_MAGIC_LINK=false     # Default: false
```

### Platform-Specific Settings

Most platforms auto-detect these from the Dockerfile:
- **Port**: 3000 (defined in Dockerfile EXPOSE)
- **Build command**: Automatic via Dockerfile multi-stage build
- **Start command**: Automatic via Dockerfile ENTRYPOINT

## Database Configuration

### Recommended Databases by Platform

- **Render.com**: Managed PostgreSQL
- **Fly.io**: Turso (libSQL) or external PostgreSQL
- **Google Cloud Run**: Cloud SQL PostgreSQL
- **DigitalOcean**: Managed PostgreSQL
- **AWS App Runner**: RDS PostgreSQL or Aurora
- **Railway**: Built-in PostgreSQL
- **Cloudflare**: Turso (libSQL) recommended

### Database Migration

The Docker container automatically handles database migrations on startup with optimization:
- **SQLite** (`file:`) - Standard Prisma migrations with automatic database file copying
- **Turso** (`libsql:`) - Custom migration system via turso-migrate.js with status checks and early exit
- **PostgreSQL/MySQL** - Standard Prisma migrations with status verification to skip unnecessary runs

## General Deployment Steps

1. **Choose Platform**: Select from supported platforms above
2. **Prepare Repository**: Ensure your code is pushed to GitHub/GitLab
3. **Set Environment Variables**: Configure required environment variables
4. **Configure Database**: Set up managed database or use Turso
5. **Deploy**: Use platform-specific deployment method
6. **Configure Domain**: Set up custom domain and SSL
7. **Post-Deployment Setup**:
   - Visit your deployed app
   - Create admin account at `/auth/setup-admin`
   - Configure email provider via admin settings
   - Configure storage provider via admin settings

## Troubleshooting

### Common Issues

**Build Failures:**
- Ensure Docker daemon is running locally for testing
- Check Node.js version compatibility (requires Node 18+, uses Node 24 in production)
- Verify all dependencies are in package.json
- Clear build caches: `docker system prune` and `rm -rf .next` if needed

**Database Connection Issues:**
- Verify DATABASE_URL format matches your database type
- Ensure database is accessible from your deployment platform
- Check firewall rules for external databases

**Environment Variable Issues:**
- Ensure AUTH_SECRET is at least 32 characters long
- Verify NEXT_PUBLIC_APP_URL matches your deployed domain
- Check that secrets are properly set in platform dashboard

**Migration Issues:**
- Ensure database user has proper permissions
- Check that schema.prisma is up to date
- Review migration logs in platform console

### Health Check

The application includes a health check endpoint at `/api/health` that returns:
- Application status
- Database connectivity
- Environment validation

Use this endpoint for platform health checks and monitoring.

## Security Considerations

- Use managed databases when possible for better security
- Store secrets in platform secret managers, not environment variables
- Enable HTTPS/SSL on all platforms
- Set appropriate CORS policies
- Use secure, randomly generated AUTH_SECRET values
- Regularly update dependencies and base images

## Cost Optimization

- Start with smallest instance sizes and scale up as needed
- Use managed databases for better cost predictability
- Consider Turso for serverless database scaling
- Monitor resource usage and optimize container size
- Use platform-specific cost management tools

## Support

For platform-specific deployment issues:
- Check platform documentation and support channels
- Review platform status pages for service issues
- Test deployments locally with Docker first
- Use platform CLI tools for debugging

For application-specific issues:
- Check application logs via platform console
- Use the health check endpoint for diagnostics
- Review Next.js and Prisma documentation
- Open issues on the project GitHub repository