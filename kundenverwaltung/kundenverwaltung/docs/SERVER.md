# Serverinstallation mit Docker Compose

Diese Anleitung gilt für einen frischen Ubuntu-24.04-LTS-Server (64 Bit), mit sudo-Rechten, mindestens 4 GB RAM, Domain mit A/AAAA-Eintrag auf den Server sowie erreichbaren TCP-Ports 80 und 443. SSH auf vertrauenswürdige Quellen beschränken. Die einzige veröffentlichte Anwendung ist Caddy auf 80/443; PostgreSQL, Keycloak, Web und Worker bleiben im Docker-Netz.

Die maßgebliche Datei ist **compose.server.yml** (JSON ist gültiges YAML). Die ältere docker-compose.yml ist eine lokale Entwicklungskonfiguration. Alle folgenden Befehle im Verzeichnis **/opt/kundenraum** ausführen. Hier müssen die Inhalte des inneren Projekts kundenverwaltung/kundenverwaltung liegen, also package.json und compose.server.yml direkt im Arbeitsverzeichnis.

## 1. Docker installieren

Auf einem frischen Ubuntu 24.04 nach der [offiziellen Docker-Anleitung](https://docs.docker.com/engine/install/ubuntu/):

```bash
set -e
sudo apt update
sudo apt install -y ca-certificates curl rsync
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker run --rm hello-world
sudo docker compose version
```

Bei einem bestehenden Server zuerst Konflikte mit docker.io, docker-compose oder fremdem containerd gemäß Docker-Dokumentation klären. Diese Anleitung deinstalliert nichts automatisch. Docker veröffentlichte Ports können UFW-Regeln umgehen; nur Caddy-Ports veröffentlichen und Provider-Firewall berücksichtigen.

## 2. Projekt übertragen und Konfiguration erzeugen

Auf dem **lokalen Windows-Rechner**, PowerShell; SERVER durch SSH-Ziel ersetzen:

```powershell
cd C:\Users\Maki\Documents\KundenDaten\kundenverwaltung\kundenverwaltung
tar --exclude=node_modules --exclude=.runtime --exclude=.next --exclude=.next-dev --exclude=.next-verify --exclude=./.env --exclude=./.env.* --exclude=data --exclude=transfer --exclude=test-results --exclude=*.bak -czf ..\kundenraum-source.tar.gz .
scp ..\kundenraum-source.tar.gz SERVER:/tmp/kundenraum-source.tar.gz
```

Auf dem **Server**:

```bash
set -e
sudo install -d -m 0750 /opt/kundenraum
sudo chown "$USER:$USER" /opt/kundenraum
cd /opt/kundenraum
tar -xzf /tmp/kundenraum-source.tar.gz
cp deploy/.env.example .env
chmod 600 .env
mkdir -p transfer backups
chmod 700 transfer backups
sudo docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" -w /work node:26.13.0-bookworm-slim node scripts/setup-server.mjs --domain kunden.example.com --email admin@example.com --admin-username mein.admin
```

Im letzten Befehl eigene Domain, Zertifikatskontakt und persönlichen Benutzernamen einsetzen. Das Skript ersetzt GENERIEREN durch individuelle kryptografische Zufallswerte und gibt keine Geheimnisse aus. Eine bereits initialisierte .env wird nicht überschrieben. Die Datei bei Bedarf ausschließlich lokal mit einem Editor öffnen, nie in Tickets/Logs kopieren.

Pflichtwerte: PUBLIC_DOMAIN ohne Schema/Pfad; APP_URL exakt https:// plus Domain ohne abschließenden Schrägstrich; TLS_EMAIL. Separate POSTGRES_ADMIN_PASSWORD/POSTGRES_PASSWORD und KEYCLOAK_DB_ADMIN_PASSWORD/KEYCLOAK_DB_PASSWORD; DATABASE_URL enthält das URL-kodierte App-Passwort und den internen Host db. SESSION_ENCRYPTION_KEY ist ein 32-Byte-Schlüssel in Hex. OIDC_CLIENT_SECRET schützt den vertraulichen Webclient. KEYCLOAK_ADMIN_USER/PASSWORD sind der IdP-Bootstrapzugang; INITIAL_ADMIN_USERNAME/PASSWORD der persönliche, temporäre Erstzugang. Keine Standardpasswörter ausliefern.

Passwörter bestehender PostgreSQL-Volumes werden durch eine Änderung von .env **nicht** rotiert. Erst die jeweilige DB-Rolle kontrolliert ändern und danach die passende Konfiguration ersetzen. APP_URL und OIDC_CLIENT_SECRET nach dem ersten Realm-Import nicht nur in .env ändern: Keycloak überspringt vorhandene Realms; Redirect-URI und Clientsecret müssen dort ebenfalls angepasst werden.

## 3. Frische Installation

```bash
set -e
cd /opt/kundenraum
sudo docker compose -f compose.server.yml config --quiet
sudo docker compose -f compose.server.yml build web
sudo docker compose -f compose.server.yml up -d db identity-db
sudo docker compose -f compose.server.yml run --rm migrate
sudo docker compose -f compose.server.yml up -d keycloak
sudo docker compose -f compose.server.yml run --rm bootstrap
sudo docker compose -f compose.server.yml up -d web worker caddy
sudo docker compose -f compose.server.yml ps
```

Migrationen sind ein **expliziter Schritt** vor dem Start der Schreibdienste. Das App-Konto kundenraum ist kein Datenbank-Superuser. Zwei persistente Volumes halten Kunden-/Identitätsdaten; weitere Volumes halten TLS-Zertifikate. **Kein docker compose down -v** im normalen Betrieb.

Domain im Browser öffnen. Das integrierte Login erscheint unter derselben Domain /auth im Kundenraum-Design. Der Identity Provider verarbeitet Passwort und OTP; die Webanwendung erhält keine Passwörter aus dem Login. Mit INITIAL_ADMIN_USERNAME und dem individuell generierten INITIAL_ADMIN_PASSWORD aus der geschützten .env anmelden, Passwort ändern und Authenticator einrichten. Das Skript bootstrap verändert bestehende persönliche Konten nicht.

Unter Einstellungen → Login-Konten weitere Benutzer anlegen: Benutzername, Rolle und initiales Passwort. Dieses muss bei der nächsten Anmeldung geändert werden. Passwort neu setzen widerruft bestehende Sitzungen; bestehende OTP-Geräte bleiben erhalten. Es gibt keine öffentliche Selbstregistrierung. Rollen und Kundenzuordnung sind unabhängig.

Nach Einrichtung einen dauerhaft persönlichen, MFA-geschützten IdP-Verwaltungszugang vorsehen und den Bootstrapzugang kontrolliert deaktivieren. Die öffentliche Admin-Konsole ist absichtlich gesperrt; erforderliche IdP-Administration intern über einen gesicherten Wartungszugang durchführen. Das App-Servicekonto bleibt für Benutzerverwaltung erforderlich. bootstrap danach nur noch gezielt mit gültigem IdP-Wartungszugang ausführen.

## 4. Domain und HTTPS

DNS muss vor Caddy-Start auf den Server zeigen (auch einen eventuell vorhandenen AAAA-Eintrag prüfen). TCP 80/443 in Provider-Firewall freigeben. deploy/Caddyfile fordert automatisch ein öffentliches Zertifikat an und leitet HTTP auf HTTPS. /auth/* wird mit erhaltenem Präfix an Keycloak weitergereicht; alle übrigen Anfragen an web:3000. /auth/admin* und der Master-Realm sind öffentlich gesperrt.

Keycloak verwendet den öffentlichen Host APP_URL/auth, intern HTTP im privaten Docker-Netz, und xforwarded-Proxyheader; siehe [Keycloak Reverse Proxy](https://www.keycloak.org/server/reverseproxy). Kein Port 5432 oder 8080 am Host öffnen. APP_URL muss der tatsächlichen HTTPS-Origin entsprechen, sonst schlagen CSRF/OIDC-Prüfungen fehl. Unterdomains im HSTS-Bereich ebenfalls mit HTTPS betreiben.

## 5. Betrieb prüfen

```bash
set -e
sudo docker compose -f compose.server.yml ps
sudo docker compose -f compose.server.yml logs --tail=80 web worker keycloak caddy
sudo docker compose -f compose.server.yml exec -T db pg_isready -U postgres -d kundenraum
sudo docker compose -f compose.server.yml exec -T db psql -U postgres -d kundenraum -c 'SELECT version FROM schema_migrations ORDER BY version;'
sudo docker compose -f compose.server.yml exec -T worker node -e "const fs=require('fs'),p=require('path').join(require('os').tmpdir(),'kundenraum-worker-heartbeat'); console.log(new Date(fs.statSync(p).mtimeMs).toISOString())"
curl --fail --silent --show-error https://kunden.example.com/api/v1/health
curl --silent --output /dev/null --write-out '%{http_code}\n' https://kunden.example.com/api/v1/customers
sudo docker compose -f compose.server.yml restart web worker
```

Gesundheit liefert {"status":"ok"}, anonyme Kundenanfragen liefern 401. Worker-Heartbeat darf nicht älter als drei Minuten sein. Im Browser Login, Passwortwechsel, OTP, Kundenliste und Rollen prüfen. Anonyme geschützte interne Links führen zum Login und nach Erfolg zurück. Die UI lädt Kundendaten erst nach Authentifizierung.

## 6. Backup, Update und Wiederherstellung

Kundendaten und Keycloak gehören zusammen. Backups enthalten persönliche Daten und Geheimnisse: restriktive Rechte, verschlüsselte externe Kopie, Aufbewahrung und regelmäßigen Restore-Test vorsehen.

### Konsistente Wartungssicherung

```bash
set -e
cd /opt/kundenraum
umask 077
backup_dir="backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"
sudo docker compose -f compose.server.yml stop caddy web worker keycloak
sudo docker compose -f compose.server.yml exec -T db pg_dump -U postgres -d kundenraum -Fc > "$backup_dir/kundenraum.dump"
sudo docker compose -f compose.server.yml exec -T identity-db pg_dump -U postgres -d keycloak -Fc > "$backup_dir/keycloak.dump"
cp .env "$backup_dir/server.env"
cp compose.server.yml "$backup_dir/compose.server.yml"
tar -czf "$backup_dir/configuration.tar.gz" deploy keycloak Dockerfile package.json package-lock.json migrations
sudo docker compose -f compose.server.yml up -d keycloak web worker caddy
```

Bei einem fehlgeschlagenen Dump **kein Update** durchführen; Status/Plattenplatz beheben und Sicherung erneut prüfen. Das unveränderte Release separat archivieren. TLS-Zertifikate können bei Verlust des Caddy-Volumes neu ausgestellt werden; für häufige Wiederherstellung Zertifikatsrate-Limits beachten.

### Update

Nach erfolgreicher Sicherung neue Quelldateien bereitstellen. .env, backups und transfer erhalten; keine lokalen Entwicklungsdaten hochladen. APP_VERSION in .env auf die neue Releaseversion setzen. Anschließend:

```bash
set -e
cd /opt/kundenraum
sudo docker compose -f compose.server.yml stop caddy web worker
sudo docker compose -f compose.server.yml build web
sudo docker compose -f compose.server.yml run --rm migrate
sudo docker compose -f compose.server.yml up -d keycloak web worker caddy
sudo docker compose -f compose.server.yml ps
sudo docker compose -f compose.server.yml logs --tail=60 web worker
```

Bei einer fehlgeschlagenen Migration Schreibdienste gestoppt lassen und Fehler beheben oder zusammengehöriges Release/Backup wiederherstellen. Datenbank- und Keycloak-Major-Upgrades benötigen eigene Upgradeplanung; nicht unkontrolliert Image-Tags ändern.

### Wiederherstellung (überschreibt den aktuellen Bestand)

Nur bewusst auf dem vorgesehenen Zielserver ausführen. Zuerst Daten und .env des gewünschten, zusammengehörigen Backups sowie die passende Quellversion bereitstellen. BACKUP_DIR im Befehl auf das tatsächliche Verzeichnis setzen. Die Befehle löschen genau die beiden Anwendungsdatenbanken und bauen sie neu auf, keine Volumes.

```bash
set -e
cd /opt/kundenraum
BACKUP_DIR=backups/20261109T120000Z
test -s "$BACKUP_DIR/kundenraum.dump" && test -s "$BACKUP_DIR/keycloak.dump" && test -s "$BACKUP_DIR/server.env"
sudo docker compose -f compose.server.yml stop caddy web worker keycloak
cp "$BACKUP_DIR/server.env" .env
chmod 600 .env
sudo docker compose -f compose.server.yml up -d db identity-db
sudo docker compose -f compose.server.yml exec -T db dropdb -U postgres --if-exists --force kundenraum
sudo docker compose -f compose.server.yml exec -T db createdb -U postgres -O kundenraum kundenraum
sudo docker compose -f compose.server.yml exec -T db pg_restore -U postgres --role=kundenraum --no-owner --no-acl --exit-on-error -d kundenraum < "$BACKUP_DIR/kundenraum.dump"
sudo docker compose -f compose.server.yml exec -T identity-db dropdb -U postgres --if-exists --force keycloak
sudo docker compose -f compose.server.yml exec -T identity-db createdb -U postgres -O keycloak keycloak
sudo docker compose -f compose.server.yml exec -T identity-db pg_restore -U postgres --role=keycloak --no-owner --no-acl --exit-on-error -d keycloak < "$BACKUP_DIR/keycloak.dump"
sudo docker compose -f compose.server.yml run --rm migrate
sudo docker compose -f compose.server.yml up -d keycloak
sudo docker compose -f compose.server.yml up -d web worker caddy
sudo docker compose -f compose.server.yml ps
```

Jeden Schritt nur bei Exitcode 0 fortsetzen. Für einen frischen Zielhost legt das init-Skript die Rollen aus der wiederhergestellten .env an; auf bestehenden Volumes müssen die Rollenpasswörter zum Backup passen. [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html) stellt das Custom-Format wieder her. Login/OTP, Kundenanzahl, Zahlungszeiträume, API-Schutz und Worker danach erneut prüfen. bootstrap ist nach Wiederherstellung des Identity-Backups nicht nötig und setzt keine Passwörter zurück.

### Vorhandene SQLite-Kundendaten übernehmen

Auf dem bisherigen lokalen System zuerst Web/Worker stoppen, dann im Projekt:

```powershell
npm run migrate
npm run snapshot:sqlite -- --output transfer/kunden.sqlite
scp transfer/kunden.sqlite SERVER:/opt/kundenraum/transfer/kunden.sqlite
```

snapshot:sqlite erstellt mit VACUUM INTO eine konsistente neue Datei und überschreibt kein Ziel. Der SQLite-v4-Migrationsschritt erhält bestehende Nummern, Zahlungszeiträume und Zuordnungen. Die Zieldatenbank muss **leer** sein; der Import verweigert sonst jede Änderung. Auf dem Server nach Schema-Migration, aber vor dem Start von web/worker:

```bash
set -e
sudo docker compose -f compose.server.yml run --rm migrate npm run migrate:sqlite-to-postgres -- --sqlite /transfer/kunden.sqlite
```

Die Übernahme läuft transaktional, erhält IDs/Nummern/Historiendaten und setzt Sequenzen fort. Flüchtige Vorschauen und Sitzungen werden nicht übertragen; unklare laufende Sendungen werden zur Prüfung markiert. Persönliche Login-Konten sind in Keycloak gespeichert: Bei neuer Identity-Datenbank separat kontrolliert migrieren (Keycloak-DB-Backup/Restore mit identischer Version und Clientkonfiguration) oder persönliche Konten neu anlegen. Die SQLite-Übernahme allein überträgt keine IdP-Passwörter oder OTP-Geheimnisse.

## 7. Gemeinsamer CSV-/XLSX-Import

In der Anwendung **Import** öffnen. Vorlagen: /examples/import-vorlage.csv und /examples/import-vorlage.xlsx. Sie enthalten ausschließlich fiktive Daten. Kundenliste und drei-spaltiger MGMT-Export verwenden denselben Dialog.

| Spalte | Pflicht / Format |
|---|---|
| Name | Pflicht, Service-/Benutzername |
| MAC-Adresse | Pflicht, gültige MAC oder freie Kennung; Modus wird erkannt und kann korrigiert werden |
| Serviceende | Pflicht, TT.MM.JJJJ; echte Excel-Datumszelle ebenfalls möglich |
| Telefon | Optional, Text; lokal z. B. 0676 1234567 oder international +43… |
| Adresse | Optional, Text |
| PLZ | Optional, Text, z. B. 00123 |
| Anbieter | Optional, Art oder 2GO |
| Paket | Optional, 1, 6, 7, 12 oder 14 |
| Benutzerzuordnung | Optional, Marko, Mirko oder Satem |
| Punkte | Optional, Dezimalzahl (Komma oder Punkt) |
| Servicebeginn | Optional, TT.MM.JJJJ / Excel-Datum |
| Zahlungsfälligkeit | Optional, TT.MM.JJJJ / Excel-Datum |
| Zahlungsstatus | Optional, Bezahlt, Unbezahlt oder Unbekannt |
| Kommentar | Optional, Freitext |
| MAC-Format | Optional, MAC oder Kennung; überschreibt automatische Erkennung |

CSV: UTF-8 (BOM erlaubt), Semikolon oder Komma (auch Tab erkannt) als Trennzeichen; Felder mit Trennzeichen/Zeilenumbrüchen in doppelte Anführungszeichen setzen. Telefon und PLZ bereits **vor der Eingabe** in Excel als Text formatieren; verlorene führende Nullen können nicht rekonstruiert werden. Keine Formeln, Links oder Fehlerzellen. Datei maximal 5 MiB, 5.000 Datenzeilen; XLSX-Entpackbudget zusätzlich begrenzt.

Beispiel mit nur Pflichtspalten:

```csv
Name;MAC-Adresse;Serviceende
demo.alpen;02:00:00:00:00:01;31.12.2026
demo.kennung;Service.Alpha;28.02.2027
```

Datei wählen, Spalten zuordnen, Vorschau erzeugen. **Bereits vorhanden**, **Serviceende geändert**, **Neu**, **Prüfung erforderlich** zeigen Anzahl und Details. Bei Stammdatenänderungen wird die Änderungszeile ebenfalls als geändert gezeigt. MACs werden normalisiert, freie Kennungen außen getrimmt und unter Beachtung der Groß-/Kleinschreibung verglichen. Nur Name **und** Kennung gemeinsam ergeben einen eindeutigen Treffer. Konflikte korrigieren oder eindeutig manuell zuordnen und neue Vorschau erzeugen.

Leere optionale Werte überschreiben nichts. Drei Pflichtspalten reichen für neue Konten; fehlende Daten erscheinen als zu ergänzen, Zahlung Unbekannt. Neue Zeilen müssen aktiv ausgewählt werden. Bei geänderten Enddaten ist Zahlungsstatus beibehalten vorausgewählt; pro Zeile oder gesammelt auf Unbezahlt setzen möglich. Vor **Auswahl importieren** Anzahl kontrollieren. Die Vorschau schreibt keine Kundendaten. Gleichzeitige Änderungen führen zu 409 und erfordern eine neue Vorschau. Wiederholte Daten erzeugen keine doppelten Kunden oder Verlängerungen.

## Versand einrichten

Produktivversand ist zunächst ausgeschaltet. Unter Einstellungen Standardland (initial AT), Versandzeitpunkte und Ein-/Ausschalter konfigurieren. WhatsApp benötigt WHATSAPP_API_VERSION (aktuell unterstützte offizielle Graph-Version), WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, genehmigte WHATSAPP_TEMPLATE und WHATSAPP_LANGUAGE sowie eine separate fest konfigurierte WHATSAPP_TEST_NUMBER. Die genehmigte Vorlage muss zur Vorschau mit Name/Kundennummer/Serviceende passen. Einwilligung pro Kunde dokumentieren.

Testversand sendet ausschließlich an die Testnummer, auch bei ausgeschaltetem Produktivversand. Massenversand braucht Administratorrechte und zeigt Vorlage, versandfähige Kunden und Ausschlussgründe. Produktivschalter, Einwilligung, aktuelle Daten und Nummer werden erneut geprüft; Wiederholung derselben Freigabe sendet nicht doppelt. Unklare Sendungen im Versandprotokoll vor erneutem Versand manuell prüfen.

Telegram benötigt TELEGRAM_BOT_TOKEN und private TELEGRAM_CHAT_ID; separat einschalten und Testnachricht prüfen. Der Worker plant in Europe/Vienna; tägliche Zusammenfassung und Vorlauf werden in Einstellungen gesetzt. Nach Änderungen an .env: sudo docker compose -f compose.server.yml up -d --force-recreate web worker. Keine Zugangsdaten sind im Quellcode enthalten.

## Tatsächlicher Prüfstand

Siehe [VERIFICATION.md](VERIFICATION.md). Compose-Konfiguration und PostgreSQL-SQL wurden lokal geprüft. Ein vollständiger Container-Erststart war auf diesem Windows-Rechner mangels laufender Docker-Engine/Virtualisierung nicht möglich. Die obige Linux-Installation einschließlich öffentlicher TLS-Zertifikate und Restore muss auf dem Zielserver abgenommen werden.
