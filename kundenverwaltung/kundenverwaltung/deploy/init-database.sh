#!/bin/sh
set -eu
psql --no-psqlrc --username "$POSTGRES_USER" --dbname postgres --set ON_ERROR_STOP=on <<'EOSQL'
\getenv app_user APP_DB_USER
\getenv app_name APP_DB_NAME
\getenv app_password APP_DB_PASSWORD
CREATE ROLE :"app_user" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'app_password';
CREATE DATABASE :"app_name" OWNER :"app_user";
EOSQL
