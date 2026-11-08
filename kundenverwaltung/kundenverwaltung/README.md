# Kundenraum

Deutschsprachige Kundenverwaltung mit Next.js 16.4.5, TypeScript, OIDC/Keycloak, gemeinsamen CSV-/XLSX-Importen, Reports und optionalen WhatsApp-/Telegram-Nachrichten. Der vorhandene Stack wurde weiterverwendet. Lokal bleiben bestehende SQLite-Daten erhalten; für den Linux-Server gibt es PostgreSQL und eine kontrollierte Übernahme. Weboberfläche und /api/v1 nutzen dieselben Geschäftsregeln.

## Lokal unter Windows starten

Node.js 26 und npm erforderlich. Im **inneren Projekt**:

```powershell
cd C:\Users\Maki\Documents\KundenDaten\kundenverwaltung\kundenverwaltung
npm ci
npm run setup
npm run migrate
npm run dev:full
```

http://localhost:3000 öffnen. Ausschließlich localhost verwenden, damit OIDC, Origin und Cookies übereinstimmen. dev:full startet den echten lokalen Keycloak mit portabler Java-Laufzeit, Next.js und Worker im Hintergrund. Beim ersten Lauf benötigt es Internet für überprüfte Java-/Keycloak-Downloads. Bestehende persönliche Konten bleiben erhalten. Ein neuer persönlicher lokaler Erstzugang steht ausschließlich in **.runtime/dev-access.txt**; Passwort nicht protokollieren oder weitergeben. Beim ersten Login Passwort ändern und Authenticator einrichten. Es gibt keinen Authentifizierungs-Bypass.

Die Anmeldung erscheint im Kundenraum-Design unter derselben Origin /auth. Passwort und OTP verarbeitet weiterhin Keycloak. Geschützte interne Links führen nach erfolgreicher Anmeldung zur ursprünglichen Seite. Kunden werden vor Authentifizierung weder geladen noch angezeigt. Bei nicht erreichbarem Provider erscheint eine verständliche Fehlerseite mit erneutem Anmeldestart.

.runtime/processes.json enthält die eigenen Prozess-IDs; Logs stehen in .runtime/web.log, keycloak.log und worker.log. Der portable Starter ist ausschließlich für lokale Entwicklung. Auf Linux die [Serveranleitung](docs/SERVER.md) mit **compose.server.yml** verwenden; die ältere docker-compose.yml ist keine Produktionskonfiguration.

## Benutzer und Rechte

Einstellungen → Login-Konten → **Benutzer anlegen**: Benutzername, Rolle und initiales Passwort (mindestens 15 Zeichen). Die nächste Anmeldung verlangt ein eigenes Passwort und MFA. **Passwort neu setzen** verwendet ein temporäres Passwort und widerruft bestehende Sitzungen; OTP bleibt erhalten. Passwörter erscheinen weder in Antworten noch Auditdaten. Keine öffentliche Registrierung, kein Einladungsversand erforderlich.

| Funktion | Mitarbeiter | Administrator |
|---|---|---|
| Kunden lesen/anlegen/bearbeiten/verlängern, Zahlung ändern | Ja | Ja |
| Import prüfen/freigeben, Reports | Ja | Ja |
| Massenaktion bezahlt | Ja | Ja |
| Löschen mit Bestätigung | Nein | Ja |
| WhatsApp-Massenversand, Integrationen, Testversand | Nein | Ja |
| Login-Konten, Audit-/Versandprotokolle | Nein | Ja |

Marko, Mirko und Satem sind Servicezuordnungen und verleihen keine Berechtigung. Jeder API-Aufruf prüft serverseitig Authentifizierung und Rolle; Administratoren benötigen MFA-ACR 2. Der mitgelieferte Realm erzwingt Passwort plus OTP für alle persönlichen Logins.

## Kunden und Import

Neue Kundennummern werden serverseitig als sechs Zeichen A–Z/0–9 erzeugt, per UNIQUE gesichert und bei Kollision erneut versucht. Bestehende Nummern bleiben erhalten. Servicezeiten sind reine Kalenderdaten; Monatsende wird gekappt (31.01.2026 + 1 Monat = 28.02.2026). Importierte Enddaten bleiben bei anderen Änderungen erhalten. Verlängerungen bewahren den bisherigen Zeitraum samt Zahlungsstatus; Fälligkeit ist regulär der neue Servicebeginn.

Telefon akzeptiert lokale und internationale Schreibweisen. Einstellungen → Standardland steht zunächst auf AT. Eindeutige Nummern werden international gespeichert; unklare Eingaben bleiben als Stammdaten erhalten und werden vom Versand ausgeschlossen. **MAC-Format prüfen** speichert den Modus pro Kunde; ohne Prüfung bleiben freie Kennungen einschließlich Groß-/Kleinschreibung in derselben Spalte erhalten.

Die Kundenliste zeigt Telefon, Zahlungs- und Servicestatus getrennt. Je Zeile bezahlt setzen oder mehrere Konten auswählen; Seitenauswahl und Anzahl sind sichtbar. Massenaktionen verlangen eine Vorschau/Bestätigung und zeigen erfolgreich/übersprungen/fehlgeschlagen. Bereits bezahlte Zeiträume bleiben unverändert.

Ein gemeinsamer Import verarbeitet CSV und XLSX. Pflicht: **Name, MAC-Adresse, Serviceende**. Unterstützte optionale Spalten und genaue Formate stehen direkt im Dialog und in der [Server-/Importanleitung](docs/SERVER.md#7-gemeinsamer-csv-xlsx-import). [CSV-Vorlage](public/examples/import-vorlage.csv), [Excel-Vorlage](public/examples/import-vorlage.xlsx) enthalten fiktive Daten. UTF-8; Semikolon/Komma (auch Tab) erkannt; Datum TT.MM.JJJJ oder echte Excel-Datumszelle. Telefon/PLZ als Text erfassen.

Name und MAC/Kennung dienen **gemeinsam** dem Abgleich; freie Kennungen unterscheiden Groß-/Kleinschreibung, Namen nicht. Vorschau: Bereits vorhanden, Serviceende geändert, Neu, Prüfung erforderlich. Fehlende/mehrdeutige Identitäten erfordern Korrektur oder manuelle Zuordnung. Neue Konten benötigen aktive Auswahl und Freigabe. Leere optionale Felder überschreiben nichts; drei Pflichtspalten reichen für Neuanlagen mit Unbekannt/zu ergänzen. Zahlungswahl bei Änderungen standardmäßig beibehalten. Erneute Daten erzeugen keine Duplikate/zusätzlichen Zeiträume. Versionskonflikte verlangen eine neue Vorschau.

## Datenbank und Migration

Ohne DATABASE_URL: SQLite unter DATABASE_PATH, standardmäßig data/kunden.sqlite; keine Datei auf Netzlaufwerken und keine verteilten Schreibinstanzen. Mit DATABASE_URL: PostgreSQL mit pg-Pool, explizitem Schema und serialisierten Geschäftsänderungen. Serverdaten werden als DATE gespeichert, keine Zeitzonen-Umdeutung.

```powershell
npm run migrate
npm run snapshot:sqlite -- --output transfer/kunden.sqlite
```

Vor Bestandsmigration Web/Worker stoppen und eine geprüfte Sicherung erstellen. SQLite-Migrationen sichern bestehende Dateien vor v2/v4, übernehmen Kundennummern, Stammdaten und Zahlungszeiträume, entfernen gezielt die alten Kundenfelder Erstellungsdatum und Art bezahlt. Technische Audittimestamps bleiben. v3 ergänzt Importbelege, v4 MAC-Modus, Standardland, Rücksprung und Massenfreigaben. Kein Löschen anderer Zahlungsinformationen. Historisch ungültige MAC-Werte werden zur Prüfung im Kommentar erhalten.

PostgreSQL-Migrationen: migrations/postgres. **npm run migrate** vor den Schreibdiensten ausführen. SQLite→PostgreSQL über npm run migrate:sqlite-to-postgres nur auf leerem Ziel; genaue Schritte und Rücksicherung in [SERVER.md](docs/SERVER.md). Persönliche Keycloak-Konten werden separat im Identity-DB-Backup erhalten. Vorschauen und Sitzungen sind absichtlich nicht übertragbar.

## API und spätere iOS-App

[API-Anleitung](docs/API.md), [OpenAPI](docs/openapi.json), live /api/v1/openapi.json. Kunden, Suche, kombinierte Filter, Pagination, Details/Änderungen, Verlängerung/Zahlung, Reports, Import und Massenaktionen liegen unter /api/v1. Schreibende Browseraufrufe benötigen Sitzung, passenden Origin und X-CSRF-Token. Native Clients verwenden Bearer-Access-Tokens mit Zielgruppe kundenraum-api und aktiver Introspection.

Der vorbereitete öffentliche Client **kundenraum-ios** bleibt deaktiviert. Vor Aktivierung: echte Bundle-ID/Universal-Link-Redirect registrieren, exakte Redirect-URI und Logout-Ziele erlauben, API-Audience und mitgelieferten MFA-Flow prüfen. Authorization Code + PKCE S256 über ASWebAuthenticationSession/Systembrowser, kein Clientsecret oder Passwortgrant. Access-/Refresh-Tokens ausschließlich im iOS-Schlüsselbund, Refresh-/Logout-/Widerrufspfad implementieren. Keine native App in diesem Projekt.

## Benachrichtigungen

Alle Produktivschalter standardmäßig aus. Offizielle WhatsApp Business Platform, genehmigte Vorlage und dokumentierte Einwilligung erforderlich. .env benötigt WHATSAPP_API_VERSION, TOKEN, PHONE_ID, TEMPLATE, LANGUAGE und feste TEST_NUMBER. Testversand verwendet ausschließlich die Testnummer und funktioniert unabhängig vom Produktivschalter. Massenversand nutzt dieselben aktuellen Prüfungen und protokollierten eindeutigen Sendungen; unklare Resultate verlangen manuelle Prüfung vor Wiederholung.

Telegram separat aktivieren; TELEGRAM_BOT_TOKEN und private TELEGRAM_CHAT_ID setzen. Tägliche Gruppen: demnächst, heute, seit letztem Bericht abgelaufen. Worker plant Europe/Vienna. [Genaue Einrichtung](docs/SERVER.md#versand-einrichten).

## Prüfen und betreiben

```powershell
npm run api:export
npm run check
npm run build
npm test
npm audit
```

Für isolierte Builds neben laufendem Devserver NEXT_DIST_DIR=.next-verify setzen; denselben Wert für HTTP-Tests verwenden. Tests verwenden ausschließlich fiktive Daten und separate temporäre Datenbanken. [Prüfprotokoll](docs/VERIFICATION.md) und [ASVS-Kontrollen](docs/SECURITY.md) unterscheiden lokale Nachweise und ausstehende Zielserver-/Integrationsprüfungen. HTTPS, Domain, Backups und echte Versandzugänge müssen für Produktion eingerichtet werden.
