# Kundenraum: vollständige Installation auf einem neuen Server

Ziel: vom frischen Linux-Server bis zur persönlichen Anmeldung unter einer eigenen HTTPS-Domain. Diese Anleitung gilt für **Ubuntu Server 24.04 LTS, amd64**, Bash und einen persönlichen Benutzer mit sudo-Rechten. Andere Distributionen sind hier nicht abgenommen. Empfohlen: 2 CPU-Kerne, 4 GiB RAM und mindestens 20 GiB freier Speicher für Images, Build und Daten.

Repository: **https://github.com/Marksn1230/KundenDB**. Die Anwendung befindet sich unter **kundenverwaltung/kundenverwaltung**. Ausschließlich deren **compose.server.yml** verwenden; die weiteren Starterprojekte und docker-compose.yml sind nicht diese Serverinstallation.

Befehle der Reihe nach in Bash ausführen und bei Fehlern anhalten. Beispieldomain kunden.example.at, E-Mail und IP durch eigene Werte ersetzen. example.at und 203.0.113.10 sind Beispiele. Alle Compose-Befehle laufen im inneren Projektverzeichnis, auch nach einer neuen SSH-Anmeldung.

## 1. Server vorbereiten

~~~bash
set -euo pipefail
. /etc/os-release
test "$ID" = ubuntu
test "$VERSION_ID" = 24.04
dpkg --print-architecture
sudo apt-get update
sudo apt-get upgrade -y
sudo apt-get install -y git openssh-client ca-certificates curl \
  dnsutils openssl ufw nano netcat-openbsd
sudo timedatectl set-ntp true
timedatectl status
~~~

Erwartet: amd64 und synchronisierte Uhrzeit. Bei angefordertem Betriebssystem-Neustart neu starten und erneut per SSH anmelden. Die Anwendung plant unabhängig von der Hostzeitzone in Europe/Vienna.

### Docker Engine und Compose-Plugin installieren

Auf dem frischen Server das offizielle Docker-APT-Repository verwenden. Bei bereits vorinstallierten Docker-Paketen deren Konflikte zuerst nach der [Docker-Anleitung](https://docs.docker.com/engine/install/ubuntu/) klären.

~~~bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker run --rm hello-world
sudo docker compose version
sudo docker info --format '{{.ServerVersion}}'
~~~

Erwartet: erfolgreicher Hello-world-Test, Compose- und Docker-Serverversion ohne Verbindungsfehler. Docker wird hier mit sudo bedient; eine Mitgliedschaft in der praktisch root-berechtigten Docker-Gruppe ist nicht nötig. Node.js und PostgreSQL werden nicht auf dem Host installiert.

### Firewall und gegebenenfalls Portweiterleitung

SSH_PORT an den tatsächlichen SSH-Port anpassen. SSH vor Aktivierung der Firewall freigeben, die aktuelle Verbindung offen halten und anschließend eine zweite Anmeldung testen.

~~~bash
SSH_PORT=22
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow "$SSH_PORT/tcp"
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
sudo ss -ltnp
~~~

Zusätzlich in der Provider-/Cloud-Firewall **TCP 80 und 443** erlauben; SSH möglichst auf Verwaltungsadressen beschränken. Hinter NAT am Router **öffentlicher TCP-Port 80 → Server:80 und 443 → Server:443** weiterleiten. Hinter CGNAT wird eine öffentlich erreichbare Adresse oder eine separate Netzwerklösung benötigt. IPv6-Firewall bei AAAA ebenfalls berücksichtigen.

Docker veröffentlichte Ports können UFW umgehen. compose.server.yml veröffentlicht deshalb nur Caddy auf 80/443. **5432, 8080 und 3000 nicht veröffentlichen.** Ausgehend müssen insbesondere DNS, HTTPS zu GitHub/Registries/ACME und Zeitsynchronisierung funktionieren.

## 2. Projekt direkt von GitHub beziehen

### Öffentliches Repository per HTTPS

~~~bash
sudo install -d -m 0750 -o "$USER" -g "$(id -gn)" /opt/kundenraum
git clone https://github.com/Marksn1230/KundenDB.git /opt/kundenraum
cd /opt/kundenraum
git remote -v
git branch -a
git tag --list --sort=-version:refname
~~~

### Privates Repository: stattdessen SSH-Deploy-Key

Diesen Weg **anstelle** des HTTPS-Clones wählen. Der Key darf nur dieses Repository lesen.

~~~bash
install -d -m 0700 "$HOME/.ssh"
ssh-keygen -t ed25519 -f "$HOME/.ssh/kundenraum_deploy" \
  -C kundenraum-server-readonly -N ''
chmod 600 "$HOME/.ssh/kundenraum_deploy"
cat "$HOME/.ssh/kundenraum_deploy.pub"
~~~

Den **öffentlichen** Schlüssel unter GitHub → KundenDB → Settings → Deploy keys → Add deploy key eintragen. **Allow write access nicht aktivieren.** Der private Schlüssel bleibt auf dem Server. Beim ersten SSH-Zugriff den Host-Fingerprint mit den [GitHub-Fingerprints](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints) vergleichen; die Hostprüfung nicht abschalten.

~~~bash
sudo install -d -m 0750 -o "$USER" -g "$(id -gn)" /opt/kundenraum
GIT_SSH_COMMAND="ssh -i $HOME/.ssh/kundenraum_deploy -o IdentitiesOnly=yes" \
  git clone git@github.com:Marksn1230/KundenDB.git /opt/kundenraum
cd /opt/kundenraum
git config core.sshCommand "ssh -i $HOME/.ssh/kundenraum_deploy -o IdentitiesOnly=yes"
git ls-remote origin HEAD
~~~

Ein frischer Clone verwendet **origin** als Remotenamen. Der ursprüngliche Entwickler-Workspace verwendet teilweise orgin; das gilt nicht für diesen neuen Clone. [GitHub Deploy Keys](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys)

### Branch oder Release auswählen

Der geprüfte Quellstand liegt auf **master**:

~~~bash
cd /opt/kundenraum
git fetch origin --tags
git switch master
git pull --ff-only origin master
git rev-parse HEAD
cd /opt/kundenraum/kundenverwaltung/kundenverwaltung
test -f compose.server.yml
test -f deploy/.env.example
~~~

Alternativ einen **tatsächlich vorhandenen** Release-Tag wählen; ein bestimmter Tag wird nicht vorausgesetzt:

~~~bash
cd /opt/kundenraum
git tag --list --sort=-version:refname
read -r -p 'Vorhandener Release-Tag: ' RELEASE_TAG
git switch --detach "refs/tags/$RELEASE_TAG"
cd /opt/kundenraum/kundenverwaltung/kundenverwaltung
~~~

Für einen anderen vorhandenen Branch git switch BRANCH und git pull --ff-only origin BRANCH verwenden. main und master müssen nicht denselben Funktionsstand enthalten. Der ausgewählte Stand muss die hier genannten Serverdateien enthalten.

### Images und GHCR

Im geprüften Repository ist **keine GHCR-Veröffentlichung konfiguriert**. Compose referenziert das lokal gebaute Image kundenraum mit APP_VERSION als Tag, keine veröffentlichte ghcr.io-Adresse. Daher unten **aus dem Clone bauen**. Eine GHCR-Anmeldung oder docker compose pull für das Anwendungsimage ist für diesen Stand kein vorgesehener Installationsweg.

Die Fremdimages von PostgreSQL, Keycloak und Caddy werden unten mit docker compose pull db identity-db keycloak caddy geladen. Dafür ist keine private Registry vorgesehen. Ein SSH-Deploy-Key authentifiziert Git-Zugriffe, keine Container-Registry.

## 3. Anwendung und Datenbank konfigurieren

Die allgemeine .env.example ist für lokale Entwicklung. Für den Server **deploy/.env.example** kopieren. Keine Datenbanken mit Platzhaltern starten.

~~~bash
cd /opt/kundenraum/kundenverwaltung/kundenverwaltung
umask 077
test ! -e .env
cp deploy/.env.example .env
chmod 600 .env
mkdir -p transfer backups
chmod 700 transfer backups
sudo docker run --rm --user "$(id -u):$(id -g)" \
  --mount "type=bind,source=$PWD,target=/work" --workdir /work \
  node:26.13.0-bookworm-slim \
  node scripts/setup-server.mjs \
  --domain kunden.example.at \
  --email admin@example.at \
  --admin-username mein.admin
nano .env
~~~

Das Skript ersetzt GENERIEREN durch individuelle kryptografische Zufallswerte, erzeugt die passende DATABASE_URL und gibt keine Passwörter aus. Eine fertig eingerichtete .env wird nicht überschrieben. Im Editor Domain, E-Mail und persönlichen Benutzernamen prüfen. Geheimnisse nicht in Git, Tickets oder Chat kopieren.

| Variable | Vorgabe |
|---|---|
| APP_DOMAIN | Eigener Hostname ohne Schema, Port oder Pfad |
| HTTPS_ENABLED | true für diesen Ablauf |
| ACME_EMAIL | Erreichbare Kontaktadresse für Let’s Encrypt |
| ACME_ENV | production; staging nur für gesonderte Ausstellungstests |
| SERVER_PUBLIC_IPS | Öffentliche IPv4 und gegebenenfalls IPv6, mit Komma getrennt; sonst fragt der Assistent |
| POSTGRES_ADMIN_PASSWORD / POSTGRES_PASSWORD | Unterschiedliche Geheimnisse für PostgreSQL-Superuser und eingeschränkte Kundenraum-Rolle |
| DATABASE_URL | postgresql://kundenraum:URL-KODIERTES-PASSWORT@db:5432/kundenraum; passend vom Setup erzeugt |
| KEYCLOAK_DB_ADMIN_PASSWORD / KEYCLOAK_DB_PASSWORD | Separate Geheimnisse für Identity-Datenbank und deren eingeschränkte Rolle |
| SESSION_ENCRYPTION_KEY | 32 zufällige Bytes als 64 Hexzeichen |
| OIDC_CLIENT_SECRET | Individuelles Geheimnis des Webclients |
| KEYCLOAK_ADMIN_USER / KEYCLOAK_ADMIN_PASSWORD | Interner IdP-Einrichtungs-/Wartungszugang; nicht der persönliche App-Login |
| INITIAL_ADMIN_USERNAME / INITIAL_ADMIN_PASSWORD | Erster persönlicher Administrator; temporäres Passwort, mindestens 15 Zeichen |
| APP_VERSION | Lokaler Image-Tag, Vorlage derzeit 0.4.0; wählt keinen Git-Release |
| WHATSAPP_* / TELEGRAM_* | Optional, zunächst leer lassen; Produktivversand standardmäßig aus |

APP_URL und OIDC_ISSUER werden beim Containerstart aus Domain und HTTPS-Auswahl berechnet. Keine widersprüchlichen localhost-URLs zusätzlich eintragen.

**Persistenz und internes Netz:**

- db speichert Kunden im Volume **kundenraum_customer-db-data**; kundenraum ist eine eingeschränkte Datenbankrolle.
- identity-db speichert Benutzer, Passwörter und MFA separat in **kundenraum_identity-db-data**.
- web und worker verwenden dieselbe DATABASE_URL mit **db:5432**, nicht localhost.
- keycloak verwendet **identity-db:5432/keycloak**; web spricht intern mit **keycloak:8080/auth**.
- Beide PostgreSQL-Dienste haben **keine Host-Portfreigabe** und bleiben im privaten Compose-Netz.
- Zertifikate und ACME-Konten bleiben in **kundenraum_caddy-data**, weitere Caddy-Konfiguration in **kundenraum_caddy-config**.

Die Volume-Namen gelten für das festgelegte Compose-Projekt kundenraum. deploy/init-database.sh legt Rollen/Datenbanken nur bei leeren Volumes an. Spätere .env-Änderungen rotieren keine vorhandenen Datenbankpasswörter: zuerst die Rolle kontrolliert ändern, dann die Konfiguration. Containerwechsel erhalten Volumes. **docker compose down -v löscht sie und gehört nicht zum Update.**

## 4. DNS einrichten und prüfen

Beim DNS-Anbieter für kunden.example.at in der Zone example.at:

| Typ | Name | Wert |
|---|---|---|
| A | kunden | Öffentliche IPv4 dieses Servers |
| AAAA | kunden | Nur falls verfügbar: tatsächlich erreichbare öffentliche IPv6 dieses Servers |

Alte/falsche AAAA-Einträge entfernen. Hinter NAT die öffentliche Router-IP verwenden. Für den Assistenten DNS-only ohne vorgeschalteten CDN-Proxy verwenden. Vorhandene CAA-Regeln müssen Let’s Encrypt erlauben.

~~~bash
DOMAIN=kunden.example.at
dig +short A "$DOMAIN"
dig +short AAAA "$DOMAIN"
dig @1.1.1.1 +short A "$DOMAIN"
dig @1.1.1.1 +short AAAA "$DOMAIN"
dig +short CAA "$DOMAIN"
~~~

Erwartet: öffentliche IP(s) laut Server-/Router-Anbieter. Ein leeres AAAA ist bei IPv4-only richtig. Private Adressen aus hostname -I sind kein Ersatz. DNS-Propagation abwarten. Fehlende/falsche A-/AAAA-Einträge lassen den Domain-Assistenten **vor Änderungen** abbrechen; richtiges DNS beweist noch keine offenen Ports.

## 5. Installation starten und ersten Administrator einrichten

Die Reihenfolge ist wesentlich: Datenbanken, Migration, Keycloak, persönliches Konto, Domain-Assistent, Worker.

~~~bash
set -euo pipefail
cd /opt/kundenraum/kundenverwaltung/kundenverwaltung
sudo docker compose -f compose.server.yml config --quiet
sudo docker compose -f compose.server.yml pull db identity-db keycloak caddy
sudo docker compose -f compose.server.yml build web
sudo docker compose -f compose.server.yml up -d --wait db identity-db
sudo docker compose -f compose.server.yml run --rm migrate
sudo docker compose -f compose.server.yml up -d keycloak
sudo docker compose -f compose.server.yml run --rm bootstrap
sudo ./scripts/configure-domain.sh
sudo docker compose -f compose.server.yml up -d worker
sudo docker compose -f compose.server.yml ps
~~~

Der Build erzeugt das gemeinsame Image für web, worker und Hilfsdienste. Migrationen liegen unter migrations/postgres und sind **vor den Schreibdiensten** auszuführen. bootstrap wartet auf Keycloak; vorhandene persönliche Konten werden nicht verändert. Bei einem Fehler anhalten und Abschnitt 9 verwenden, keine Volumes löschen.

### Domain-Assistent und HTTPS

Der genaue Aufruf ist **sudo ./scripts/configure-domain.sh** im inneren Projekt. Hostname eingeben, HTTPS mit j wählen, E-Mail und öffentliche IP(s) bestätigen. Der Assistent zeigt die geplante Änderung; erst j wendet sie an. Ohne geeignetes Host-Node nutzt er einen kurzlebigen Node-Container.

Er sichert .env als **.env.domain-ZEITPUNKT-ZUFALL.bak**, validiert Compose/Caddy und aktualisiert nur keycloak, identity-config, web und caddy. Datenbanken/Worker bleiben erhalten. identity-config gleicht den separat gespeicherten Web-Callback **https://DOMAIN/api/auth/callback**, die erlaubte Origin **https://DOMAIN** und das IdP-Frontend **https://DOMAIN/auth** ab.

Caddy verwendet ausdrücklich **Let’s Encrypt als einzigen ACME-Issuer**, bezieht Zertifikate automatisch, erneuert sie vor Ablauf und verwendet erneuerte Zertifikate automatisch. caddy-data muss erhalten bleiben; kein zusätzlicher Certbot/Cronjob nötig. HTTP wird im HTTPS-Modus auf HTTPS umgeleitet. [Caddy Automatic HTTPS](https://caddyserver.com/docs/automatic-https), [TLS-Issuer](https://caddyserver.com/docs/caddyfile/directives/tls)

### Container, Zertifikat und API prüfen

~~~bash
DOMAIN=kunden.example.at
sudo docker compose -f compose.server.yml ps
sudo docker compose -f compose.server.yml logs --tail=80 web worker keycloak caddy
sudo docker compose -f compose.server.yml exec -T db \
  pg_isready -U postgres -d kundenraum
sudo docker compose -f compose.server.yml exec -T db \
  psql -U postgres -d kundenraum \
  -c 'SELECT version FROM schema_migrations ORDER BY version;'
sudo docker compose -f compose.server.yml exec -T worker node -e \
  "const fs=require('fs'),os=require('os'),path=require('path');const age=Date.now()-fs.statSync(path.join(os.tmpdir(),'kundenraum-worker-heartbeat')).mtimeMs;console.log({ageSeconds:Math.round(age/1000)});process.exit(age<180000?0:1)"
curl --fail --silent --show-error "https://$DOMAIN/api/v1/health"
curl --silent --show-error --head "http://$DOMAIN/"
openssl s_client -connect "$DOMAIN:443" -servername "$DOMAIN" \
  -verify_hostname "$DOMAIN" -verify_return_error </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates
curl --fail --silent --show-error \
  "https://$DOMAIN/auth/realms/kundenraum/.well-known/openid-configuration"
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' \
  "https://$DOMAIN/api/v1/customers"
curl --silent --show-error --dump-header - --output /dev/null \
  "https://$DOMAIN/api/auth/login?returnTo=%2Fkunden"
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' \
  "https://$DOMAIN/auth/admin/"
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' \
  "https://$DOMAIN/auth/realms/master/.well-known/openid-configuration"
sudo ./scripts/configure-domain.sh --status
~~~

Beide privaten Keycloak-Prüfpfade müssen **404** liefern; die Discovery des Anwendungs-Realms bleibt erreichbar.

Erwartet: db/identity-db gesund, später web/worker gesund; Keycloak/Caddy laufend. Migrationsversionen vorhanden, Heartbeat jünger als 180 Sekunden. Health **200 / {"status":"ok"}**, HTTP-Weiterleitung mit HTTPS-Location, Zertifikat für den Host mit künftigem Ablaufdatum. Discovery-Issuer **https://DOMAIN/auth/realms/kundenraum**. Anonyme Kunden-API **401**, Login **302** unter derselben Domain nach /auth/. Keine Cookies, OAuth-State-Werte oder Tokens aus diesen Ausgaben veröffentlichen.

### Anmeldung im Browser abschließen

1. Bei Bedarf mit nano .env das generierte INITIAL_ADMIN_PASSWORD ablesen; nicht die gesamte Datei ausgeben.
2. https://kunden.example.at öffnen; mit **INITIAL_ADMIN_USERNAME** anmelden, nicht mit dem Keycloak-Bootstrapbenutzer.
3. Temporäres Passwort eingeben, eigenes Passwort setzen und Authenticator/TOTP einrichten.
4. Anmeldung abschließen; Kundenliste und Einstellungen → Login-Konten öffnen.
5. Abmelden und mit Passwort/OTP erneut anmelden. Das Sitzungscookie muss im Browser Secure und HttpOnly sein.

Der Domainstatus prüft Weiterleitungen, **keinen abgeschlossenen Passwort-/MFA-Login**. Den Browsertest ausdrücklich durchführen. Öffentliche IdP-Admin-/Master-Endpunkte sind absichtlich gesperrt. Nach Einrichtung einen persönlichen MFA-geschützten IdP-Wartungszugang vorsehen; vor Deaktivierung des Bootstrapzugangs muss ein gültiger interner Wartungszugang in KEYCLOAK_ADMIN_USER/PASSWORD für spätere Domainwechsel verfügbar sein.

## 6. HTTPS später aktivieren und Domain wechseln

Für eine bestehende HTTP-Domain denselben Assistenten ausführen, Domain beibehalten, HTTPS j:

~~~bash
cd /opt/kundenraum/kundenverwaltung/kundenverwaltung
sudo ./scripts/configure-domain.sh
sudo ./scripts/configure-domain.sh --status
~~~

Beim Domainwechsel zuerst A/AAAA der neuen Domain setzen und mit dig prüfen. Danach mit demselben Aufruf den neuen Hostnamen bestätigen. **Kein Build und keine Schema-Migration.** Der Assistent erstellt Container mit neuen Umgebungsvariablen neu; restart allein übernimmt diese nicht.

Der Web-Callback wird automatisch abgeglichen. Separat eingerichtete iOS-/Fremdclients und deren Redirect-/Logout-URLs zusätzlich prüfen/anpassen. Alte IdP-Sitzungen werden beendet; unter der neuen Domain frisch anmelden. Die HTTPS-, Discovery-, API- und Browserprüfungen aus Abschnitt 5 wiederholen.

Zur vorherigen Domainkonfiguration zurückkehren; den tatsächlich ausgegebenen Sicherungsnamen wählen:

~~~bash
sudo find . -maxdepth 1 -name '.env.domain-*.bak' -printf '%f\n'
read -r -p 'Vorherige .env.domain-…bak: ' DOMAIN_BACKUP
sudo ./scripts/configure-domain.sh --restore "$DOMAIN_BACKUP"
sudo ./scripts/configure-domain.sh --status
~~~

Die alte Domain muss noch auf den Server zeigen. Die Rückkehr prüft DNS, fragt erneut nach Bestätigung und stellt Domain-/HTTPS-/ACME-Werte wieder her, ohne zwischenzeitlich geänderte Datenbankgeheimnisse zu überschreiben. Caddy-Volumes bleiben erhalten.

### Wiederholte Ausstellungstests nur mit Staging

Auf einer separaten öffentlichen Testdomain mit fiktiven Konten:

~~~bash
sudo ./scripts/configure-domain.sh --acme-env staging
sudo ./scripts/configure-domain.sh --status
~~~

Verwendetes Verzeichnis: **https://acme-staging-v02.api.letsencrypt.org/directory**. Staging-Zertifikate sind absichtlich nicht normal vertrauenswürdig; keine Staging-CA in den normalen Browser importieren. Nach erfolgreicher Testprüfung bewusst umstellen:

~~~bash
sudo ./scripts/configure-domain.sh --acme-env production
sudo ./scripts/configure-domain.sh --status
~~~

[Let’s-Encrypt-Staging](https://letsencrypt.org/docs/staging-environment/). Erstausstellung und tatsächlich beobachtete Erneuerung getrennt abnehmen. Für letztere Ablaufdatum und Caddy-Logs über den Erneuerungszeitraum beobachten; keine Volumes für wiederholte Production-Ausstellungen löschen.

## 7. Backups und Updates

### Zusammengehöriges Wartungsbackup

Kunden- und Identity-Datenbank gemeinsam sichern. Die Wartungsunterbrechung verhindert Änderungen zwischen beiden Dumps. Sicherungen enthalten vertrauliche Daten und müssen verschlüsselt außerhalb des Servers aufbewahrt werden.

~~~bash
set -euo pipefail
cd /opt/kundenraum/kundenverwaltung/kundenverwaltung
umask 077
BACKUP_DIR="$PWD/backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
git rev-parse HEAD > "$BACKUP_DIR/git-commit.txt"
sudo docker compose -f compose.server.yml stop caddy web worker keycloak
sudo docker compose -f compose.server.yml exec -T db \
  pg_dump -U postgres -d kundenraum -Fc > "$BACKUP_DIR/kundenraum.dump"
sudo docker compose -f compose.server.yml exec -T identity-db \
  pg_dump -U postgres -d keycloak -Fc > "$BACKUP_DIR/keycloak.dump"
cp .env "$BACKUP_DIR/server.env"
cp compose.server.yml "$BACKUP_DIR/compose.server.yml"
git -C /opt/kundenraum archive HEAD > "$BACKUP_DIR/source.tar"
tar -czf "$BACKUP_DIR/configuration.tar.gz" deploy keycloak Dockerfile \
  package.json package-lock.json migrations
sudo docker compose -f compose.server.yml exec -T db \
  pg_restore --list < "$BACKUP_DIR/kundenraum.dump" > "$BACKUP_DIR/kundenraum.contents"
sudo docker compose -f compose.server.yml exec -T identity-db \
  pg_restore --list < "$BACKUP_DIR/keycloak.dump" > "$BACKUP_DIR/keycloak.contents"
test -s "$BACKUP_DIR/kundenraum.contents"
test -s "$BACKUP_DIR/keycloak.contents"
printf 'Sicherung: %s\n' "$BACKUP_DIR"
~~~

Nur bei erfolgreichem Backup fortfahren. Die Listenprüfung ersetzt keinen Restore-Test. Optional bei **weiter gestopptem Caddy** auch private Zertifikatsschlüssel/ACME-Daten sichern:

~~~bash
sudo docker run --rm \
  --mount type=volume,source=kundenraum_caddy-data,target=/source,readonly \
  alpine:3.22 tar -C /source -czf - . > "$BACKUP_DIR/caddy-data.tar.gz"
~~~

Falls zunächst kein Update folgt:

~~~bash
sudo docker compose -f compose.server.yml up -d keycloak web worker caddy
~~~

### Neue Version von GitHub beziehen

Vorher das Wartungsbackup erstellen, Releasehinweise lesen und Zielversion auswählen. Datenbank-/Keycloak-Major-Upgrades benötigen einen eigenen Plan.

~~~bash
set -euo pipefail
cd /opt/kundenraum
test -z "$(git status --porcelain --untracked-files=no)"
git fetch origin --tags
git tag --list --sort=-version:refname
read -r -p 'Ziel: vorhandener Release-Tag oder origin/master: ' UPDATE_REF
test -n "$UPDATE_REF"
git rev-parse --verify "$UPDATE_REF^{commit}"
git switch --detach "$UPDATE_REF"
cd /opt/kundenraum/kundenverwaltung/kundenverwaltung
sudo docker compose -f compose.server.yml config --quiet
sudo docker compose -f compose.server.yml stop caddy web worker keycloak
sudo docker compose -f compose.server.yml build web
sudo docker compose -f compose.server.yml up -d --wait db identity-db
sudo docker compose -f compose.server.yml run --rm migrate
sudo docker compose -f compose.server.yml up -d keycloak
sudo docker compose -f compose.server.yml run --rm identity-config
sudo docker compose -f compose.server.yml up -d --force-recreate web worker caddy
sudo docker compose -f compose.server.yml ps
sudo ./scripts/configure-domain.sh --status
~~~

APP_VERSION ist ein lokaler Image-Tag, kein Git-Releasewähler; der Build belegt ihn neu. Bei eigener Tagkonvention vor dem Build kontrolliert ändern. force-recreate übernimmt sicher das gerade gebaute gemeinsame Image. .env und Volumes bleiben erhalten.

Bei Fehlern anhalten; bei fehlgeschlagener Migration Schreibdienste gestoppt lassen. Ein Git-Rollback macht Migrationen nicht rückgängig. Dafür das zusammengehörige Release/Backup wiederherstellen. Danach alle technischen Prüfungen und den Browserlogin aus Abschnitt 5 wiederholen.

### Backup in der Weboberfläche herunterladen

Als Administrator mit MFA: **Einstellungen → Datenbank-Backup → Backup erstellen und herunterladen**. Der PostgreSQL-Custom-Dump enthält Kundendaten, Servicehistorie und Auditdaten. Der Download ist an die eigene Administratorsitzung gebunden, einmalig verfügbar und läuft nach 15 Minuten ab. Temporäre Serverdateien werden anschließend entfernt.

**Keycloak-Konten, Passwörter und MFA fehlen in diesem Download** und benötigen die separate Identity-Sicherung. Die Funktion benötigt PostgreSQL und pg_dump aus dem Anwendungsimage.

## 8. Wiederherstellung

Die folgenden Befehle ersetzen bewusst die beiden aktuellen Datenbanken. Zielserver und zusammengehöriges Backup vorher prüfen. Auf einem neuen Server zuerst Abschnitte 1–3 ausführen, aber keine neuen Konten anlegen; dann die gesicherte .env übernehmen. Das Backup muss beide Dumps, server.env und git-commit.txt enthalten.

~~~bash
set -euo pipefail
cd /opt/kundenraum/kundenverwaltung/kundenverwaltung
read -r -p 'Absoluter Pfad des zusammengehörigen Backups: ' BACKUP_DIR
test -s "$BACKUP_DIR/kundenraum.dump"
test -s "$BACKUP_DIR/keycloak.dump"
test -s "$BACKUP_DIR/server.env"
test -s "$BACKUP_DIR/git-commit.txt"
sudo docker compose -f compose.server.yml stop caddy web worker keycloak

RESTORE_COMMIT="$(cat "$BACKUP_DIR/git-commit.txt")"
git -C /opt/kundenraum fetch origin --tags
git -C /opt/kundenraum switch --detach "$RESTORE_COMMIT"
cp "$BACKUP_DIR/server.env" .env
chmod 600 .env
sudo docker compose -f compose.server.yml config --quiet
sudo docker compose -f compose.server.yml build web
sudo docker compose -f compose.server.yml up -d --wait db identity-db
sudo docker compose -f compose.server.yml exec -T db \
  pg_restore --list < "$BACKUP_DIR/kundenraum.dump" >/dev/null
sudo docker compose -f compose.server.yml exec -T identity-db \
  pg_restore --list < "$BACKUP_DIR/keycloak.dump" >/dev/null

sudo docker compose -f compose.server.yml exec -T db \
  dropdb -U postgres --if-exists --force kundenraum
sudo docker compose -f compose.server.yml exec -T db \
  createdb -U postgres -O kundenraum kundenraum
sudo docker compose -f compose.server.yml exec -T db \
  pg_restore -U postgres --role=kundenraum --no-owner --no-acl \
  --exit-on-error -d kundenraum < "$BACKUP_DIR/kundenraum.dump"
sudo docker compose -f compose.server.yml exec -T identity-db \
  dropdb -U postgres --if-exists --force keycloak
sudo docker compose -f compose.server.yml exec -T identity-db \
  createdb -U postgres -O keycloak keycloak
sudo docker compose -f compose.server.yml exec -T identity-db \
  pg_restore -U postgres --role=keycloak --no-owner --no-acl \
  --exit-on-error -d keycloak < "$BACKUP_DIR/keycloak.dump"

sudo docker compose -f compose.server.yml run --rm migrate
sudo docker compose -f compose.server.yml up -d keycloak
sudo docker compose -f compose.server.yml run --rm identity-config
sudo docker compose -f compose.server.yml up -d --force-recreate web worker caddy
sudo ./scripts/configure-domain.sh --status
~~~

Auf frischen Volumes erstellt das Init-Skript Rollen aus der restaurierten .env. Bei bestehenden Volumes müssen Rollenpasswörter dazu passen; ein Restore rotiert sie nicht. bootstrap nach Wiederherstellung der Identity-Datenbank nicht erneut zur Kontoanlage ausführen.

Ein einzelnes Web-Backup nur in die Kundendatenbank restaurieren; ohne passenden Identity-Dump die Identity-Datenbank nicht löschen. Vorher zugehörigen Quell-/Schemastand feststellen. [PostgreSQL pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html)

Optionales Caddy-Backup nur bei gestopptem Caddy ins vorgesehene Volume einspielen:

~~~bash
sudo docker compose -f compose.server.yml stop caddy
sudo docker run --rm -i \
  --mount type=volume,source=kundenraum_caddy-data,target=/target \
  alpine:3.22 tar -C /target -xzf - < "$BACKUP_DIR/caddy-data.tar.gz"
sudo docker compose -f compose.server.yml up -d caddy
~~~

Danach Kundenanzahl, Zahlungen, Historie und Login/OTP prüfen. Bei geänderter Domain den Assistenten aus Abschnitt 6 verwenden.

## 9. Fehlerbehebung

Alle Compose-Befehle im inneren Projektverzeichnis ausführen:

~~~bash
cd /opt/kundenraum/kundenverwaltung/kundenverwaltung
DOMAIN=kunden.example.at
~~~

| Problem | Konkreter Prüfbefehl | Erwartung / nächster Schritt |
|---|---|---|
| DNS falsch/fehlt | dig @1.1.1.1 +short A "$DOMAIN"; dig @1.1.1.1 +short AAAA "$DOMAIN" | Nur öffentliche Server-IP(s); leeres AAAA bei IPv4-only. Beim DNS-Anbieter korrigieren und TTL abwarten. |
| Port nicht erreichbar | Von einem **anderen Netz**: nc -vz "$DOMAIN" 80 und nc -vz "$DOMAIN" 443 | Erfolgreich, sobald Caddy läuft. Lokal sudo ss -ltnp und sudo ufw status verbose, außerdem Provider-Firewall/NAT prüfen. Vor Caddy-Start fehlt der Listener erwartungsgemäß. |
| Zertifikatsausstellung fehlgeschlagen | sudo docker compose -f compose.server.yml logs --tail=100 caddy | Keine ACME-Challenge-/Verbindungsfehler. DNS, AAAA, Ports, CAA, ACME_EMAIL und ACME_ENV prüfen. Wiederholte Ausstellungstests nur Staging. |
| Zertifikat/HTTPS prüfen | sudo ./scripts/configure-domain.sh --status | HTTPS erreichbar, Aussteller, zukünftiges Ablaufdatum und passende Login-Origin. |
| Datenbankverbindung fehlgeschlagen | sudo docker compose -f compose.server.yml exec -T db pg_isready -U postgres -d kundenraum | accepting connections; danach echten App-Zugang mit folgendem Befehl prüfen. pg_isready allein prüft kein Passwort. |
| Schema/Migration fehlt | sudo docker compose -f compose.server.yml exec -T db psql -U postgres -d kundenraum -c 'SELECT version FROM schema_migrations ORDER BY version;' | Migrationsversionen vorhanden; andernfalls migrate erfolgreich ausführen. |
| Login fehlgeschlagen | sudo docker compose -f compose.server.yml logs --tail=100 keycloak web | Keine Provider-/Client-/DB-Fehler; Discovery und Redirect wie unten prüfen. |
| Callback falsch | sudo docker compose -f compose.server.yml run --rm identity-config | Erfolgreich aktualisierte Callback-/Origin-/Frontend-URL; gültiger interner IdP-Wartungszugang erforderlich. Danach frische Browsersitzung. |
| Docker fehlt | sudo docker info; sudo systemctl status docker --no-pager | Engine erreichbar und Dienst aktiv; sonst kann Compose nicht starten. |

**App-Datenbankverbindung mit echten Zugangsdaten prüfen, ohne Geheimnisse auszugeben:**

~~~bash
sudo docker compose -f compose.server.yml run --rm --no-deps \
  --entrypoint node migrate --input-type=module -e \
  'import pg from "pg";const p=new pg.Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000});try{await p.query("SELECT 1");console.log("App-Datenbankverbindung OK");}catch{console.error("App-Datenbankverbindung fehlgeschlagen; DATABASE_URL und Rollenpasswort prüfen.");process.exitCode=1;}finally{await p.end();}'
~~~

Erwartet: App-Datenbankverbindung OK. Bei Fehlern DATABASE_URL im geschützten Editor prüfen: db, Port 5432, Datenbank/Rolle kundenraum und passendes URL-kodiertes Passwort. .env-Änderungen allein reparieren kein vorhandenes Rollenpasswort.

**Login-Discovery und Redirect prüfen:**

~~~bash
curl --fail --silent --show-error \
  "https://$DOMAIN/auth/realms/kundenraum/.well-known/openid-configuration"
curl --silent --show-error --dump-header - --output /dev/null \
  "https://$DOMAIN/api/auth/login?returnTo=%2Fkunden"
sudo docker compose -f compose.server.yml logs --tail=100 keycloak web
~~~

Erwartet: Discovery 200 mit öffentlichem HTTPS-Issuer, Login 302 zur selben Domain unter /auth/. Bei falschem Host den Domain-Assistenten verwenden. Bei falschem Clientsecret IdP und .env übereinstimmend korrigieren; der Realm-Startimport überschreibt bestehende Clients nicht. Bei OTP-Problemen Server-/Smartphone-Uhrzeit prüfen. App-Login und Bootstrapzugang nicht verwechseln. Keine Tokens, Cookies oder vollständige .env veröffentlichen.

## 10. Tatsächlich geprüfte Schritte

Stand: **11.11.2026**, Quellbasis **5fe4d6759138ff19043483e8d42c56470b68d934** plus Korrektur in `deploy/routes.caddy` und Regressionstest in `tests/domain-runtime.test.ts`.

Die Installation wurde mit **echten Linux-Containern unter Docker Desktop** aus einer isolierten Kopie des Projekts und mit **frischen PostgreSQL-Volumes** durchgeführt. Projektname: `kundenraum-install-test`, eigenes Anwendungsimage `kundenraum:install-test`, separate Zufallszugänge. Bestehende Entwicklungsdaten und Konten wurden nicht verwendet. Dies prüft die Containerinstallation; Ubuntu-Hostinstallation, öffentliche DNS-Auflösung und ACME-Ausstellung sind davon getrennt.

**Umgebung:** Docker Engine 29.9.2, Compose 5.6.1, Linux/amd64; Node 26.13.0, PostgreSQL 17.11, Keycloak 26.8.2, Caddy 2.11.9. Nur für den lokalen Test wurde Caddy auf eine interne Test-CA und die Hostports auf Loopback umgestellt. Domain: `kundenraum.localhost`. Die Produktionskonfiguration verwendet weiterhin ausschließlich Let's Encrypt. Der HTTPS-Testclient prüfte die Zertifikatskette gegen die Test-CA und den Hostnamen; Chrome verwendete für den lokalen Test die Option `ignoreHTTPSErrors`.

| Schritt | Tatsächliche Prüfung und Ergebnis |
|---|---|
| Serverkonfiguration | `setup-server.mjs` erzeugt auch im Linux-Container acht unterschiedliche 32-Byte-Geheimnisse und die passende PostgreSQL-URL; ein zweiter Aufruf verweigert das Überschreiben. Keine Geheimnisse ausgegeben. |
| Images und Build | PostgreSQL, Keycloak und Caddy erfolgreich geladen. Anwendung aus dem Dockerfile mit `npm ci`, Next.js-Produktionsbuild und TypeScript-Prüfung erfolgreich gebaut; nach der Proxy-Korrektur erneut erfolgreich gebaut. |
| Datenbanken | Beide PostgreSQL-Dienste aus leeren Volumes gestartet und gesund. Anwendungsrollen sind weder Superuser noch zur Rollen-/Datenbankanlage berechtigt. Keine Datenbankports am Host veröffentlicht. |
| Migration und Bootstrap | PostgreSQL-Schema Version 1 angelegt. Keycloak importiert den Realm und legt den persönlichen Administrator an. Erneute Migration und erneuter Bootstrap erfolgreich, ohne das bestehende persönliche Konto zurückzusetzen. |
| Domain-Abgleich und Dienste | `identity-config` synchronisiert HTTPS-Callback, Origin und IdP-Frontend. Caddy-Konfiguration validiert. Web und Worker werden gesund; Worker-Heartbeat beim Abschluss 31 Sekunden alt. |
| HTTPS und Zugriffsschutz | HTTP liefert 308 auf HTTPS; Health 200, anonyme Kunden-API 401, Discovery mit korrektem öffentlichen Issuer. Private Keycloak-Verwaltung und Master-Realm nach Korrektur jeweils 404. |
| Persönlicher Browserlogin | Reales Keycloak mit Chrome: temporäres Passwort, Pflicht-Passwortwechsel, TOTP-Einrichtung, Administratorrechte, sichere HttpOnly-Sitzung und Abmeldung erfolgreich. Erneute Anmeldung mit Passwort und TOTP ebenfalls erfolgreich. |
| Kundendaten und Web-Backup | Fiktiven Kunden über die authentifizierte API angelegt und gelesen. Zahlung und Kundennummer geprüft. Web-Backup über MFA-Administratorsitzung heruntergeladen, PostgreSQL-Custom-Format und einmaligen Download geprüft. |
| Restore des Web-Backups | Den heruntergeladenen Dump mit `pg_restore` in eine separate PostgreSQL-Datenbank eingespielt; Kundennummer und Zahlung stimmen überein. |
| Vollständiger Restore | Schreibdienste gestoppt, Kunden- und Identity-Datenbank mit `pg_dump -Fc` gesichert, Dump-Listen geprüft, beide **Testdatenbanken** neu angelegt und mit `pg_restore --role=… --no-owner --no-acl --exit-on-error` wiederhergestellt. Kunden, Serviceperioden, Auditdaten, Keycloak-Benutzer und Anmeldeinformationen einschließlich MFA vor/nach Restore identisch. |
| Wiederanlauf mit neuem Image | Migration erneut ausgeführt, Keycloak neu erstellt, Domain-Abgleich ausgeführt, Web/Worker/Caddy aus dem neuen Image neu erstellt. Alle Dienste laufen; erneuter Browserlogin mit erhaltenem Passwort/TOTP, Kundendaten und Zahlung erfolgreich. |

### Gefundener und behobener Fehler

Die bisherige `respond @privateIdentity 404`-Anweisung stand außerhalb der Proxy-Blöcke. Caddy sortierte sie hinter die `handle`-Weiterleitungen; `/auth/admin/` lieferte im echten Containertest **302 statt 404**. `deploy/routes.caddy` fasst Zugriffssperre und Weiterleitungen jetzt in einem `route`-Block zusammen, der die Reihenfolge erhält. Siehe [Caddy: Reihenfolge der Direktiven](https://caddyserver.com/docs/caddyfile/directives).

Der neue Regressionstest startet echtes Caddy, prüft fünf gesperrte Verwaltungs-/Master-Pfade sowie vier erlaubte Login-/Anwendungspfade. Auch im Docker-Browsertest wurden die Sperren nach der Korrektur erfolgreich geprüft. Der Fehler erklärt nicht automatisch eine bisher unbekannte Fehlermeldung eines anderen Dev-Servers.

### Automatisierte Prüfungen

- Im Linux-Anwendungsimage: `deployment.test.ts`, `postgres.test.ts`, `migration.test.ts`, `domain-configure.test.ts`: **10 bestanden, 0 Fehler, 0 übersprungen**.
- Nach Korrektur im Workspace mit echtem Caddy: `domain-runtime.test.ts`, `deployment.test.ts`, `domain-configure.test.ts`: **11 bestanden, 0 Fehler, 0 übersprungen**. Einige Tests überschneiden sich mit dem Linux-Lauf.
- Zusätzlich die oben dokumentierten echten Docker-, Chrome-, PostgreSQL-Dump-/Restore- und Wiederanlaufprüfungen.

Die dauerhaften Regressionstests können im inneren Projekt erneut ausgeführt werden:

~~~bash
node --import tsx --test tests/domain-runtime.test.ts tests/deployment.test.ts tests/domain-configure.test.ts
~~~

Dafür müssen die Projektabhängigkeiten installiert sein. `TEST_CADDY_BINARY` kann auf eine ausführbare Caddy-Datei zeigen; sonst wird `.runtime/caddy/caddy` beziehungsweise unter Windows `.runtime/caddy/caddy.exe` verwendet. Ohne Caddy-Binary werden die echten Caddy-Tests ausdrücklich übersprungen.

Die lokalen Prüfskripte und Testartefakte liegen ignoriert unter `.test-data/docker-browser.mjs`, `.test-data/docker-lifecycle.mjs` und `.test-data/docker-install/`. Dort liegen auch ausschließlich lokale Testzugänge und Dumps; diesen Ordner nicht veröffentlichen. Die Testcontainer wurden nach Abschluss beendet; Testvolumes bleiben für eine mögliche Nachprüfung erhalten.

### Noch auf dem Zielserver zu prüfen

- Ubuntu-24.04-Hostinstallation einschließlich APT, Docker-Einrichtung, Firewall und Provider-/NAT-Regeln aus Abschnitt 1.
- Öffentliche Testdomain mit richtigen A-/AAAA-Einträgen und von außen erreichbaren Ports 80/443; den Domain-Assistenten auf diesem Host vollständig ausführen. Lokal wurden seine Einzelschritte und automatisierten Fehlerpfade geprüft, kein öffentlicher DNS-Wechsel.
- Let's-Encrypt-Staging-/Production-Ausstellung und tatsächlich beobachtete automatische Erneuerung. Ein lokales Testzertifikat belegt diese externen Schritte nicht.
- Der konkrete Dev-Serverfehler: Ohne dessen Fehlermeldung, Installationsschritt und Quellstand lässt sich nicht feststellen, ob er mit der hier gefundenen Proxy-Konfiguration zusammenhängt.

**Hinweis zu Containerlogs:** `.env not found. Continuing without it.` bei Migration/Worker ist in diesem Compose-Aufbau erwartbar. Die Datei wird nicht ins Image kopiert; Compose übergibt die Werte als Umgebungsvariablen. Maßgeblich sind Exitcode, nachfolgende Fehlermeldungen und Healthchecks.
