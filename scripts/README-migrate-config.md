# Migrate Configuration Data Script

This script migrates scrapers, orchestrations, and recipes from your local database to your deployed/remote database.

## 🚀 Quick Start (Before Deploying)

**Before pushing to CrunchyCone**, sync your configuration data:

```bash
# Set your remote database credentials
export REMOTE_DATABASE_URL="libsql://your-turso-db-url"
export TURSO_AUTH_TOKEN="your-turso-token"

# Run the pre-deployment sync (recommended)
npm run deploy:sync
```

This will sync all your orchestrations and recipes to the remote database before you deploy.

## Usage Options

### Option 1: Pre-deployment Sync (Recommended)

```bash
# Set environment variables
export REMOTE_DATABASE_URL="libsql://..."              # Your remote Turso database URL
export TURSO_AUTH_TOKEN="..."                          # Your Turso auth token

# Run the pre-deployment sync
npm run deploy:sync
```

### Option 2: Manual Migration

```bash
# Set environment variables
export LOCAL_DATABASE_URL="file:./db/prod.db"  # Your local database (optional, defaults to this)
export REMOTE_DATABASE_URL="libsql://..."              # Your remote Turso database URL
export TURSO_AUTH_TOKEN="..."                          # Your Turso auth token

# Run the migration
npm run db:migrate-config
```

### Option 3: Direct Execution

```bash
# Set environment variables
export LOCAL_DATABASE_URL="file:./db/prod.db"  # Your local database (optional, defaults to this)
export REMOTE_DATABASE_URL="libsql://..."              # Your remote Turso database URL
export TURSO_AUTH_TOKEN="..."                          # Your Turso auth token

# Run the migration
node scripts/migrate-config-data.js
```

**Important Notes**:
- This script must run **locally** (not in the container) because it needs access to both local and remote databases
- Run it **before deploying** to ensure your remote database has the latest orchestrations and recipes
- If `REMOTE_DATABASE_URL` is not set, the script will try to use `DATABASE_URL` from your `.env` file, but this is typically your local database. You should explicitly set `REMOTE_DATABASE_URL` for the remote database.

## What Gets Migrated

1. **Scrapers** - All scraper configurations
2. **Orchestrations** - All orchestration configurations
3. **Recipes** - All recipe configurations including:
   - Recipe steps
   - Recipe step skip configurations
4. **AppConfig** - All application configuration items (from the Configuration section in admin)

## Notes

- The script automatically maps local user IDs to the first admin user found in the remote database
- Existing records (by ID) are skipped to avoid duplicates
- All timestamps and relationships are preserved
- The script uses direct SQL for the remote database (works with Turso/libSQL)

## Example Output

```
🚀 Starting configuration data migration...
   Local DB: file:./db/prod.db
   Remote DB: libsql://p-0199655c41ab77ceb0b...

📤 Exporting data from local database...
📦 Exporting scrapers...
   Found 5 scraper(s)
📦 Exporting orchestrations...
   Found 3 orchestration(s)
📦 Exporting recipes...
   Found 2 recipe(s) with 8 total step(s)

📥 Importing data to remote database...
📥 Importing 5 scraper(s)...
   ✓ Imported scraper "LinkedIn Posts Scraper"
   ...
   ✅ Imported 5, skipped 0

📥 Importing 3 orchestration(s)...
   ✓ Imported orchestration "Daily Social Media Monitor"
   ...
   ✅ Imported 3, skipped 0

📥 Importing 2 recipe(s)...
   ✓ Imported recipe "Morning Report Recipe"
     → Imported 4 step(s), skipped 0
   ...
   ✅ Imported 2 recipe(s), skipped 0

✅ Migration complete!
📊 Summary:
   Scrapers: 5 imported, 0 skipped
   Orchestrations: 3 imported, 0 skipped
   Recipes: 2 imported, 0 skipped
   Recipe Steps: 8 imported, 0 skipped
```



