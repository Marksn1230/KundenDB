# Lokale Abnahme

Stand: **09.11.2026**, Windows/PowerShell, Node.js **26.13.0**, Next.js **16.4.5**, echter lokaler Keycloak **26.8.2**. Tests verwenden fiktive Kundendaten, isolierte temporäre Datenbanken und kurzlebige Prüflogins. Persönliche Bestandskonten wurden nicht zurückgesetzt. Kein WhatsApp-/Telegram-Produktivversand wurde ausgelöst.

## Ausgeführt

| Prüfung | Ergebnis |
|---|---|
| npm run check | TypeScript ohne Fehler |
| NEXT_DIST_DIR=.next-verify npm run build | Produktionsbuild erfolgreich; separat vom laufenden Devserver |
| npm run api:export + Swagger Parser im HTTP-Test | OpenAPI 3.1 strukturell gültig, neue Modelle exportiert |
| NEXT_DIST_DIR=.next-verify npm test | **33 Tests bestanden**, 0 Fehler, 0 übersprungen (inklusive Untertests) |
| npm audit --audit-level=low | **0 bekannte Schwachstellen** im dokumentierten Lauf |
| docker compose --env-file deploy/.env.example -f compose.server.yml config --quiet | Serverkonfiguration ohne Fehler aufgelöst; Geheimnisse nicht ausgegeben |
| Frische PostgreSQL-Engine mit PGlite | Schema, SQL-Adapter, Kalenderdaten, freie Kennung, Importfreigabe, Zahlung und Rollback erfolgreich |
| SQLite-v4 → frische PostgreSQL-Engine | Nummern, IDs, Kennungen, Telefon und Zahlung erhalten; weiteres Konto erhält neue ID; nichtleeres Ziel wird abgewiesen |
| SQLite-Snapshot bei offener WAL-Verbindung | VACUUM INTO enthält aktuelle Daten; vorhandenes Ziel wird nicht überschrieben |
| npm run dev:full | Native lokale Identitätslaufzeit, Web und Worker gestartet; vorhandenes Konto maki erhalten |
| node scripts/verify-local-login.mjs | Echter integrierter Login, Passwort/OTP, Adminanlage/Reset, Sitzungswiderruf und Rücksprung erfolgreich |
| Chrome Desktop 1440 × 1000 | Login, Übersicht, Suche, Laufzeitvorschau, Importfreigabe, Reports |
| Chrome Smartphone 390 × 844 | Integriertes Login, Navigation, Übersicht, Kundenliste ohne horizontalen Seitenüberlauf |

PGlite ist eine echte eingebettete PostgreSQL-Engine. Damit wurden PostgreSQL-Schema und SQL geprüft, **kein PostgreSQL-Container und keine TCP-Verbindung eines laufenden pg-Pools**. Der separate Pool verwendet denselben SQL-Adapter; dessen Docker-Netzverbindung bleibt auf dem Zielserver zu prüfen.

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
