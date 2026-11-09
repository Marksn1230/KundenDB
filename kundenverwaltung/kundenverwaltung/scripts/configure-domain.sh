#!/usr/bin/env bash
set -Eeuo pipefail
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"
unset APP_DOMAIN HTTPS_ENABLED ACME_EMAIL ACME_ENV APP_URL OIDC_ISSUER PUBLIC_DOMAIN TLS_EMAIL SERVER_PUBLIC_IPS
node_tool() {
 if command -v node >/dev/null 2>&1 && node -e 'process.exit(Number(process.versions.node.split(".")[0])>=18?0:1)' >/dev/null 2>&1; then
  node scripts/configure-domain.mjs "$@"
 else
  docker run --rm -i --network host --user "$(id -u):$(id -g)" --mount "type=bind,source=$PROJECT_DIR,target=/work" --workdir /work node:26.13.0-bookworm-slim node scripts/configure-domain.mjs "$@"
 fi
}
if [[ "${1:-}" == --status ]]; then node_tool --status; exit $?; fi
command -v docker >/dev/null || { echo "Docker mit Compose-Plugin fehlt."; exit 1; }
docker compose version >/dev/null
docker info --format '{{.ServerVersion}}' >/dev/null || { echo "Docker-Engine nicht erreichbar. Keine Konfiguration geändert."; exit 1; }
if node_tool "$@"; then
 trap 'echo "Einrichtung nicht abgeschlossen. Proxy-Logs: sudo docker compose -f compose.server.yml logs --tail=100 caddy"; node_tool --rollback-hint || true' ERR
 docker compose -f compose.server.yml config --quiet
 docker compose -f compose.server.yml run --rm --no-deps caddy --validate
 docker compose -f compose.server.yml up -d --no-deps --force-recreate keycloak
 docker compose -f compose.server.yml run --rm --no-deps identity-config
 docker compose -f compose.server.yml up -d --no-deps --force-recreate web caddy
 node_tool --status
else
 result=$?
 if [[ $result == 2 ]]; then exit 0; fi
 exit "$result"
fi
