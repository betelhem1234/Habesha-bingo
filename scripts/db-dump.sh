#!/usr/bin/env bash
set -euo pipefail

# Ensure script runs from project root
cd "$(dirname "$0")/.."

# Load DATABASE_URL from .env
if [ -f .env ]; then
  DB_URL=$(grep -E '^DATABASE_URL=' .env | cut -d '=' -f2- | tr -d '"' | tr -d "'" | tr -d '\r')
  export DATABASE_URL="${DB_URL}"
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "❌ Error: DATABASE_URL is not set in .env" >&2
  exit 1
fi

# Strip Prisma-specific query parameter (?schema=public or &schema=public) that pg_dump rejects
CLEAN_DB_URL=$(echo "${DATABASE_URL}" | sed -E 's/([?&])schema=[^&]+(&|$)/\1/g; s/[?&]$//')

BACKUP_DIR="backups"
mkdir -p "${BACKUP_DIR}"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
OUTPUT_FILE="${BACKUP_DIR}/neon_backup_${TIMESTAMP}.sql"

echo "=== Neon PostgreSQL Database Dump ==="
echo "Target file: ${OUTPUT_FILE}"

pg_dump "${CLEAN_DB_URL}" \
  --no-owner \
  --no-acl \
  --clean \
  --if-exists \
  --file="${OUTPUT_FILE}"

FILE_SIZE=$(du -h "${OUTPUT_FILE}" | cut -f1)
echo "✅ Database backup created successfully!"
echo "📁 Location: ${OUTPUT_FILE} (${FILE_SIZE})"
echo "💡 To restore this backup into any PostgreSQL database, run:"
echo "   psql \"\$TARGET_DATABASE_URL\" < \"${OUTPUT_FILE}\""
