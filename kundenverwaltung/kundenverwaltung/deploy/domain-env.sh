#!/bin/sh
set -eu
: "${APP_DOMAIN:?APP_DOMAIN setzen}"
case "$APP_DOMAIN" in *[!A-Za-z0-9.-]*|.*|*.) echo "APP_DOMAIN muss ein DNS-Hostname ohne Schema oder Pfad sein." >&2; exit 1;; esac
case "${HTTPS_ENABLED:-true}" in true) APP_URL="https://$APP_DOMAIN";; false) APP_URL="http://$APP_DOMAIN";; *) echo "HTTPS_ENABLED muss true oder false sein." >&2; exit 1;; esac
case "${ACME_ENV:-production}" in
 production) ACME_DIRECTORY=https://acme-v02.api.letsencrypt.org/directory;;
 staging) ACME_DIRECTORY=https://acme-staging-v02.api.letsencrypt.org/directory;;
 *) echo "ACME_ENV muss production oder staging sein." >&2; exit 1;;
esac
ACME_EMAIL="${ACME_EMAIL:-${TLS_EMAIL:-}}"
export APP_URL ACME_EMAIL ACME_DIRECTORY
