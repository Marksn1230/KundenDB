# Lokaler Entwicklungsbetrieb unter Windows

Start aus dem geöffneten Workspace: `npm run dev:full`.

- Anwendung: http://localhost:3000
- Keycloak: http://localhost:8080
- Persönlicher Login: **maki**
- Individuelles temporäres Passwort: `.runtime/dev-access.txt` im inneren Projektordner.
- Erster Login: eigenes Passwort (mindestens 15 Zeichen) wählen, Authenticator einrichten, OTP bestätigen.
- `bootstrap` ist ausschließlich der Zugang zur Keycloak-Admin-Konsole; die Verwaltungsanwendung nutzt das persönliche Konto.

Der Starter installiert beim ersten Aufruf eine projektlokale Java-25-Distribution und Keycloak 26 mit SHA-256-Prüfung. Keine Windows-Installation, kein Docker und keine Virtualisierung nötig. Der lokale Keycloak nutzt eine eigene persistente H2-Entwicklungsdatenbank. Die Kundendaten bleiben in der bisherigen SQLite-Datei. Ein vorhandener Dev-Webserver wird wiederverwendet. Sonst startet ein eigener Server mit separatem Buildverzeichnis `.next-dev`. Java/Worker laufen im Hintergrund weiter; erneutes `npm run dev:full` erkennt laufende Dienste.

Nur in diesem lokalen Realm ist E-Mail-Verifikation ausgeschaltet, damit der erste Login ohne SMTP funktioniert. Passwort und OTP bleiben erforderlich. Einladungs-/Reset-E-Mails benötigen weiterhin SMTP. Produktivtemplate, Rollenprüfungen, CSRF und Versandfreigaben bleiben aktiv.

Logs: `.runtime/keycloak.log`, `.runtime/worker.log`, bei einem vom Starter gestarteten Webserver `.runtime/web.log`; beim bereits laufenden `npm run dev` dessen Terminal und `.next/dev/logs/next-development.log`. Prozess-IDs stehen in `.runtime/processes.json`. Geheimnisse und Laufzeiten sind von Git ausgeschlossen.

Liveprüfung mit kurzlebigem Testkonto: `node scripts/verify-local-login.mjs`. Prüft echten Passwort-/OTP-Login, OIDC-Rücksprung, Administratorrolle, geschützte Einstellungen und die Service-Account-Berechtigung. Danach wird ausschließlich das eigene Prüfkonto entfernt.

Bei ausgefallenem Keycloak zeigt die Loginseite einen verständlichen Hinweis. Nach Neustart des Dienstes funktioniert ein neuer Versuch ohne Neustart der Webanwendung.

Keycloak-Konfiguration: Der Scope `basic` liefert die notwendige Benutzerkennung `sub`. API-Zielgruppe `kundenraum-api` und Introspection-Client `kundenraum-web` werden als getrennte Audience-Mapper ausgegeben. Der Management-Audience-Resolver ergänzt nur Zielgruppen, für die der Benutzer tatsächlich Clientrollen hat; damit kann der technische Service-Account die ihm zugewiesene Login-Verwaltung aufrufen.

Keycloak 26.8 verlangt für Management-Aufrufe zusätzlich den optionalen Scope `kc-admin-api`; ausschließlich der serverseitige Client-Credentials-Aufruf fordert ihn an. Der mitgelieferte Compose-Dienst ist auf die getestete Version 26.8.2 gesetzt.
