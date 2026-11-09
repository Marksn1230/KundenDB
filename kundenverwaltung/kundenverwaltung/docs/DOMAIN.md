# Öffentliche Domain und Let’s Encrypt

Diese Anleitung gilt für **compose.server.yml** im inneren Projektverzeichnis /opt/kundenraum. Caddy bleibt der bestehende Reverse Proxy. Domain, Protokoll und Kontaktadresse stehen zentral in **.env**; die Vorlage ist **deploy/.env.example**.

| Einstellung | Bedeutung |
|---|---|
| APP_DOMAIN | Öffentlicher DNS-Hostname ohne Schema, Port oder Pfad, z. B. kunden.example.at |
| HTTPS_ENABLED | true: HTTPS und HTTP-Weiterleitung; false: ausschließlich HTTP |
| ACME_EMAIL | Kontaktadresse für Let’s Encrypt, bei HTTPS erforderlich |
| ACME_ENV | Optional: production (Standard) oder staging für wiederholte Ausstellungstests |
| SERVER_PUBLIC_IPS | Öffentliche Server-IP(s) für den DNS-Vergleich, mehrere mit Komma |

APP_URL und der OIDC-Issuer werden **beim Containerstart** aus APP_DOMAIN/HTTPS_ENABLED berechnet. Sie werden nicht zusätzlich in .env gepflegt. Der Keycloak-Client speichert seine Callback-URL separat; der Assistent gleicht ihn über identity-config ab. Ein späterer Wechsel braucht **keine Codeänderung, keinen Image-Neubau und keine Datenbankmigration**. Bei der erstmaligen Übernahme dieses Releases zuerst das aktualisierte Image bauen; siehe SERVER.md.

## DNS und Erreichbarkeit vorbereiten

Beim DNS-Anbieter einen **A-Eintrag** für die Domain auf die öffentliche IPv4 des Servers setzen. Für kunden.example.at in der Zone example.at üblicherweise: Typ A, Name kunden, Wert öffentliche Server-IP. AAAA nur setzen, wenn IPv6 zum selben Server tatsächlich funktioniert. Alte/falsche AAAA-Einträge entfernen. Bei NAT ist die öffentliche Adresse des Routers nötig, mit Portweiterleitung zum Caddy-Server.

TCP **80 und 443** müssen in Provider-Firewall, Host-Firewall und gegebenenfalls Router auf Caddy zeigen. PostgreSQL 5432 und Keycloak 8080 bleiben intern. Der Assistent erwartet direkte DNS-Einträge; bei einem vorgeschalteten CDN stimmen die DNS-IP-Adressen nicht mit dem Server überein. Für die einfache Einrichtung DNS-only verwenden oder die CDN-Konfiguration separat betreuen.

```bash
sudo apt update
sudo apt install -y dnsutils curl openssl
dig +short A kunden.example.at
dig +short AAAA kunden.example.at
dig @1.1.1.1 +short A kunden.example.at
dig @1.1.1.1 +short AAAA kunden.example.at
```

Die Einträge werden beim eigenen DNS-Anbieter geändert; ohne dessen Zugangsdaten kann das Projekt sie nicht selbst setzen. Bei Anbietern mit RFC-2136/TSIG kann deren nsupdate-Verfahren verwendet werden; andernfalls deren Portal oder CLI verwenden. Nach einem Wechsel DNS-TTL und Propagation abwarten.

## Interaktive Einrichtung

Voraussetzung: Docker Engine/Compose laufen, .env mit individuellen Geheimnissen ist eingerichtet, das aktuelle Webimage ist gebaut, beide Datenbanken sind gestartet/migriert und Keycloak samt persönlichem Administrator ist eingerichtet. Die exakten Erstinstallationsschritte stehen in SERVER.md.

```bash
cd /opt/kundenraum
chmod +x scripts/configure-domain.sh
sudo ./scripts/configure-domain.sh
```

Der Assistent fragt Hostname, HTTPS j/n, bei Bedarf ACME-Kontakt und öffentliche Server-IP(s) ab. Ohne Node.js auf dem Host verwendet er ein kurzlebiges offizielles Node-Containerimage; ein zusätzliches Host-Node ist nicht nötig. Alle Eingaben werden validiert. Vor Änderungen prüft er A und AAAA: fehlende Einträge, nicht passende Adressen und unerwartete alte IPv6-Adressen brechen ab. Dann zeigt er die geplante Konfiguration. Erst die ausdrückliche Antwort j schreibt .env.

Die ursprüngliche .env wird als **.env.domain-ZEITPUNKT-ZUFALL.bak** mit eingeschränkten Rechten gesichert. Sie enthält Geheimnisse und gehört nicht in Git oder Tickets. Andere .env-Werte bleiben erhalten. Der Assistent validiert Compose und die gewählte Caddy-Konfiguration und erstellt ausschließlich **keycloak, web und caddy** neu; **identity-config** aktualisiert den bestehenden Web-Login-Client. Datenbank und Worker werden nicht neu erstellt. Es erfolgt weder Build noch Migration.

identity-config benötigt einen gültigen internen Keycloak-Wartungszugang in KEYCLOAK_ADMIN_USER/PASSWORD. Ein deaktiviertes Bootstrapkonto reicht nicht. Clientsecret, Benutzer, Rollen, Passwörter und OTP bleiben erhalten; alte IdP-Sitzungen werden abgemeldet. Der gespeicherte Web-Callback lautet je nach Modus http(s)://DOMAIN/api/auth/callback, die erlaubte Origin entspricht exakt der App-URL. Separat konfigurierte iOS-/Fremdclient-Redirects bewusst separat prüfen; sie werden nicht pauschal überschrieben.

Nach dem Start prüft der Assistent Health, die aktuelle Login-Origin und bei HTTPS das tatsächlich präsentierte Zertifikat einschließlich **Ablaufdatum und Aussteller**. Bei Fehlern nennt er:

```bash
sudo docker compose -f compose.server.yml logs --tail=100 caddy
sudo docker compose -f compose.server.yml logs --tail=100 keycloak web
sudo ./scripts/configure-domain.sh --status
```

Die Statusprüfung wartet bis zu ungefähr zwei Minuten auf Start/Zertifikat. Ein erfolgreicher DNS-Vergleich beweist noch keine externe Portfreigabe. Bei NAT ohne Hairpin-Unterstützung zusätzlich von außerhalb des Servernetzes prüfen.

## Bestehende Domain auf HTTPS umstellen

```bash
cd /opt/kundenraum
sudo ./scripts/configure-domain.sh
```

Bestehende Domain mit Enter übernehmen, HTTPS mit j wählen, Kontaktadresse und öffentliche IP bestätigen, geplante Änderung mit j freigeben. Caddy verwendet **ausschließlich den ausdrücklich konfigurierten ACME-Issuer von Let’s Encrypt**. Es gibt keinen ZeroSSL-Fallback.

Caddy bezieht und verwaltet das Zertifikat, erneuert es automatisch vor Ablauf und verwendet erneuerte Zertifikate automatisch; ein separater Certbot-/Cron-/Reload-Dienst ist nicht nötig. Zertifikate, private Schlüssel und ACME-Konten liegen im persistenten **caddy-data**-Volume (/data), Konfigurationsdaten in caddy-config. Diese Volumes nicht löschen, auch nicht beim Domainwechsel. HTTP wird im HTTPS-Modus durch Caddy auf HTTPS umgeleitet. Für den HTTP-Modus wird ausdrücklich ein http://-Listener ohne TLS gewählt.

HTTPS_ENABLED=false deaktiviert auch Secure-Cookies/IdP-HTTPS-Pflicht für diesen ausdrücklich gewählten HTTP-Modus. Zugangsdaten und Datenverkehr sind dann unverschlüsselt; für produktive persönliche Anmeldungen HTTPS verwenden. Ein Browser, der bereits HSTS gespeichert hat, kann die alte Domain weiterhin automatisch auf HTTPS umleiten. Eine Rückkehr zu HTTP beseitigt diesen Browserzustand nicht; für einen absichtlichen HTTP-Test gegebenenfalls einen separaten Hostnamen nutzen.

## Späterer Domainwechsel

Zuerst die neue Domain beim DNS-Anbieter auf denselben Server zeigen lassen und A/AAAA prüfen. Danach:

```bash
cd /opt/kundenraum
sudo ./scripts/configure-domain.sh
```

Neue Domain eingeben, HTTPS j, Kontaktadresse/IP bestätigen und Änderung freigeben. Der Assistent liest die Laufzeitwerte neu ein und aktualisiert auch den gespeicherten Login-Callback. Ein bloßes docker compose restart genügt für neue Umgebungsvariablen nicht; deshalb verwendet er force-recreate. Weder Build noch Migration ausführen. Anschließend neue Domain im Browser öffnen, Passwort/MFA eingeben und Rücksprung nach /kunden prüfen.

## Staging für wiederholte Ausstellungstests

Nur eine öffentlich erreichbare **Testdomain** und fiktive Konten verwenden. Staging-Zertifikate sind in normalen Browsern nicht vertrauenswürdig. Keine Staging-Root in den normalen System-/Browser-Zertifikatsspeicher importieren.

```bash
cd /opt/kundenraum
sudo ./scripts/configure-domain.sh --acme-env staging
```

Der Assistent zeigt STAGING vor dem Bestätigen. Er verwendet ausschließlich **https://acme-staging-v02.api.letsencrypt.org/directory** und sichert die alte Konfiguration, bevor er ACME_ENV umstellt. Für den bewusst freigegebenen Produktivbetrieb:

```bash
sudo ./scripts/configure-domain.sh --acme-env production
```

Production verwendet https://acme-v02.api.letsencrypt.org/directory. Wiederholte Tests nicht gegen Production durchführen. Statusprüfungen in Staging kennzeichnen das nicht vertrauenswürdige Zertifikat ausdrücklich; in Production bleibt die Zertifikatsprüfung strikt.

## Kontrolle von Zertifikat, HTTPS und Login

DOMAIN durch den tatsächlichen Hostnamen ersetzen:

```bash
DOMAIN=kunden.example.at
curl --fail --silent --show-error "https://$DOMAIN/api/v1/health"
curl --silent --head "http://$DOMAIN/"
openssl s_client -connect "$DOMAIN:443" -servername "$DOMAIN" </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer -dates
curl --fail --silent --show-error "https://$DOMAIN/auth/realms/kundenraum/.well-known/openid-configuration"
curl --silent --output /dev/null --write-out '%{http_code}\n' "https://$DOMAIN/kunden"
curl --silent --output /dev/null --write-out '%{http_code}\n' "https://$DOMAIN/api/v1/customers"
```

Health 200, HTTP-Weiterleitung nach HTTPS, passende Zertifikatsdomain/Ablauf, neuer HTTPS-Issuer, /kunden → 307 zum Login und anonyme Kunden-API → 401. Danach im Browser das persönliche Passwort-/MFA-Login tatsächlich abschließen. Bei den Statusprüfungen keine Cookies oder Tokens in Logs kopieren.

## Zur vorherigen Domainkonfiguration zurückkehren

Der Assistent nennt den genauen Sicherungsnamen. Diesen Namen einsetzen:

```bash
cd /opt/kundenraum
sudo ./scripts/configure-domain.sh --restore .env.domain-2026-11-09T20-00-00.000Z-ab12cd.bak
```

Die vorige Domain muss weiterhin auf den Server zeigen. Der Assistent zeigt die Rückkehr an, prüft DNS, fragt erneut nach Bestätigung und sichert auch die aktuelle Konfiguration. Er stellt **die Domain-/HTTPS-/ACME-Werte** wieder her und lässt zwischenzeitlich geänderte Datenbank-/Anmeldesecrets unangetastet. Wieder dieselben betroffenen Dienste/Callbacks aktualisieren, anschließend Status/Login prüfen. Zertifikate im Volume bleiben erhalten.

Bei einem Fehler nach Übernahme der .env können Container unterschiedlich weit aktualisiert sein. Die ausgegebene Rückkehr verwenden oder den Fehler beheben und den Assistenten erneut ausführen; nicht die Datenbank oder den Realm löschen.

## Tatsächliche Abnahme

DNS-Abbruch, falsche/fehlende A-/AAAA-Einträge, Validierung, Bestätigung/Abbruch, Sicherung/Rückkehr und Zertifikatsstatus sind automatisiert geprüft. Die Caddy-Konfiguration wird mit echtem Caddy für Production, Staging und HTTP adaptiert; der bestehende HTTPS-Integrationstest verwendet eine isolierte interne Test-CA.

**Öffentliche Let’s-Encrypt-Ausstellung und tatsächliche Erneuerung wurden nicht durchgeführt.** Dafür fehlen eine bereitgestellte öffentliche Testdomain mit passenden A/AAAA-Einträgen und erreichbaren 80/443 sowie eine laufende Docker-Testumgebung. Aus der Caddy-Konfiguration folgt die automatische Erneuerung, sie wurde hier nicht als praktischer Erneuerungstest ausgegeben.

Quellen: [Caddy TLS/Issuer](https://caddyserver.com/docs/caddyfile/directives/tls), [Caddy Automatic HTTPS](https://caddyserver.com/docs/automatic-https), [Let’s Encrypt Staging](https://letsencrypt.org/docs/staging-environment/).
