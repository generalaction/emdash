#!/usr/bin/env bash
# export-project-config.sh — export an Emdash project + its repository-instance
# workspace + its automations from THIS machine's emdash4.db into a portable SQL
# file, rewriting the local repo path to the server's path.
#
# Run this on your Mac (the machine where the automation is already configured),
# then copy the generated .sql to the server and apply it (the headless setup
# script does this for you).
#
# Usage:
#   ./export-project-config.sh <project-name> [server-repo-path] [out-file]
#
# Example:
#   ./export-project-config.sh doc-engine /opt/projects/doc-engine ./project-config.sql
set -euo pipefail

PROJECT_NAME="${1:?usage: export-project-config.sh <project-name> [server-repo-path] [out-file]}"
SERVER_REPO_PATH="${2:-/opt/projects/${PROJECT_NAME}}"
OUT_FILE="${3:-./project-config.sql}"

# Resolve the desktop DB (macOS path; falls back to Linux ~/.config).
DB_MAC="${HOME}/Library/Application Support/emdash/emdash4.db"
DB_LINUX="${HOME}/.config/emdash/emdash4.db"
if [[ -f "$DB_MAC" ]]; then
  DB="$DB_MAC"
elif [[ -f "$DB_LINUX" ]]; then
  DB="$DB_LINUX"
else
  echo "✗ Could not find emdash4.db at:" >&2
  echo "    $DB_MAC" >&2
  echo "    $DB_LINUX" >&2
  exit 1
fi

echo "→ Reading from $DB"

# Look up the project by name.
PROJECT_ID="$(sqlite3 "$DB" "SELECT id FROM projects WHERE name = '${PROJECT_NAME}' LIMIT 1;")"
if [[ -z "$PROJECT_ID" ]]; then
  echo "✗ No project named '${PROJECT_NAME}' found. Known projects:" >&2
  sqlite3 "$DB" "SELECT '   - ' || name || '  (' || path || ')' FROM projects;" >&2
  exit 1
fi

PROJECT_PATH="$(sqlite3 "$DB" "SELECT path FROM projects WHERE id = '${PROJECT_ID}';")"
WS_ID="$(sqlite3 "$DB" "SELECT repository_workspace_id FROM projects WHERE id = '${PROJECT_ID}';")"

echo "   project:   ${PROJECT_NAME} (${PROJECT_ID})"
echo "   local path: ${PROJECT_PATH}"
echo "   workspace:  ${WS_ID}"
echo "   → rewriting path to: ${SERVER_REPO_PATH}"

# Emit portable INSERT statements. We use INSERT OR REPLACE so re-applying is
# idempotent. Paths are rewritten from the local checkout to the server path.
# .mode insert quotes/escapes values safely; we then post-process the path.
{
  echo "-- Emdash project config export"
  echo "-- project: ${PROJECT_NAME}  (${PROJECT_ID})"
  echo "-- generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "PRAGMA foreign_keys = OFF;"
  echo "BEGIN TRANSACTION;"
  echo ""

  echo "-- projects"
  sqlite3 "$DB" ".mode insert projects" "SELECT * FROM projects WHERE id = '${PROJECT_ID}';"

  echo ""
  echo "-- workspaces (repository-instance for the project root)"
  sqlite3 "$DB" ".mode insert workspaces" "SELECT * FROM workspaces WHERE id = '${WS_ID}';"

  echo ""
  echo "-- automations attached to this project"
  sqlite3 "$DB" ".mode insert automations" "SELECT * FROM automations WHERE project_id = '${PROJECT_ID}';"

  echo ""
  echo "COMMIT;"
  echo "PRAGMA foreign_keys = ON;"
} > "${OUT_FILE}.raw"

# sqlite's .mode insert emits `INSERT INTO <table> VALUES(...)`. Switch to
# OR REPLACE for idempotency, and rewrite the local repo path to the server path
# everywhere it appears (project.path, workspace.path, and any task_config JSON).
sed \
  -e 's/^INSERT INTO/INSERT OR REPLACE INTO/' \
  -e "s|${PROJECT_PATH}|${SERVER_REPO_PATH}|g" \
  "${OUT_FILE}.raw" > "${OUT_FILE}"
rm -f "${OUT_FILE}.raw"

echo ""
echo "✓ Wrote ${OUT_FILE}"
echo ""
echo "  Next: copy it to the server and apply it to the headless app's DB."
echo "  The setup-headless-runner.sh script does this automatically, or manually:"
echo "    scp ${OUT_FILE} ${USER}@home-server.local:/tmp/project-config.sql"
echo "    ssh ${USER}@home-server.local 'sqlite3 ~/.config/emdash/emdash4.db < /tmp/project-config.sql'"
echo ""
echo "  Webhook token preserved — your existing webhook URL keeps working:"
sqlite3 "$DB" "SELECT '    POST /webhook/' || webhook_token FROM automations WHERE project_id = '${PROJECT_ID}' AND webhook_token IS NOT NULL;"
