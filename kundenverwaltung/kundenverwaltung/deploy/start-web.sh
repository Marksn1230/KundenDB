#!/bin/sh
set -eu
. /app/deploy/domain-env.sh
export OIDC_ISSUER="$APP_URL/auth/realms/kundenraum"
exec node node_modules/next/dist/bin/next start --hostname 0.0.0.0
