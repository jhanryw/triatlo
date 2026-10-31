#!/usr/bin/env bash
# READ-ONLY inventory, run in a terminal of the SERVER HOST (SSH) where Docker runs. It changes nothing: no stop, no restart,
# no remove. It answers: which Supabase-like stacks exist, which one is Triatlo's NEW stack, which container is its
# PostgreSQL, which ports are published to the host, and whether anything exposes PostgreSQL.
#
#   bash server-preflight.sh
set -u
command -v docker >/dev/null 2>&1 || { echo "docker not found: run this on the server host (SSH), not inside a container" >&2; exit 2; }

fmt='{{.Names}}|{{.Image}}|{{.Status}}'
label() { docker inspect --format "{{index .Config.Labels \"$2\"}}" "$1" 2>/dev/null; }

echo "== Containers that look like Supabase / its gateway / Postgres (name | image | status | compose project | service)"
docker ps -a --format "$fmt" | grep -iE 'supabase|postgres|kong|envoy|gotrue|storage-api|postgrest|supavisor' | while IFS='|' read -r name image status; do
  printf "%s | %s | %s | project=%s | service=%s\n" "$name" "$image" "$status" "$(label "$name" com.docker.compose.project)" "$(label "$name" com.docker.compose.service)"
done

echo
echo "== Gateway family per stack (Kong = EasyPanel template / old stack; Envoy = the stack in this repository)"
docker ps -a --format '{{.Names}}|{{.Image}}' | grep -iE 'kong|envoy' | while IFS='|' read -r name image; do
  printf "%s | %s | project=%s\n" "$name" "$image" "$(label "$name" com.docker.compose.project)"
done

echo
echo "== NEW Triatlo stack: projects that contain a 'backup' service built from the supabase/postgres image"
found=0
for backup in $(docker ps -a --format '{{.Names}}'); do
  [ "$(label "$backup" com.docker.compose.service)" = "backup" ] || continue
  project="$(label "$backup" com.docker.compose.project)"
  db="$(docker ps -a --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=db" --format '{{.Names}}' | head -n1)"
  [ -n "$db" ] || continue
  found=1
  echo "project   : $project"
  echo "db        : $db   (status: $(docker inspect --format '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$db"))"
  echo "backup/ops: $backup"
  echo "gateway   : $(docker ps -a --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=api-gw" --format '{{.Names}} ({{.Image}})' | head -n1)"
  echo "volumes   :"; docker inspect --format '{{range .Mounts}}   {{.Type}} {{.Name}} -> {{.Destination}}{{"\n"}}{{end}}' "$db" | grep -E 'volume|bind' | grep -E 'postgresql/data|etc/postgresql-custom' 
  echo "pg_isready: $(docker exec "$db" pg_isready -U postgres -h localhost 2>&1)"
  echo
done
[ "$found" = 1 ] || echo "(none found yet: the new Compose stack has not been deployed)"

echo "== Published host ports of ALL running containers (anything with 5432 / 6543 / 8000 is a red flag for Supabase)"
docker ps --format '{{.Names}} -> {{.Ports}}' | grep -E '0\.0\.0\.0:|:::' | grep -E '5432|6543|8000|8443' || echo "none of 5432/6543/8000/8443 is published to the host"
