# Lokale Abnahme

Stand: **09.11.2026**, Windows/PowerShell, Node.js **26.13.0**, Next.js **16.4.5**, echter lokaler Keycloak **26.8.2**. Tests verwenden fiktive Kundendaten, isolierte temporäre Datenbanken und kurzlebige Prüflogins. Persönliche Bestandskonten wurden nicht zurückgesetzt. Kein WhatsApp-/Telegram-Produktivversand wurde ausgelöst.

## Ausgeführt

| Prüfung | Ergebnis |
|---|---|
| npm run check | TypeScript ohne Fehler |
| NEXT_DIST_DIR=.next-verify npm run build | Produktionsbuild erfolgreich; separat vom laufenden Devserver |
| npm run api:export + Swagger Parser im HTTP-Test | OpenAPI 3.1 strukturell gültig, neue Modelle exportiert |
| NEXT_DIST_DIR=.next-verify npm test | **59 Tests bestanden**, 0 Fehler, 0 übersprungen (inklusive Untertests) |
| npm audit --audit-level=low | **0 bekannte Schwachstellen** im dokumentierten Lauf |
| docker compose --env-file deploy/.env.example -f compose.server.yml config --quiet | Serverkonfiguration ohne Fehler aufgelöst; Geheimnisse nicht ausgegeben |
| Frische PostgreSQL-Engine mit PGlite | Schema, SQL-Adapter, Kalenderdaten, freie Kennung, Importfreigabe, Zahlung und Rollback erfolgreich |
| SQLite-v4 → frische PostgreSQL-Engine | Nummern, IDs, Kennungen, Telefon und Zahlung erhalten; weiteres Konto erhält neue ID; nichtleeres Ziel wird abgewiesen |
| SQLite-Snapshot bei offener WAL-Verbindung | VACUUM INTO enthält aktuelle Daten; vorhandenes Ziel wird nicht überschrieben |
| npm run dev:full | Native lokale Identitätslaufzeit, Web und Worker gestartet; vorhandenes Konto maki erhalten |
| node scripts/verify-local-login.mjs | Echter integrierter Login, Passwort/OTP, Adminanlage/Reset, Sitzungswiderruf und Rücksprung erfolgreich |
| Chrome Desktop 1440 × 1000 | Login, Übersicht, Suche, Laufzeitvorschau, Importfreigabe, Reports |
| Chrome Smartphone 390 × 844 | Integriertes Login, Navigation, Übersicht, Kundenliste ohne horizontalen Seitenüberlauf |

PGlite ist eine echte eingebettete PostgreSQL-Engine. Damit wurden PostgreSQL-Schema und SQL geprüft, **kein PostgreSQL-Container**. Zusätzlich wurde der pg-Pool inzwischen gegen einen isolierten nativen PostgreSQL-17.11-Server per TCP geprüft. Die Docker-Netzverbindung bleibt mangels Engine auf dem Zielserver zu prüfen.

## Fachliche und sicherheitsrelevante Nachweise

- Kalenderlaufzeit einschließlich Monatsende, Schaltjahr und volle Rückstandsmonate.
- Serverseitige sechsstellige Nummer, erneute Erzeugung bei Kollision, Datenbank-Constraint.
- Bestehende Nummern, Stammdaten und Zahlungszeiträume bei Migration erhalten; alte Kundenfelder gezielt entfernt.
- Gemeinsamer Import mit drei Pflichtspalten, MAC-/Kennungsmodus, trim-/case-gerechtem Identitätsabgleich, manuellen Konflikten und allen vier Kategorien.
- Vorschau ohne Kundenschreibzugriff, neue Konten erst nach ausdrücklicher Auswahl, leere optionale Felder ohne Überschreiben.
- Erhaltene Zahlungswahl, frühere Korrektur/spätere Verlängerung, wiederholter Import ohne zusätzliche Kunden/Zeiträume/Statusänderungen.
- CSV-/XLSX-Datumszellen, führende Nullen, Dateigrenzen und Formelabweisung.
- Lokale österreichische Telefonnummern und explizite internationale Vorwahlen; freie Kennungen bleiben in derselben Spalte und ihrer Schreibweise.
- API anonym 401, falsche Rollen/Audience/MFA abgewiesen; Mitarbeiter dürfen weder Konten verwalten noch WhatsApp-Massenversand freigeben.
- Administrative Benutzeranlage mit temporärem Passwort, erzwungene Passwortänderung; Passwort fehlt in API-Antworten und Audit.
- Reset widerruft lokale Sitzung, ruft IdP-Logout auf und erhält OTP.
- Massenbezahlung betrifft aktuellen Zeitraum, überspringt Bezahlt und liefert gespeichertes Ergebnis bei Wiederholung.
- WhatsApp-Massenvorschau mit Ausschlüssen, Standardland und Vorlage; doppelte Freigabe erzeugt genau einen simulierten Transportaufruf.
- Produktivschalter aus, Testsendung ausschließlich an feste Testnummer; unklare Resultate und Versanddeduplizierung.
- Telegram-Gruppen, private Chat-ID und unabhängiger Schalter.
- Geschützter interner Link einschließlich Suche/Filter kehrt nach OIDC zurück; keine Kundenanfrage ohne Sitzung.
- Cookieattribute HttpOnly/SameSite=Strict, CSRF/Origin, Logout und Kontosperre geprüft.

## Zusätzliche Prüfung gegen echten lokalen Keycloak

Der Live-Test legt einen kurzlebigen Administrator über den lokalen IdP an. Nach Passwort und OTP verwendet dieser die **echte Anwendungs-API**, um einen Mitarbeiter mit initialem Passwort anzulegen. Dessen erste Anmeldung verlangt OTP-Einrichtung und Passwortwechsel; Reports sind zugänglich, administrative Settings liefern 403. Anschließend setzt der Testadministrator das Passwort neu: die vorhandene Mitarbeitersitzung liefert 401, das neue temporäre Passwort verlangt erneuten Wechsel, das vorhandene OTP bleibt verwendbar.

Auch Desktop-/Smartphone-Login im bestehenden Design und Rücksprung auf /kunden?provider=Art wurden geprüft. Die kurzlebigen Prüflogins und ihre lokalen Sitzungen/Principals wurden im finally-Block entfernt. Auditnachweise bleiben ohne Passwörter erhalten. Es wurden keine echten Kunden geändert. Bildnachweise liegen lokal unter test-results/login-integrated-desktop.png und login-integrated-mobile.png; weitere UI-Bilder enthalten ausschließlich isolierte Testdaten.

## Nicht lokal ausführbar / noch einzurichten

**Docker-Erstinstallation:** Docker CLI/Compose sind installiert, aber docker info erreicht keine Docker-Engine (fehlende docker_engine-Pipe). Win32_Processor meldet VirtualizationFirmwareEnabled=False und SecondLevelAddressTranslationExtensions=False. Daher wurden **kein** Dockerimage lokal gebaut und **keine** frischen Servercontainer gestartet. Die vollständige Linux-Installation, öffentliches TLS, Container-Healthchecks und PostgreSQL-Backup/Restore sind vorbereitet, aber auf dem Zielserver noch abzunehmen. BIOS-/Windows-Virtualisierung wurde nicht verändert.

**Produktionswerte:** eigene Domain/DNS, HTTPS-Erreichbarkeit 80/443, TLS-Kontakt und persönlicher erster Administrator. scripts/setup-server.mjs erzeugt individuelle Datenbank-, OIDC-, Session- und Erstzugangsgeheimnisse aus deploy/.env.example. Rechte, verschlüsselte externe Backups, Restore-Test und Monitoring auf dem Zielserver einrichten. Keine Standardpasswörter übernehmen.

**Versand:** echte WhatsApp-Business-Zugangsdaten, unterstützte Graph-Version, genehmigte dreiparametrige Vorlage (Name/Kundennummer/Serviceende), feste Testnummer und Einwilligungen fehlen. Telegram benötigt Bot-Token und private Chat-ID. Transporte sind automatisiert simuliert, echter Testversand und produktive Zustellung wurden nicht ausgeführt. Alle Produktivschalter bleiben standardmäßig aus.

**iOS:** kein nativer Client geliefert. OIDC-Client kundenraum-ios ist vorbereitet und deaktiviert; echte Bundle-/Universal-Link-Redirects, Systembrowser-/Schlüsselbundanbindung, Logout und Token-Erneuerung bleiben für das Folgeprojekt.

**Sicherheit:** umgesetzte Kontrollen siehe SECURITY.md. Keine unabhängige vollständige ASVS-Level-2-Zertifizierung; Zielserver-TLS, Last-/Fuzzprüfung, Recovery und externe Auditaufbewahrung bleiben offen.

## Abnahme Erweiterung 0.3 – 09.11.2026

Repository: Branch master, Tracking-Remote orgin/master (https://github.com/Marksn1230/KundenDB). Ausgangsstand dcc4359. Keine vorhandenen Arbeitskopieänderungen vor Beginn. Der GitHub-Standardbranch main wurde beim Fetch zusätzlich erkannt; umgesetzt wird auf dem bereits aktiven und verfolgten master.

Produktionsbuild .next-verify erfolgreich. Vollständige Suite: **41 bestanden, 0 Fehler, 0 übersprungen**. npm audit: 0 bekannte Schwachstellen. Server-Compose-Konfiguration mit APP_DOMAIN und individuellen Testgeheimnissen erfolgreich validiert.

Neue Nachweise: Benutzername/MAC identisch oder abweichend, individuelle MAC-Zustimmung serverseitig und im Browser, Sammelfreigabe ohne implizite Kennungsänderung, Fremdbelegung/Mehrdeutigkeit/Dateikonflikte, kein Treffer ohne Neuanlage, reiner Kennungswechsel ohne Zahlungsänderung, Wiederholbarkeit und Schutz gegen zwischenzeitliche Belegung. Kompakter Geldschein-/Häkchenbutton aktualisiert die sichtbare Zahlung und verschwindet nach Bezahlt. Zwei Domainwechsel gegen isolierten Keycloak-Verwaltungsfixture prüfen exakte Callback-/Origin-/Frontend-URLs und erhaltene übrige Konfiguration.

Echter PostgreSQL-17.11-Server auf Loopback mit zufälligem Passwort und temporärem Cluster, eigener Quell- und Restore-Datenbank. pg_dump-Custom-Datei aus der Admin-Session heruntergeladen, in zweite Datenbank mit pg_restore restauriert und fiktive Kunden-/Kennungs-/Zahlungsdaten verglichen. Zusätzlich UI-Button mit automatischem Download, andere Admin-Identität 404, Mitarbeiter 403, anonym 401, Bearer 403, Einmaligkeit, Audit, Ablauf und fehlende pg_dump-Binary geprüft. Keine DB-Credentials in Antworten/Audit. Der isolierte Cluster wird gestoppt und das neue Testverzeichnis bereinigt.

HTTPS-Prüfung mit echtem portablem Caddy 2.11.9: eigener HTTPS-Listener und /auth-Proxy, isolierte interne CA, keine Installation in den Windows-Zertifikatsspeicher. Node-HTTPS-Anfragen validieren die Zertifikatskette ausdrücklich gegen diese CA; der Headless-Browser akzeptiert sie nur im isolierten Testkontext. OIDC/PKCE-Anmeldung mit signiertem Testprovider hinter diesem Proxy und Secure-Cookie erfolgreich. Dies prüft kein öffentliches ACME-Zertifikat und keine produktive DNS-Umschaltung. Der echte lokale Keycloak-/MFA-Ablauf wurde separat geprüft und ist oben dokumentiert.

Realer Docker-Startversuch: docker compose --env-file .runtime/compose-test.env -p kundenraum-abnahme -f compose.server.yml up -d --build. **Blockiert**, bevor Containerstart/Build möglich ist: DockerDesktopLinuxEngine-Pipe fehlt; keine laufende Linux-Docker-Engine erreichbar. Keine BIOS-, Virtualisierungs- oder Docker-Konfiguration wurde verändert. APP_DOMAIN für einen echten Server und Provider-DNS-Zugang sind nicht vorgegeben; kein öffentlicher DNS-Eintrag wurde verändert. Die erreichbare lokale Ausweichumgebung wird mit npm run dev:full unter http://localhost:3000 gestartet. Sie erhält vorhandene SQLite-Kundendaten und persönliche Keycloak-Konten; der PostgreSQL-Backupbutton ist dort bewusst nicht verfügbar. Ein dauerhaftes PostgreSQL-/HTTPS-Serverdeployment muss nach Bereitstellung einer Docker-Engine erfolgen.

Neue Bildschirmnachweise: test-results/import-existing-desktop.png, test-results/backup-admin-https.png (ausschließlich fiktive Testdaten). Reproduzierbarer nativer Test: TEST_PG_BIN auf PostgreSQL-bin und TEST_CADDY_BINARY auf die Caddy-Datei setzen, anschließend NEXT_DIST_DIR=.next-verify npm test. Ohne Binaries wird der optionale Prozessintegrationstest ausdrücklich als übersprungen ausgegeben.

Abschließender lokaler Dienstcheck: Web-Health 200, anonyme Kunden-API 401, echtes Keycloak-Loginformular unter http://localhost:3000/auth erreichbar. Der lokale Starter prüft jetzt zusätzlich den absoluten Worker-Skriptpfad statt nur einer möglicherweise wiederverwendeten Windows-Prozess-ID. Worker neu gestartet, aktueller Heartbeat und erneuter Starteraufruf ohne Doppelstart geprüft.

## Abnahme: Domain-Assistent, 15-Tage-Fälligkeit und optionales Enddatum – 09.11.2026

Ausgangsbranch master, Ausgangscommit 2f9303c, Remote orgin/master. Produktionsbuild .next-verify und TypeScript erfolgreich. Vollständige Suite **59 Tests bestanden**, 0 Fehler, 0 übersprungen; npm audit meldet 0 bekannte Schwachstellen.

Neue Nachweise: Heute in Europe/Vienna einschließlich UTC-/Kalendertagswechsel, Grenze Tag 15 inklusive/Tag 16 ausgeschlossen, alle Abgelaufenen, Pagination/Gesamtzahlen, ausschließlich aktueller Zeitraum und Entfernen nach Verlängerung außerhalb des Fensters. Geschützte Fälligkeits-API, fehlendes Enddatum, Datum erstmals setzen ohne zusätzliche Historie, leere/fehlende Importspalte, ungültige Datumseingabe, eindeutiger Name-only-/MAC-only-Treffer, unabhängige Datum-/Namens-/MAC-Freigabe, Konflikt zwischen Konten, erneute Versionsprüfung und Import-Replay geprüft. Die Browserprüfung prüft die direkte Verlängerung aus der Übersicht, den Löschdialog mit Name/Nummer, Datum ohne Namensübernahme sowie die Neuanlage aus einer Zweispalten-CSV.

Domain-Assistent: Eingabevalidierung, Bestätigung/Abbruch, vollständige geschützte .env-Sicherung und Rückkehr unter Erhalt anderer Geheimnisse. Fehlende/falsche A-/AAAA-Einträge und Resolverfehler mit isolierten Resolver-Fixtures geprüft; es wurden keine öffentlichen DNS-Einträge geändert. Shell-Orchestrierung mit Test-Docker-Kommandos prüft Abbruch vor Neustarts und ausschließlich keycloak/identity-config/web/caddy im Erfolgsfall, ohne Build/Migration/Datenbank-/Worker-Neustart. Gemeinsames Shell-Environment für HTTP/HTTPS und Production/Staging tatsächlich unter Bash ausgeführt. Caddy 2.11.9 adaptiert die echten Caddyfiles: genau ein ACME-Issuer mit ausdrücklich gewähltem Let’s-Encrypt-Verzeichnis, Staging-URL und reiner HTTP-Modus. Keycloak-Callback/Origin/Frontend und SSL-Vorgabe für zwei HTTPS-Domains und eine HTTP-Domain gegen Verwaltungsfixture geprüft.

Weiterhin erfolgreich: echter nativer PostgreSQL-17.11-Dump und Restore in zweite Datenbank, Admin-Backupdownload, echter Caddy-HTTPS-Proxy mit isolierter interner CA, geschütztes Login mit signiertem Testprovider und Secure-Cookie. Diese lokale CA ist **kein Let’s-Encrypt-Ausstellungstest**.

**Öffentliche Let’s-Encrypt-Ausstellung und tatsächliche Erneuerung nicht getestet.** Es fehlt eine bereitgestellte öffentlich erreichbare Testdomain mit A/AAAA auf diesen Server und erreichbaren Ports 80/443; Docker ist weiterhin wegen fehlender DockerDesktopLinuxEngine-Pipe nicht verfügbar. Wiederholte Ausstellungstests sind ausdrücklich über --acme-env staging vorbereitet. Automatische Erneuerung und Verwendung erneuerter Zertifikate sind durch Caddy konfiguriert; das wurde nicht als tatsächlich beobachtete Erneuerung ausgegeben. Für eine spätere Abnahme Domain und Firewall/Docker bereitstellen, Staging ausstellen lassen, Status/Ablauf prüfen und anschließend gezielt auf Production umstellen.

Anleitungen: docs/DOMAIN.md (Ersteinrichtung, Aktivierung, Wechsel, Status, Staging und Rückkehr), docs/SERVER.md (Installation/Import), docs/API.md und docs/openapi.json. Vorlagen import-vorlage.csv/.xlsx und import-ohne-serviceende.csv sind aktualisiert und enthalten ausschließlich fiktive Daten. Keine Schema-Migration ist für diese Änderungen erforderlich; Bestandsdaten und persönliche Logins werden beibehalten.

Abschließender Dienstcheck dieses Stands: http://localhost:3000/api/v1/health → 200, neue Fälligkeits-API anonym → 401, echtes Keycloak-Loginformular unter http://localhost:3000/auth erreichbar, Worker-Heartbeat aktuell. Vorhandenes Konto maki wurde beibehalten.

## Abnahme der Kundenverwaltungs-Erweiterungen am 12.11.2026

Status: technische Abnahme erfolgreich; manuelle Anwenderfreigabe und anschließender Commit/Push stehen ausdrücklich noch aus. Branch: `master`; Ausgangscommit unverändert `cb4da6b`.

- `npm run check`, `npm run build`, Docker-Produktionsbuild: erfolgreich.
- `npm test`: **67 bestanden, 0 fehlgeschlagen, 0 übersprungen**. Einschließlich SQLite-Bestandsmigration und PostgreSQL-Bestandsmigration mit historischen Fälligkeiten, unveränderter Versandstunde, unzugeordneten neuen Feldern und Widerruf alter Websitzungen.
- `tests/acceptance-docker.mjs`: echte HTTPS-Anmeldung mit Keycloak 26.8.2; Administrator mit OTP; zwei Kassierer ohne OTP; eigene Listen; direkte Seiten und fremde API-Aufrufe gesperrt; aktuelle Zahlung, sofortiges Entfernen und idempotente Wiederholung.
- Anlegen und Bearbeiten: Außenklick, X und Escape mit/ohne Änderungen; Weiter bearbeiten erhält Eingaben; Zurücksetzen und Verwerfen geprüft.
- Web-Backup heruntergeladen und über denselben Webdialog hochgeladen, auf der separaten Restore-Instanz verarbeitet, ausdrücklich bestätigt, Sicherheitsbackup erstellt und Daten atomar ersetzt. Beschädigtes Archiv und über fünf Minuten alte Administrator-Anmeldung abgewiesen. Ein temporärer Datenbanktrigger erzeugte gezielt einen Fehler nach Beginn der Umschaltung: vorheriger Datenstand vollständig erhalten, Fehler auditiert, Wartungsmodus freigegeben. Testtrigger und Testfunktion anschließend entfernt.
- `tests/acceptance-security.mjs`: kontrollierte freigegebene IPv4-Quelladresse im isolierten, nicht gerouteten Testnetz; andere Adresse; gefälschte X-Forwarded-/Forwarded-/OTP-Header; direkter untrusted Keycloak-Zugriff; sofortiger Entzug nach Caddy-Reload. IPv6-Listenvalidierung zusätzlich im automatisierten Testsatz.
- Echte verkürzte Sitzung mit 3 Sekunden App-Inaktivität, 10 Sekunden Realm-/Client-Inaktivität und 1 Sekunde Access-Token: Refresh erfolgreich; Hintergrundabfragen verlängern die App-Inaktivität nicht; erneute Passwortanmeldung erforderlich. Effektive Einstellungen danach wieder 3600 Sekunden für Realm, Clients und Web; Token 900 Sekunden; leere öffentliche IP-Freigabeliste.
- `tests/acceptance-scheduler.mjs`: vier parallele PostgreSQL-Workerprozesse, zwei simulierte Tagesberichte, genau zwei Transporte; nach echtem Worker-Neustart keine Wiederholung. Sommerzeitlücke und doppelte Herbststunde im automatisierten Testsatz geprüft. Kein realer Versand; Produktivschalter anschließend ausgeschaltet.
- `identity-policy` gegen den laufenden Testrealm zweimal erfolgreich ausgeführt; vorhandene Benutzer und OTP-Anmeldungen bleiben verwendbar.

Isoliertes Compose-Projekt: `kundenraum-workflows-test`. Test-URL: **https://kundenraum.localhost**. Web, Worker, Keycloak, Caddy, Kundendatenbank, Identity-Datenbank und separate Restore-Datenbank bleiben gestartet. HTTP/HTTPS sind ausschließlich an Loopback gebunden. Das HTTPS-Zertifikat stammt aus der lokalen Caddy-Test-CA. Persönliche Bestandsdaten und die ursprüngliche `.env` wurden nicht für diese Testdatenbank verwendet.

Testrollen und Passwörter einschließlich Admin-TOTP-Schlüssel stehen ausschließlich lokal in `.runtime/workflows-access.txt`; keine Geheimnisse oder Dumps im Repository. Beide Kassierer haben zugewiesene offene Testkunden. Installations-, Realm-Abgleich-, Telegram- und Wiederherstellungsablauf einschließlich Rückkehr zum Sicherheitsbackup: [WORKFLOWS.md](WORKFLOWS.md).

Erst nach ausdrücklicher manueller Freigabe des Anwenders committen und zu `orgin/master` pushen. Bis dahin bleiben die Änderungen uncommitted.

## Nachbesserung während des manuellen Tests

Reports enthalten nun Als bezahlt markieren für offene aktuelle und historische Perioden, auch ohne Fälligkeitsdatum. Kassierer sehen responsive Kundenkarten mit Telefon, MAC/Kennung, Adresse/PLZ, Punkten, Service- und Zahlungsdaten sowie Kommentar. Auf ausdrücklichen Anwenderwunsch bleiben Punkte unverändert; kein Preisfeld und keine weitere Migration. Die Verlängerungsvorschau zeigt die berechnete Fälligkeit statt des Beginns.

Produktionsbuild, Docker-Build und alle 68 Tests erfolgreich, darunter Browserprüfungen der Report-Zahlungen und Verlängerungsfälligkeit. tests/acceptance-reports-cashier.mjs prüfte mit echtem Keycloak im laufenden Docker-Testprojekt die historische Zahlungsaktion, vollständige Kundendaten, Punkte 0, die Handyansicht ohne Überlauf und unveränderte Zuweisungsbeschränkungen. Für beide Kassierer bleiben offene Beispielkunden mit vollständigen Daten verfügbar. Die vom Anwender gewünschte lokale 2FA-Ausnahme bleibt über .runtime/manual-2fa.yml aktiv; die verwaltete öffentliche Produktionsliste bleibt leer. Weiterhin kein Commit/Push vor der manuellen Freigabe.

## Freigabe und Vorbereitung der GitHub-Auslieferung

Der Anwender hat Commit und Push nach dem manuellen Test ausdrücklich freigegeben. Abschließend: TypeScript-Prüfung, Produktionsbuild und alle 69 Tests bestanden, einschließlich des verzögerten Keycloak-Starts und des wiederholbaren Realm-Abgleichs. Docker-Build erfolgreich. Alle sieben Bash-Befehlsblöcke der neuen Update-Anleitung syntaktisch geprüft. [UPDATE.md](UPDATE.md) beschreibt die Aktualisierung einer laufenden bisherigen GitHub-Version mit unveränderter .env, gesichertem Altimage, gemeinsamer Wartungssicherung beider Datenbanken, Migration, Realm-Abgleich, Aktivierung und Rückkehr. Lokale Testzugänge und die ausdrücklich gewünschte lokale 2FA-Ausnahme verbleiben ausschließlich in ignorierten Laufzeitdateien. Die öffentliche verwaltete IP-Liste wird leer ausgeliefert.
