#!/bin/sh
# Container entry point: applies the database schema, then starts Wrangler's local runtime.
# Everything that must survive a restart lives in PERSIST_TO (default /data).
set -eu

DATA_DIR="${PERSIST_TO:-/data}"
PORT="${PORT:-8787}"
REGISTRATION_OPEN="${REGISTRATION_OPEN:-true}"
mkdir -p "$DATA_DIR"

# Create the two-factor encryption key once and keep it in the data volume.
if [ -z "${MFA_ENCRYPTION_KEY:-}" ]; then
  KEY_FILE="$DATA_DIR/mfa-encryption-key"
  if [ -s "$KEY_FILE" ]; then
    MFA_ENCRYPTION_KEY="$(cat "$KEY_FILE")"
  else
    MFA_ENCRYPTION_KEY="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))")"
    printf '%s\n' "$MFA_ENCRYPTION_KEY" > "$KEY_FILE"
    chmod 600 "$KEY_FILE"
    echo "Created MFA_ENCRYPTION_KEY in $KEY_FILE. Back it up and keep it secret."
  fi
  export MFA_ENCRYPTION_KEY
fi

# make-owner.mjs --local writes this file; an explicit env var still wins.
if [ -z "${OWNER_ACCOUNT_ID:-}" ] && [ -s "$DATA_DIR/owner-account-id" ]; then
  OWNER_ACCOUNT_ID="$(cat "$DATA_DIR/owner-account-id")"
  export OWNER_ACCOUNT_ID
fi

echo "Preparing site assets..."
node scripts/version-assets.mjs

echo "Applying database migrations..."
npx --no-install wrangler d1 migrations apply DB --local --persist-to "$DATA_DIR" --config wrangler.jsonc < /dev/null

set -- dev --config wrangler.jsonc --local \
  --ip 0.0.0.0 --port "$PORT" \
  --persist-to "$DATA_DIR" \
  --compatibility-date 2026-05-22 \
  --show-interactive-dev-session=false

if [ -n "$REGISTRATION_OPEN" ]; then set -- "$@" --var "REGISTRATION_OPEN:$REGISTRATION_OPEN"; fi
if [ -n "${STORAGE_LIMIT_MB:-}" ]; then set -- "$@" --var "STORAGE_LIMIT_MB:$STORAGE_LIMIT_MB"; fi
if [ -n "${OWNER_ACCOUNT_ID:-}" ]; then set -- "$@" --var "OWNER_ACCOUNT_ID:$OWNER_ACCOUNT_ID"; fi
if [ -n "${MFA_ENCRYPTION_KEY:-}" ]; then set -- "$@" --var "MFA_ENCRYPTION_KEY:$MFA_ENCRYPTION_KEY"; fi

echo "Starting Fretlark on http://0.0.0.0:$PORT (data in $DATA_DIR)"
exec npx --no-install wrangler "$@"
