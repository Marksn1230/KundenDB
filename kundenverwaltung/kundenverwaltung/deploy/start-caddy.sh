#!/bin/sh
set -eu
. /etc/caddy/domain-env.sh
if [ "${HTTPS_ENABLED:-true}" = true ]; then
 : "${ACME_EMAIL:?ACME_EMAIL für Let’s Encrypt setzen}"
 configuration=/etc/caddy/Caddyfile
else
 configuration=/etc/caddy/Caddyfile.http
fi
if [ "${1:-}" = --validate ]; then
 exec caddy validate --config "$configuration" --adapter caddyfile
fi
exec caddy run --config "$configuration" --adapter caddyfile
