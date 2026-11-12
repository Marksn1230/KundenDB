> Domain-/HTTPS-Einrichtung: [DOMAIN.md](DOMAIN.md). Standardmäßig HTTPS mit ausdrücklich gewähltem Let’s Encrypt; der Assistent bestätigt DNS und sichert die vorherige Konfiguration.

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

Zentrale Werte: APP_DOMAIN ohne Schema/Port/Pfad, HTTPS_ENABLED=true|false und ACME_EMAIL. Optional ACME_ENV=staging für Ausstellungstests. Compose-Startskripte leiten APP_URL und Login-Origin zur Laufzeit aus Domain und Protokoll ab. Einzelheiten und interaktiver Assistent: [DOMAIN.md](DOMAIN.md). Separate POSTGRES_ADMIN_PASSWORD/POSTGRES_PASSWORD und KEYCLOAK_DB_ADMIN_PASSWORD/KEYCLOAK_DB_PASSWORD; DATABASE_URL enthält das URL-kodierte App-Passwort und den internen Host db. SESSION_ENCRYPTION_KEY ist ein 32-Byte-Schlüssel in Hex. OIDC_CLIENT_SECRET schützt den vertraulichen Webclient. KEYCLOAK_ADMIN_USER/PASSWORD sind der IdP-Bootstrapzugang; INITIAL_ADMIN_USERNAME/PASSWORD der persönliche, temporäre Erstzugang. Keine Standardpasswörter ausliefern.

Passwörter bestehender PostgreSQL-Volumes werden durch eine Änderung von .env **nicht** rotiert. Erst die jeweilige DB-Rolle kontrolliert ändern und danach die passende Konfiguration ersetzen. Für einen Domain-/HTTPS-Wechsel den Assistenten aus DOMAIN.md verwenden. Ein Clientsecret separat kontrolliert beim IdP und in der Umgebung rotieren; der Realm-Startimport überschreibt vorhandene Clients nicht.

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
chmod +x scripts/configure-domain.sh
sudo ./scripts/configure-domain.sh
sudo docker compose -f compose.server.yml up -d worker
sudo docker compose -f compose.server.yml ps
```

Migrationen sind ein **expliziter Schritt** vor dem Start der Schreibdienste. Das App-Konto kundenraum ist kein Datenbank-Superuser. Zwei persistente Volumes halten Kunden-/Identitätsdaten; weitere Volumes halten TLS-Zertifikate. **Kein docker compose down -v** im normalen Betrieb.

Domain im Browser öffnen. Das integrierte Login erscheint unter derselben Domain /auth im Kundenraum-Design. Der Identity Provider verarbeitet Passwort und OTP; die Webanwendung erhält keine Passwörter aus dem Login. Mit INITIAL_ADMIN_USERNAME und dem individuell generierten INITIAL_ADMIN_PASSWORD aus der geschützten .env anmelden, Passwort ändern und Authenticator einrichten. Das Skript bootstrap verändert bestehende persönliche Konten nicht.

Unter Einstellungen → Login-Konten weitere Benutzer anlegen: Benutzername, Rolle und initiales Passwort. Dieses muss bei der nächsten Anmeldung geändert werden. Passwort neu setzen widerruft bestehende Sitzungen; bestehende OTP-Geräte bleiben erhalten. Es gibt keine öffentliche Selbstregistrierung. Rollen und Kundenzuordnung sind unabhängig.

Nach Einrichtung einen dauerhaft persönlichen, MFA-geschützten IdP-Verwaltungszugang vorsehen und den Bootstrapzugang kontrolliert deaktivieren. Die öffentliche Admin-Konsole ist absichtlich gesperrt; erforderliche IdP-Administration intern über einen gesicherten Wartungszugang durchführen. Das App-Servicekonto bleibt für Benutzerverwaltung erforderlich. bootstrap danach nur noch gezielt mit gültigem IdP-Wartungszugang ausführen.

## 4. Domain und HTTPS

DNS muss vor Caddy-Start auf den Server zeigen (auch einen eventuell vorhandenen AAAA-Eintrag prüfen). TCP 80/443 in Provider-Firewall freigeben. deploy/Caddyfile fordert automatisch ein öffentliches Zertifikat an und leitet HTTP auf HTTPS. /auth/* wird mit erhaltenem Präfix an Keycloak weitergereicht; alle übrigen Anfragen an web:3000. /auth/admin* und der Master-Realm sind öffentlich gesperrt.

Keycloak verwendet den öffentlichen Host APP_URL/auth, intern HTTP im privaten Docker-Netz, und xforwarded-Proxyheader; siehe [Keycloak Reverse Proxy](https://www.keycloak.org/server/reverseproxy). Kein Port 5432 oder 8080 am Host öffnen. APP_URL wird aus Domain und HTTPS-Auswahl abgeleitet und muss der tatsächlichen öffentlichen Origin entsprechen, sonst schlagen CSRF/OIDC-Prüfungen fehl. Unterdomains im HSTS-Bereich ebenfalls mit HTTPS betreiben.

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

Für vorhandene Installationen gilt die [aktuelle Update-Anleitung](UPDATE.md) mit Sicherungen, protokolliertem Hintergrundlauf und Fortsetzen nach einem PuTTY-Abbruch. Die frühere interaktive Befehlsfolge ist ersetzt. Datenbank- und Keycloak-Major-Upgrades benötigen weiterhin einen eigenen Plan.

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

Import öffnen; Vorlagen /examples/import-vorlage.csv und /examples/import-vorlage.xlsx enthalten fiktive Daten. /examples/import-ohne-serviceende.csv zeigt eine Datei ohne Datumsspalte.

**Pflicht sind nur Name und MAC-Adresse. Serviceende darf vollständig fehlen oder pro Zeile leer sein.** Fehlende Daten werden als SQL-NULL gespeichert, keine Platzhalterdaten. Bei neuen Konten bleibt ein fehlendes Serviceende auch dann leer, wenn Beginn und Paket mitgeliefert wurden. Die Kundennummer wird erst nach Freigabe als sechs Zeichen erzeugt. Die Kundenliste zeigt Serviceende fehlt.

| Spalte | Format |
|---|---|
| Name | Pflicht: Service-Benutzername |
| MAC-Adresse | Pflicht: MAC oder freie Kennung; Prüfart in Vorschau korrigierbar |
| Serviceende | Optional: TT.MM.JJJJ oder echte Excel-Datumszelle |
| Telefon | Optionaler Text, lokal oder international |
| Adresse | Optionaler Text |
| PLZ | Optionaler Text, z. B. 00123 |
| Anbieter | Optional: Art oder 2GO |
| Paket | Optional: 1, 6, 7, 12 oder 14 |
| Benutzerzuordnung | Optional: Marko, Mirko oder Satem |
| Punkte | Optional: Dezimalzahl, Komma oder Punkt |
| Servicebeginn | Optional: TT.MM.JJJJ / Excel-Datum |
| Zahlungsfälligkeit | Optional: TT.MM.JJJJ / Excel-Datum |
| Zahlungsstatus | Optional: Bezahlt, Unbezahlt oder Unbekannt; für neue Konten |
| Kommentar | Optionaler Freitext |
| MAC-Format | Optional: MAC oder Kennung; leer = Erkennung |

CSV: UTF-8, BOM erlaubt, Semikolon/Komma/Tab erkannt. Telefon und PLZ vor der Excel-Eingabe als Text formatieren. Keine Formeln/Links/Fehlerzellen. Maximal 5 MiB, 5.000 Zeilen; XLSX-Entpackbudget zusätzlich begrenzt.

```csv
Name;MAC-Adresse
demo.ohneDatum;Service.OhneDatum
```

Oder gemischt:

```csv
Name;MAC-Adresse;Serviceende
demo.alpen;02:00:00:00:00:01;31.12.2027
demo.ohneDatum;Service.OhneDatum;
```

Bei bestehenden Kunden verändert ein fehlendes/leeres Enddatum das gespeicherte Ende nicht. Ein ausgefüllter ungültiger Datumswert ist ein Zeilenfehler. Auch leere sonstige optionale Stammdaten überschreiben nichts. Name und Kennung dienen im normalen Import gemeinsam dem Abgleich. Neue Konten benötigen aktive Auswahl und Bestätigung; die Vorschau schreibt nichts. Wiederholungen erzeugen keine doppelten Konten oder Zeiträume.

## Nur bestehende Kunden aktualisieren

Im selben Dialog **Nur bestehende Kunden aktualisieren** einschalten. Es werden in diesem Modus keine Konten angelegt; nur Name, Kennung/Prüfart und Serviceende können übernommen werden. Beispiel: /examples/bestehende-kunden-aktualisieren.csv.

| Treffer | Vorschau und Freigabe |
|---|---|
| Name und Kennung passen zum selben Konto | Datum setzen/ändern; ohne Datum bleibt es erhalten |
| Nur Name eindeutig | Alte/importierte Kennung anzeigen; Datum unabhängig übernehmen, MAC nur über eigene Bestätigung |
| Nur Kennung eindeutig | Alten/importierten Namen anzeigen; Datum unabhängig übernehmen, Name nur über eigene Bestätigung |
| Felder zeigen auf unterschiedliche Konten / Mehrdeutigkeit | Konflikt; Korrektur oder eindeutige manuelle Klärung vor Freigabe |
| Kein Treffer | Kein bestehender Kunde gefunden; keine Neuanlage |

MACs werden normalisiert, freie Kennungen außen getrimmt und unter Beachtung der Groß-/Kleinschreibung verglichen; Namen werden getrimmt und ohne Groß-/Kleinschreibung abgeglichen. Doppelte/widersprüchliche Dateiidentitäten bleiben gesperrt.

**Serviceende übernehmen**, **Name aktualisieren** und **MAC-Adresse aktualisieren** sind getrennte Freigaben. Eine Sammelauswahl übernimmt Datumsänderungen, keine Namens-/MAC-Änderungen. Wenn bisher kein Datum vorhanden ist, erscheint **Serviceende erstmals setzen**. Die Vorschau zeigt alle bisherigen/importierten Werte; nicht freigegebene Identitätsänderungen bleiben unverändert. Reine Namens-/Kennungsänderungen verändern weder Zahlung noch Enddatum. Bei einer tatsächlichen Enddatumsänderung bleibt die Zahlung standardmäßig erhalten; auf Unbezahlt setzen ist optional.

Auswahl importieren zeigt die Zahl der Zeilen, Änderungen und übersprungenen Einträge. Der Server klassifiziert die Zuordnung unter Transaktionssperre erneut. Ein Versions-/Trefferkonflikt verlangt eine neue Vorschau. Spätere Enddaten legen eine Verlängerung mit erhaltener Historie an; erstmalige/frühere Enddaten korrigieren den aktuellen Zeitraum. Erneute Daten ohne neue Freigabe erzeugen keine weiteren Verlängerungen.

## Versand einrichten

Produktivversand ist zunächst ausgeschaltet. Unter Einstellungen Standardland (initial AT), Versandzeitpunkte und Ein-/Ausschalter konfigurieren. WhatsApp benötigt WHATSAPP_API_VERSION (aktuell unterstützte offizielle Graph-Version), WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, genehmigte WHATSAPP_TEMPLATE und WHATSAPP_LANGUAGE sowie eine separate fest konfigurierte WHATSAPP_TEST_NUMBER. Die genehmigte Vorlage muss zur Vorschau mit Name/Kundennummer/Serviceende passen. Einwilligung pro Kunde dokumentieren.

Testversand sendet ausschließlich an die Testnummer, auch bei ausgeschaltetem Produktivversand. Massenversand braucht Administratorrechte und zeigt Vorlage, versandfähige Kunden und Ausschlussgründe. Produktivschalter, Einwilligung, aktuelle Daten und Nummer werden erneut geprüft; Wiederholung derselben Freigabe sendet nicht doppelt. Unklare Sendungen im Versandprotokoll vor erneutem Versand manuell prüfen.

Telegram benötigt TELEGRAM_BOT_TOKEN und private TELEGRAM_CHAT_ID; separat einschalten und Testnachricht prüfen. Der Worker plant in Europe/Vienna; tägliche Zusammenfassung und Vorlauf werden in Einstellungen gesetzt. Nach Änderungen an .env: sudo docker compose -f compose.server.yml up -d --force-recreate web worker. Keine Zugangsdaten sind im Quellcode enthalten.

## Tatsächlicher Prüfstand

Siehe [VERIFICATION.md](VERIFICATION.md). Compose-Konfiguration und PostgreSQL-SQL wurden lokal geprüft. Zusätzlich sind echter PostgreSQL-Dump, Download, Restore in eine zweite native Testdatenbank und Caddy-HTTPS mit Test-CA geprüft (siehe Prüfprotokoll). Ein vollständiger Container-Erststart war auf diesem Windows-Rechner mangels laufender Docker-Engine/Virtualisierung nicht möglich. Die obige Linux-Installation einschließlich öffentlicher TLS-Zertifikate und Restore muss auf dem Zielserver abgenommen werden.

## Öffentliche Domain, HTTPS und Rückkehr

Die aktuelle Anleitung einschließlich interaktivem Einrichtungsbefehl, explizitem Let’s Encrypt, DNS-Prüfung, Staging, Zertifikatsablauf und Rückkehr steht in [DOMAIN.md](DOMAIN.md). Sie ersetzt die früheren manuellen .env-/identity-config-Schritte. Nach einem einmaligen Update auf dieses Release brauchen spätere Domain-/HTTPS-Wechsel keinen Build und keine Migration.

## PostgreSQL-Backup aus der Weboberfläche

Als Administrator **Einstellungen → Datenbank-Backup → Backup erstellen und herunterladen** öffnen. Die Anwendung startet pg_dump 17 mit Custom-Format (-Fc), zeigt den Erstellungsstatus und lädt die fertige .dump-Datei herunter. Ein manueller Downloadbutton bleibt als Rückfall verfügbar. Dateiname enthält UTC-Datum/Uhrzeit.

Nur eine angemeldete Administratorsitzung kann erstellen, Status lesen oder herunterladen; Bearerzugriffe sind hier ausgeschlossen. Das Ergebnis ist dem erstellenden Administrator zugeordnet, einmalig herunterladbar und höchstens 15 Minuten verfügbar. Temporäre Dateien werden nach dem Lesen/Abbruch oder Ablauf bereinigt. Neustarts können laufende Downloads verwerfen; dann ein neues Backup erstellen. Eine Erstellung gleichzeitig, maximal drei Starts pro Administrator/15 Minuten. Audit protokolliert Benutzer, Zeitpunkt, Ergebnis und Download ohne Verbindungsgeheimnisse.

Die Sicherung enthält die **App-Kundendatenbank**, einschließlich technischer Audit-/Sitzungsdaten. Keycloak-Passwörter/OTP, .env und Zertifikate liegen separat. Für eine vollständige Wiederherstellung weiterhin die gemeinsame Wartungssicherung beider Datenbanken aus Abschnitt 6 verwenden. Die lokale SQLite-Umgebung zeigt diese PostgreSQL-Aktion als nicht verfügbar an.

Das Dockerimage installiert den PostgreSQL-17-Client aus dem [offiziellen PGDG-Repository](https://www.postgresql.org/download/linux/debian/). PG_DUMP_PATH ist nur für eigene native Testinstallationen nötig. Credentials werden dem Prozess über libpq-Umgebungsvariablen übergeben, niemals in Befehlsargumenten, Browserantworten oder Rohfehlerlogs.

### Heruntergeladenen Dump vorab in separater Datenbank prüfen

Datei als backups/ui-backup.dump auf den Server übertragen (Pfad/Dateiname bewusst wählen), niemals in ein öffentliches Webverzeichnis. Diese Befehle legen nur die separate **kundenraum_restore_test** an; kein bestehender Kundenbestand wird überschrieben.

```bash
set -e
cd /opt/kundenraum
test -s backups/ui-backup.dump
sudo docker compose -f compose.server.yml exec -T db createdb -U postgres -O kundenraum kundenraum_restore_test
sudo docker compose -f compose.server.yml exec -T db pg_restore -U postgres --role=kundenraum --no-owner --no-acl --exit-on-error -d kundenraum_restore_test < backups/ui-backup.dump
sudo docker compose -f compose.server.yml exec -T db psql -U postgres -d kundenraum_restore_test -c 'SELECT COUNT(*) AS kunden FROM customers; SELECT payment_status, COUNT(*) FROM periods GROUP BY payment_status;'
sudo docker compose -f compose.server.yml exec -T db dropdb -U postgres kundenraum_restore_test
```

Existiert kundenraum_restore_test bereits, vorab prüfen, wem sie gehört; diese Anleitung löscht sie nicht ungeprüft vor dem Test. pg_restore --exit-on-error muss ohne Fehler abschließen, und Konten/Zahlungen gegen den erwarteten Snapshot prüfen.

### Bewusste Wiederherstellung der App-Datenbank

Diese Befehle **ersetzen den aktuellen Kundenbestand**. Vorher eine aktuelle Wartungssicherung erstellen und den beabsichtigten Dump prüfen. Keycloak und .env müssen zum Sicherungsstand passen; bei vollständigem Umzug Abschnitt 6 mit beiden Datenbanken verwenden.

```bash
set -e
cd /opt/kundenraum
test -s backups/ui-backup.dump
sudo docker compose -f compose.server.yml stop caddy web worker
sudo docker compose -f compose.server.yml up -d db
sudo docker compose -f compose.server.yml exec -T db dropdb -U postgres --if-exists --force kundenraum
sudo docker compose -f compose.server.yml exec -T db createdb -U postgres -O kundenraum kundenraum
sudo docker compose -f compose.server.yml exec -T db pg_restore -U postgres --role=kundenraum --no-owner --no-acl --exit-on-error -d kundenraum < backups/ui-backup.dump
sudo docker compose -f compose.server.yml exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d kundenraum -c 'DELETE FROM web_sessions; DELETE FROM oauth_attempts; DELETE FROM import_previews; DELETE FROM bulk_batches; UPDATE principals SET not_before=EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::bigint;'
sudo docker compose -f compose.server.yml run --rm migrate
sudo docker compose -f compose.server.yml up -d web worker caddy
sudo docker compose -f compose.server.yml ps
```

Danach neu anmelden und Konten, Historie, Zahlung, anonyme API-Verweigerung sowie Worker prüfen. Keine Benutzerpasswörter durch bootstrap zurücksetzen. [pg_dump/Custom-Format](https://www.postgresql.org/docs/17/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html).

## Einmaliges Update auf die Domain-/Import-Erweiterung

Auch ältere Installationen über die [aktuelle Update-Anleitung](UPDATE.md) aktualisieren. Bei unveränderter Domain ist kein erneuter Domain-Assistent erforderlich. Für spätere bewusste Domain-/HTTPS-Wechsel gilt [DOMAIN.md](DOMAIN.md).

## Kundenverwaltung: neue Arbeitsabläufe

[Erweiterte Installations- und Betriebsanleitung](WORKFLOWS.md): Migration vorhandener Daten, laufenden Keycloak-Realm abgleichen, 60 Minuten Inaktivität, öffentliche IP-Ausnahmen, Telegram-Zeitplanung, abgesicherte Web-Wiederherstellung und Kassiererrollen.
