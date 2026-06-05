#!/bin/sh
set -e

echo "🚀 Starting CrunchyCone application..."

# Default: fail fast in production if migrations fail (prevents booting into a broken schema)
if [ -z "${MIGRATION_STRICT+x}" ]; then
  if [ "$NODE_ENV" = "production" ]; then
    MIGRATION_STRICT=true
  else
    MIGRATION_STRICT=false
  fi
fi

# Check if we're using Turso (libSQL)
if echo "$DATABASE_URL" | grep -q "^libsql://"; then
  echo "📡 Detected Turso database configuration"
  if [ -z "$TURSO_AUTH_TOKEN" ]; then
    echo "⚠️  Warning: TURSO_AUTH_TOKEN not set for Turso database"
    exit 1
  fi
  
  echo "🔄 Running Turso database migrations..."
  
  # Run automated migration system
  if node /app/scripts/turso-migrate.js; then
    echo "✅ Turso migrations completed successfully"
  else
    if [ "$MIGRATION_STRICT" = "true" ]; then
      echo "❌ Migration failed"
      exit 1
    else
      echo "⚠️  Some migrations may have failed, but continuing..."
    fi
  fi
  
  echo "✅ Turso database ready"
  
# Check if we're using SQLite (file-based)
elif echo "$DATABASE_URL" | grep -q "^file:"; then
  echo "📁 Detected SQLite database configuration"
  
  # Extract the database file path from DATABASE_URL
  DB_PATH=$(echo "$DATABASE_URL" | sed 's/^file://')
  DB_DIR=$(dirname "$DB_PATH")
  
  # Ensure the database directory exists (only for file-based SQLite)
  if [ ! -d "$DB_DIR" ]; then
    echo "📂 Creating database directory: $DB_DIR"
    mkdir -p "$DB_DIR" || true
  fi
  
  # Check if we can write to the directory
  if [ ! -w "$DB_DIR" ]; then
    echo "⚠️  Warning: Database directory is not writable. Volume permissions may need adjustment."
  fi
  
  # Check if database exists
  if [ ! -f "$DB_PATH" ]; then
    echo "🔧 Database not found at $DB_PATH"
    echo "🏗️  Running database migrations..."
    npx prisma migrate deploy 2>/dev/null || {
      echo "⚠️  Migrations failed or not found, pushing schema directly..."
      npx prisma db push --skip-generate
    }
    
    # Run seed if database was just created and seed file exists
    if [ -f "prisma/seed.ts" ] || [ -f "prisma/seed.js" ]; then
      echo "🌱 Seeding database with initial data..."
      npx prisma db seed || echo "⚠️  Seeding failed, continuing anyway..."
    fi
  else
    echo "✅ Database found at $DB_PATH"
    # Run any pending migrations
    echo "🔄 Checking for pending migrations..."
    npx prisma migrate deploy 2>/dev/null || echo "ℹ️  No migrations to apply"
  fi
  
# PostgreSQL or MySQL
else
  echo "🗄️  Detected external database configuration"
  echo "🔄 Running database migrations..."
  npx prisma migrate deploy 2>/dev/null || {
    echo "⚠️  Migrations failed or not found, pushing schema directly..."
    npx prisma db push --skip-generate
  }
fi

echo "✨ Database setup complete!"
echo "🚀 Starting Next.js application..."

# Execute the main command (CMD from Dockerfile)
exec "$@"