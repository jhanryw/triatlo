#!/bin/bash
# Triatlo Inteligente — scheduled logical backup for the self-hosted Supabase stack.
#
# Runs inside the `backup` sidecar (same image as the database, so pg_dump matches the server version).
# Every run writes, to $BACKUP_DIR (volume db-backups):
#   triatlo-db-<UTC timestamp>.dump            pg_dump custom format of database $PGDATABASE (all schemas)
#   triatlo-globals-<UTC timestamp>.sql        roles (pg_dumpall --globals-only)  -- contains password hashes
#   triatlo-storage-<UTC timestamp>.tar.gz     Storage files (private meal photos)
#   *.sha256                                   checksums
# Optional: BACKUP_ENCRYPTION_PASSPHRASE encrypts each artifact (AES-256-CBC, PBKDF2) and removes the plaintext.
# This script never deletes anything except artifacts older than BACKUP_RETENTION_DAYS inside $BACKUP_DIR.
#
# Copying $BACKUP_DIR OFF the server is a separate required step (see docs/SUPABASE_EASYPANEL.md §7).
set -uo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_HOUR_UTC="${BACKUP_HOUR_UTC:-6}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
BACKUP_ON_START="${BACKUP_ON_START:-true}"
STORAGE_DIR="${STORAGE_DIR:-/var/lib/storage}"
PASSPHRASE="${BACKUP_ENCRYPTION_PASSPHRASE:-}"

log() { printf '{"time":"%s","service":"backup","message":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

encrypt_if_needed() {
  local file="$1"
  [ -z "$PASSPHRASE" ] && return 0
  if ! command -v openssl >/dev/null 2>&1; then
    log "ERROR: BACKUP_ENCRYPTION_PASSPHRASE is set but openssl is not available; keeping NO plaintext copy is impossible, failing"
    return 1
  fi
  openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_ENCRYPTION_PASSPHRASE -in "$file" -out "$file.enc" \
    && rm -f "$file" && sha256sum "$file.enc" > "$file.enc.sha256"
}

run_backup() {
  local ts out
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$BACKUP_DIR"
  out="$BACKUP_DIR"

  log "starting backup $ts"

  # 1) database
  if ! pg_dump --format=custom --file="$out/triatlo-db-$ts.dump"; then
    log "ERROR: pg_dump failed"; rm -f "$out/triatlo-db-$ts.dump"; echo "failed $ts" > "$out/LAST_STATUS"; return 1
  fi
  # the archive must be readable by pg_restore
  if ! pg_restore --list "$out/triatlo-db-$ts.dump" > /dev/null; then
    log "ERROR: dump verification failed"; echo "failed $ts" > "$out/LAST_STATUS"; return 1
  fi
  sha256sum "$out/triatlo-db-$ts.dump" > "$out/triatlo-db-$ts.dump.sha256"

  # 2) roles
  if ! pg_dumpall --globals-only --file="$out/triatlo-globals-$ts.sql"; then
    log "ERROR: pg_dumpall --globals-only failed"; echo "failed $ts" > "$out/LAST_STATUS"; return 1
  fi
  chmod 600 "$out/triatlo-globals-$ts.sql"

  # 3) storage files (private photos)
  if [ -d "$STORAGE_DIR" ]; then
    if ! tar -C "$STORAGE_DIR" -czf "$out/triatlo-storage-$ts.tar.gz" .; then
      log "ERROR: storage archive failed"; echo "failed $ts" > "$out/LAST_STATUS"; return 1
    fi
    sha256sum "$out/triatlo-storage-$ts.tar.gz" > "$out/triatlo-storage-$ts.tar.gz.sha256"
  fi

  # 4) optional encryption (plaintext removed on success)
  for f in "$out/triatlo-db-$ts.dump" "$out/triatlo-globals-$ts.sql" "$out/triatlo-storage-$ts.tar.gz"; do
    [ -f "$f" ] && { encrypt_if_needed "$f" || { echo "failed $ts" > "$out/LAST_STATUS"; return 1; }; }
  done
  chmod 600 "$out"/triatlo-*-"$ts"* 2>/dev/null || true

  # 5) retention (only our own artifacts)
  find "$out" -maxdepth 1 -name 'triatlo-*' -type f -mtime +"$BACKUP_RETENTION_DAYS" -delete

  echo "ok $ts" > "$out/LAST_STATUS"
  log "backup $ts finished: $(ls -1 "$out" | grep -c "$ts") files, $(du -sh "$out" | cut -f1) total in $out"
}

seconds_until_next_run() {
  local now target
  now=$(date -u +%s)
  target=$(date -u -d "today ${BACKUP_HOUR_UTC}:00:00" +%s)
  [ "$target" -le "$now" ] && target=$((target + 86400))
  echo $((target - now))
}

log "backup sidecar started (daily at ${BACKUP_HOUR_UTC}:00 UTC, retention ${BACKUP_RETENTION_DAYS} days, encryption: $([ -n "$PASSPHRASE" ] && echo on || echo off))"
if [ "$BACKUP_ON_START" = "true" ]; then
  sleep 60   # let the database finish its first-boot initialization
  run_backup || log "first backup failed (will retry at the next schedule)"
fi
while true; do
  wait_s="$(seconds_until_next_run)"
  log "next backup in ${wait_s}s"
  sleep "$wait_s"
  run_backup || log "scheduled backup failed"
done
