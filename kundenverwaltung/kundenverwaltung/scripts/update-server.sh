#!/usr/bin/env bash
# Execute with bash; never source this file into the interactive SSH shell.
if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  printf 'Bitte mit bash ausführen, nicht mit source.\n' >&2
  return 2
fi
set -Eeuo pipefail
umask 077
export GIT_TERMINAL_PROMPT=0
export GCM_INTERACTIVE=Never
export COMPOSE_INTERACTIVE_NO_CLI=1

ACTION="${1:-status}"
if (( $# )); then shift; fi
APP_DIR="$PWD"
REQUESTED_PROJECT=''
REMOTE=''
MIN_FREE_MB=2048
while (( $# )); do
  case "$1" in
    --app-dir) APP_DIR="${2:?Anwendungsordner fehlt}"; shift 2 ;;
    --project) REQUESTED_PROJECT="${2:?Projektname fehlt}"; shift 2 ;;
    --remote) REMOTE="${2:?Remote fehlt}"; shift 2 ;;
    --min-free-mb) MIN_FREE_MB="${2:?Speichergrenze fehlt}"; shift 2 ;;
    *) printf 'Unbekannte Option: %s\n' "$1" >&2; exit 2 ;;
  esac
done
APP_DIR="$(cd "$APP_DIR" && pwd -P)"
RUNTIME="$APP_DIR/.runtime/server-update"
STATE=''
LOCKED=0
PHASE='preflight'
DOCKER=(docker)
GIT=(git)
if [[ "$EUID" == 0 && -n "${SUDO_USER:-}" && "$SUDO_USER" != root ]]; then GIT=(sudo -H -u "$SUDO_USER" -- git); fi
COMPOSE_FILES=()
PROJECT=''

message() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
fail() { printf 'FEHLER: %s\n' "$*" >&2; return 1; }
put() { printf '%s\n' "$2" > "$STATE/$1.tmp"; mv "$STATE/$1.tmp" "$STATE/$1"; }
read_state() {
  [[ -s "$RUNTIME/current" ]] || { fail 'Noch kein gespeicherter Update-Lauf vorhanden.'; return 1; }
  STATE="$(cat "$RUNTIME/current")"
  [[ "$STATE" == "$APP_DIR/backups/server-update-"* && -d "$STATE" ]] || { fail 'Ungültiger gespeicherter Sicherungspfad.'; return 1; }
  [[ "$(cat "$STATE/app-dir")" == "$APP_DIR" ]] || { fail 'Der Update-Lauf gehört zu einem anderen Anwendungsordner.'; return 1; }
}
status() {
  if [[ ! -s "$RUNTIME/current" ]]; then
    message 'Noch kein Update-Lauf gespeichert.'
    if [[ -f "$RUNTIME/last-attempt.log" ]]; then tail -n 35 "$RUNTIME/last-attempt.log"; fi
    return 0
  fi
  read_state
  printf 'Sicherung/Protokoll: %s\nProjekt: %s\nStatus: %s\nSchritt: %s\n' "$STATE" "$(cat "$STATE/project")" "$(cat "$STATE/status")" "$(cat "$STATE/phase")"
  if [[ -s "$RUNTIME/lock/pid" ]] && kill -0 "$(cat "$RUNTIME/lock/pid")" 2>/dev/null; then
    printf 'Update-Prozess läuft noch.\n'
  fi
  tail -n 35 "$STATE/update.log" 2>/dev/null || true
}
compose_cmd() {
  local args=(compose --project-directory "$APP_DIR" --env-file "$APP_DIR/.env" -p "$PROJECT") file
  for file in "${COMPOSE_FILES[@]}"; do args+=(-f "$file"); done
  "${DOCKER[@]}" "${args[@]}" "$@"
}
docker_access() {
  command -v docker >/dev/null || { fail 'docker ist nicht im PATH. Dieses Skript installiert oder deinstalliert Docker nicht.'; return 1; }
  if docker info >/dev/null 2>&1; then DOCKER=(docker)
  elif command -v sudo >/dev/null && sudo -n docker info >/dev/null 2>&1; then DOCKER=(sudo -n docker)
  else fail 'Docker-Dienst oder Rechte fehlen. In der SSH-Sitzung sudo -v ausführen; danach erneut prüfen/fortsetzen.'; return 1
  fi
  "${DOCKER[@]}" compose version
}
discover_project() {
  local id workdir name files matches=() ids
  ids="$("${DOCKER[@]}" ps -a --filter label=com.docker.compose.service=web --format '{{.ID}}')"
  while IFS= read -r id; do
    [[ -n "$id" ]] || continue
    workdir="$("${DOCKER[@]}" inspect --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' "$id")"
    [[ "$workdir" == "$APP_DIR" ]] || continue
    name="$("${DOCKER[@]}" inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$id")"
    [[ -z "$REQUESTED_PROJECT" || "$name" == "$REQUESTED_PROJECT" ]] || continue
    matches+=("$id")
  done <<< "$ids"
  [[ ${#matches[@]} == 1 ]] || { fail "Laufendes Compose-Projekt nicht eindeutig gefunden. Erwarteter Ordner: $APP_DIR; letzter Web-Ordner: ${workdir:-unbekannt}. Richtigen Ordner und gegebenenfalls --project angeben."; return 1; }
  WEB_CONTAINER="${matches[0]}"
  [[ "$("${DOCKER[@]}" inspect --format '{{.State.Running}}' "$WEB_CONTAINER")" == true ]] || { fail 'Die bisherige Webanwendung läuft nicht. Erst den alten Stand/Snapshot wieder betriebsbereit machen; bei gespeichertem Update resume verwenden.'; return 1; }
  PROJECT="$("${DOCKER[@]}" inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$WEB_CONTAINER")"
  files="$("${DOCKER[@]}" inspect --format '{{ index .Config.Labels "com.docker.compose.project.config_files" }}' "$WEB_CONTAINER")"
  IFS=',' read -r -a COMPOSE_FILES <<< "$files"
  [[ "${COMPOSE_FILES[0]}" == "$APP_DIR/compose.server.yml" ]] || { fail 'Erste Compose-Datei muss die bestehende compose.server.yml sein.'; return 1; }
  for files in "${COMPOSE_FILES[@]}"; do [[ -f "$files" ]] || { fail 'Eine bisher verwendete Compose-Datei fehlt.'; return 1; }; done
  compose_cmd config --quiet
  message "Vorhandenes Compose-Projekt: $PROJECT; bisherige Compose-Dateien werden beibehalten."
}
load_project() {
  PROJECT="$(cat "$STATE/project")"
  mapfile -t COMPOSE_FILES < "$STATE/compose-files"
  REMOTE="$(cat "$STATE/remote")"
}
check_environment() {
  [[ -f "$APP_DIR/compose.server.yml" && -f "$APP_DIR/.env" ]] || { fail 'compose.server.yml oder bestehende .env fehlt.'; return 1; }
  [[ "$MIN_FREE_MB" =~ ^[0-9]+$ ]] || { fail 'Ungültige Speichergrenze.'; return 1; }
  local free_kb
  free_kb="$(df -Pk "$APP_DIR" | awk 'NR==2 {print $4}')"
  [[ "$free_kb" =~ ^[0-9]+$ && "$free_kb" -ge $(( MIN_FREE_MB * 1024 )) ]] || { fail "Weniger als $MIN_FREE_MB MiB freier Speicher. Vor dem Update Platz schaffen; keine automatische Bereinigung."; return 1; }
  for tool in git gzip tar sha256sum tee; do command -v "$tool" >/dev/null || { fail "Benötigter Befehl fehlt: $tool"; return 1; }; done
  docker_access
}
check_source() {
  REPO="$("${GIT[@]}" -C "$APP_DIR" rev-parse --show-toplevel)"
  local relative
  relative="$("${GIT[@]}" -C "$APP_DIR" rev-parse --show-prefix)"
  [[ -z "$("${GIT[@]}" -C "$REPO" status --porcelain --untracked-files=normal -- . ":(exclude)${relative}deploy/mfa-allowlist.caddy")" ]] || { fail 'Lokale Quellcodeänderungen vorhanden. Sie werden nicht überschrieben.'; return 1; }
  [[ "$("${GIT[@]}" -C "$REPO" branch --show-current)" == master ]] || { fail 'Bitte zuerst den vorgesehenen Branch master auswählen.'; return 1; }
  if [[ -z "$REMOTE" ]]; then
    if "${GIT[@]}" -C "$REPO" remote get-url origin >/dev/null 2>&1; then REMOTE=origin; else REMOTE=orgin; fi
  fi
  TARGET="$("${GIT[@]}" -C "$REPO" rev-parse "refs/remotes/$REMOTE/master")"
  BEFORE="$("${GIT[@]}" -C "$REPO" rev-parse HEAD)"
  "${GIT[@]}" -C "$REPO" merge-base --is-ancestor "$BEFORE" "$TARGET" || { fail 'Lokaler Branch weicht ab. Kein automatischer Merge/Reset.'; return 1; }
  message "Vorher: $BEFORE; bereits abgerufenes Ziel: $TARGET"
}
cleanup() {
  if [[ "$LOCKED" == 1 ]]; then rm -f "$RUNTIME/lock/pid"; rmdir "$RUNTIME/lock" 2>/dev/null || true; fi
}
error_handler() {
  local code="$1" line="$2"
  trap - ERR
  if [[ -n "$STATE" && -d "$STATE" ]]; then
    put status failed
    put error "Exit $code, Schritt $PHASE, Skriptzeile $line"
  fi
  message "FEHLER: Schritt $PHASE, Exit $code, Zeile $line. Der SSH-Elternprozess bleibt unberührt."
  message 'Fortschritt und Sicherungen bleiben erhalten. Keine automatische Datenbankrücksicherung und keine Docker-Deinstallation.'
  message 'Nach Behebung: sudo bash .runtime/update-runner.sh status bzw. resume im Anwendungsordner.'
  exit "$code"
}
phase() {
  local name="$1" action="$2"
  if [[ -f "$STATE/$name.done" ]]; then message "Bereits abgeschlossen: $name"; return; fi
  PHASE="$name"; put phase "$name"; message "START: $name"
  "$action"
  printf 'ok\n' > "$STATE/$name.done"
  message "OK: $name"
}
snapshot() {
  local id tag
  cp -p "$APP_DIR/.env" "$STATE/server.env"
  if [[ -f "$APP_DIR/deploy/mfa-allowlist.caddy" ]]; then cp "$APP_DIR/deploy/mfa-allowlist.caddy" "$STATE/legacy-mfa-allowlist.caddy"; fi
  sha256sum "$APP_DIR/.env" | awk '{print $1}' > "$STATE/env-sha256"
  cp "$APP_DIR/compose.server.yml" "$STATE/compose-before.yml"
  "${GIT[@]}" -C "$(cat "$STATE/repo")" archive --format=tar "$(cat "$STATE/before")" > "$STATE/source-before.tar"
  id="$("${DOCKER[@]}" inspect --format '{{.Image}}' "$(cat "$STATE/web-container")")"
  "${DOCKER[@]}" inspect --format '{{.Config.Image}}' "$(cat "$STATE/web-container")" > "$STATE/original-image"
  tag="kundenraum:rollback-$(basename "$STATE")"
  "${DOCKER[@]}" image tag "$id" "$tag"
  put rollback-image "$tag"
  "${DOCKER[@]}" image save "$tag" | gzip > "$STATE/application-image.tar.gz.partial"
  gzip -t "$STATE/application-image.tar.gz.partial"
  mv "$STATE/application-image.tar.gz.partial" "$STATE/application-image.tar.gz"
}
source_update() {
  local repo current
  repo="$(cat "$STATE/repo")"; current="$("${GIT[@]}" -C "$repo" rev-parse HEAD)"
  [[ "$current" == "$(cat "$STATE/before")" || "$current" == "$(cat "$STATE/target")" ]] || { fail 'Quellstand wurde während des Updates verändert.'; return 1; }
  # Public tracked source/bind mounts must stay readable; backups retain umask 077.
  (umask 022; "${GIT[@]}" -C "$repo" merge --ff-only "$(cat "$STATE/target")")
  cmp "$APP_DIR/.env" "$STATE/server.env"
  compose_cmd config --quiet
}
build_image() { compose_cmd build web; }
stop_writers() { compose_cmd stop caddy web worker keycloak security-controller; }
backup_databases() {
  local service database
  # Stop again on a retry; never combine dumps made while writers ran.
  stop_writers
  for service in db identity-db; do
    database="$(compose_cmd exec -T "$service" printenv APP_DB_NAME | tr -d '\r')"
    [[ "$database" =~ ^[a-zA-Z0-9_-]+$ ]] || { fail 'Datenbankname nicht eindeutig.'; return 1; }
    put "$service-name" "$database"
    compose_cmd exec -T "$service" pg_dump -U postgres -d "$database" -Fc > "$STATE/$service.dump.partial"
    test -s "$STATE/$service.dump.partial"
    compose_cmd exec -T "$service" pg_restore --list < "$STATE/$service.dump.partial" > "$STATE/$service.contents"
    test -s "$STATE/$service.contents"
  done
  compose_cmd exec -T db psql -U postgres -d "$(cat "$STATE/db-name")" -At -v ON_ERROR_STOP=1 -c 'SELECT COUNT(*) FROM customers; SELECT COUNT(*) FROM periods;' > "$STATE/counts-before"
  for service in db identity-db; do mv "$STATE/$service.dump.partial" "$STATE/$service.dump"; done
  (cd "$STATE" && sha256sum db.dump identity-db.dump > dumps.sha256)
}
start_databases() { compose_cmd up -d --wait --wait-timeout 180 db identity-db restore-db keycloak security-controller; }
migrate_database() { compose_cmd run --rm -T migrate; }
sync_identity() { compose_cmd run --rm -T identity-policy; }
verify_counts() {
  compose_cmd exec -T db psql -U postgres -d "$(cat "$STATE/db-name")" -At -v ON_ERROR_STOP=1 -c 'SELECT COUNT(*) FROM customers; SELECT COUNT(*) FROM periods;' > "$STATE/counts-after"
  cmp "$STATE/counts-before" "$STATE/counts-after"
  (cd "$STATE" && sha256sum -c dumps.sha256)
}
activate() { compose_cmd up -d --wait --wait-timeout 240 --force-recreate web worker caddy; }
verify_health() {
  compose_cmd exec -T web node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(async r=>{console.log(r.status,await r.text());process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
  compose_cmd ps
}
main() {
  case "$ACTION" in status) status; return ;; logs) read_state; load_project; docker_access; compose_cmd ps -a; compose_cmd logs --no-color --tail=60; return ;; check|run|resume) ;; *) fail 'Verwendung: run | check | status | logs | resume [--app-dir ORDNER] [--project NAME] [--remote NAME]'; return 2 ;; esac
  mkdir -p "$RUNTIME"; chmod 700 "$RUNTIME"
  if ! mkdir "$RUNTIME/lock" 2>/dev/null; then
    if [[ -s "$RUNTIME/lock/pid" ]] && kill -0 "$(cat "$RUNTIME/lock/pid")" 2>/dev/null; then fail 'Ein Update-Prozess läuft bereits. status aufrufen.'; return 1; fi
    rm -f "$RUNTIME/lock/pid"; rmdir "$RUNTIME/lock"
    mkdir "$RUNTIME/lock"
  fi
  LOCKED=1; printf '%s\n' "$$" > "$RUNTIME/lock/pid"
  trap cleanup EXIT
  trap 'error_handler "$?" "$LINENO"' ERR
  trap 'error_handler 130 "$LINENO"' INT
  trap 'error_handler 143 "$LINENO"' TERM
  exec > >(tee -a "$RUNTIME/last-attempt.log") 2>&1
  check_environment
  if [[ "$ACTION" == check ]]; then discover_project; check_source; message 'Vorprüfung erfolgreich; keine Dienste gestoppt und keine Datenbank geändert.'; return; fi
  if [[ "$ACTION" == resume ]]; then
    read_state; load_project
    if [[ "$(cat "$STATE/status")" == complete ]]; then message 'Update bereits vollständig abgeschlossen.'; return; fi
    message 'Gespeicherten Lauf fortsetzen; abgeschlossene Sicherungen werden nicht überschrieben.'
  else
    if [[ -s "$RUNTIME/current" ]]; then
      read_state
      [[ "$(cat "$STATE/status")" == complete ]] || { fail 'Es gibt einen unvollständigen Lauf. status/resume statt run verwenden.'; return 1; }
      STATE=''
    fi
    discover_project; check_source
    STATE="$APP_DIR/backups/server-update-$(date -u +%Y%m%dT%H%M%SZ)-$$"
    mkdir -p "$STATE"; chmod 700 "$STATE"
    put app-dir "$APP_DIR"; put repo "$REPO"; put before "$BEFORE"; put target "$TARGET"
    put project "$PROJECT"; put remote "$REMOTE"; put web-container "$WEB_CONTAINER"
    printf '%s\n' "${COMPOSE_FILES[@]}" > "$STATE/compose-files"
    put phase initialized; put status running
    printf '%s\n' "$STATE" > "$RUNTIME/current.tmp"; mv "$RUNTIME/current.tmp" "$RUNTIME/current"
  fi
  exec > >(tee -a "$STATE/update.log") 2>&1
  put status running
  message "Sicherung/Protokoll: $STATE"
  phase 01-snapshot snapshot
  phase 02-source source_update
  phase 03-build build_image
  phase 04-stop stop_writers
  phase 05-backups backup_databases
  phase 06-databases start_databases
  phase 07-migration migrate_database
  phase 08-keycloak sync_identity
  phase 09-counts verify_counts
  phase 10-activate activate
  phase 11-health verify_health
  put status complete; put phase complete
  message 'UPDATE ERFOLGREICH. Vorhandene Daten erhalten. Bitte frisch im Browser anmelden.'
}
main
