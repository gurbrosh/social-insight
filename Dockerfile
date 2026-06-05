# ============================================
# Unified Multi-Platform Dockerfile
# ============================================
# Uses unified entrypoint with platform auto-detection
# Supports Render.com, Cloudflare Containers, and other platforms
# Includes automatic database detection and migration:
# - SQLite (file:) - Standard Prisma migrations
# - Turso (libsql:) - Custom migration system via turso-migrate.js
# - PostgreSQL/MySQL - Standard Prisma migrations
# ============================================

# Multi-stage build for optimized production image
# Stage 1: Dependencies
FROM node:24-slim AS deps
# Install OpenSSL for Prisma
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci --only=production --legacy-peer-deps && \
    npm cache clean --force

# Stage 2: Builder
FROM node:24-slim AS builder
# Install OpenSSL for Prisma
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Copy package files and install all dependencies (including dev)
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps && \
    npm cache clean --force

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build the Next.js application
# Set dummy DATABASE_URL for build time (will be overridden at runtime)
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="file:./db/prod.db"
RUN npm run build

# Stage 3: Runner (production image)
# Using debian-slim for better compatibility and smaller total size
FROM node:24-slim AS runner
# Install OpenSSL for Prisma
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Create non-root user for security
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs

# Set environment to production
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy necessary files from builder stage
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy cache if it exists, otherwise create empty cache directory
RUN --mount=from=builder,source=/app/.next,target=/tmp/next \
    if [ -d "/tmp/next/cache" ]; then \
        cp -r /tmp/next/cache ./.next/cache; \
        echo "✓ Copied Next.js cache from build"; \
    else \
        mkdir -p ./.next/cache; \
        echo "ℹ️  Created empty Next.js cache directory"; \
    fi

# Clean up build artifacts to reduce size
RUN find /app -name "*.map" -delete && \
    find /app -name "*.d.ts" -delete && \
    find /app -name "README*" -delete && \
    rm -rf /tmp/* /var/tmp/* 2>/dev/null || true

# Copy Prisma schema and migrations for runtime
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts

# Copy config data file if it exists (for automatic config import during deployment)
RUN --mount=from=builder,source=/app/prisma,target=/tmp/prisma \
    if [ -f "/tmp/prisma/config-data.json" ]; then \
        cp /tmp/prisma/config-data.json /app/prisma/config-data.json && \
        echo "✓ Copied config-data.json for deployment import"; \
    else \
        echo "ℹ️  No config-data.json found (will skip config import)"; \
    fi

# Copy email templates for runtime
COPY --from=builder /app/templates ./templates

# Copy database files if they exist (for SQLite databases)
# External databases (PostgreSQL, MySQL, Turso) use different DATABASE_URL formats
# Support both ./db/ and ./prisma/db/ locations
RUN --mount=from=builder,source=/app,target=/tmp/builder \
    mkdir -p /app/db /app/prisma/db && \
    DB_COPIED=false && \
    if [ -d "/tmp/builder/db" ] && [ "$(ls -A /tmp/builder/db 2>/dev/null)" ]; then \
        cp -r /tmp/builder/db/* /app/db/ 2>/dev/null || true; \
        cp -r /tmp/builder/db/* /app/prisma/db/ 2>/dev/null || true; \
        echo "✓ Copied database files from ./db/"; \
        DB_COPIED=true; \
    fi && \
    if [ -d "/tmp/builder/prisma/db" ] && [ "$(ls -A /tmp/builder/prisma/db 2>/dev/null)" ]; then \
        cp -r /tmp/builder/prisma/db/* /app/db/ 2>/dev/null || true; \
        cp -r /tmp/builder/prisma/db/* /app/prisma/db/ 2>/dev/null || true; \
        echo "✓ Copied database files from ./prisma/db/"; \
        DB_COPIED=true; \
    fi && \
    if [ "$DB_COPIED" = "false" ]; then \
        echo "ℹ️  No database files found in ./db/ or ./prisma/db/"; \
    fi

# Copy production dependencies from deps stage first (smaller, production-only)
COPY --from=deps /app/node_modules ./node_modules

# Prisma CLI is a devDependency, but our runtime Turso migration system uses it.
# Prisma CLI has many transitive dependencies (effect, @prisma/*, etc.),
# so we need to copy ALL node_modules from builder to ensure everything is available.
# This overwrites the production-only node_modules with the full set.
COPY --from=builder /app/node_modules ./node_modules

# Copy UNIFIED entrypoint script (ONLY CHANGE from working Dockerfile)
COPY --chown=nextjs:nodejs scripts/unified-entrypoint.sh /app/unified-entrypoint.sh
RUN chmod +x /app/unified-entrypoint.sh

# Create logs directory with proper permissions
RUN mkdir -p /app/logs/orchestration && \
    chown -R nextjs:nodejs /app/logs && \
    chmod -R 755 /app/logs

# Ensure proper permissions for all directories and cache
RUN chown -R nextjs:nodejs /app/prisma /app/db /app/.next && \
    chmod -R 755 /app/db /app/prisma/db /app/.next/cache

# Switch to non-root user (using numeric UID for Kubernetes security compliance)
# This satisfies runAsNonRoot: true requirements by using numeric user ID
USER 1001:1001

# Expose port range (Render auto-assigns port via PORT env var)
EXPOSE 3000 10000

# Environment variables will be read from external environment at runtime
# The following are common variables that should be set:
# DATABASE_URL - Database connection string (SQLite: file:./db/prod.db, Turso: libsql://...)
# TURSO_AUTH_TOKEN - Required for Turso/libSQL databases (obtain from Turso dashboard)
# JWT_SECRET - Secret key for JWT tokens
# NEXT_PUBLIC_APP_URL - Public URL of the application
# EMAIL_FROM - Default from email address

# Use UNIFIED entrypoint script for database initialization (ONLY CHANGE)
ENTRYPOINT ["/app/unified-entrypoint.sh"]

# Start the application
CMD ["node", "server.js"]
