# Sicherheitskontrollen und Prüfstand

Bezugsrahmen: [OWASP ASVS 5.0.0](https://owasp.org/www-project-application-security-verification-standard/), Zielniveau **Level 2**. Die Tabelle dokumentiert umgesetzte Bereiche und ihre Nachweise. Sie ersetzt keine vollständige Prüfung sämtlicher ASVS-L1-/L2-Einzelanforderungen und keine unabhängige Sicherheitsabnahme.

## Schutzmodell

Alle persönlichen Verwaltungslogins sehen denselben Kundenbestand. Es gibt keine Mandanten- oder Besitzerbeschränkung aus der Zuordnung Marko/Mirko/Satem. Mitarbeiter dürfen fachliche Kundenaktionen, Importfreigaben und Reports ausführen; Administratoren zusätzlich Löschungen, Identitätsverwaltung, Integrationen und Protokolle. Server- und Datenbankadministratoren gehören zur Vertrauensgrenze. Gegen deren direkten Zugriff schützt die Anwendungsrolle nicht.

Eingaben aus Browser, Dateien und späteren mobilen Clients sind nicht vertrauenswürdig. Wichtige Risiken sind unberechtigte Änderungen, Import-Verwechslungen, doppelte Zeiträume/Zahlungsänderungen, veraltete Freigaben und ungewollter Nachrichtenversand. Die serverseitigen Domänenfunktionen werden über eine gemeinsame, geschützte API aufgerufen.

| Kontrollbereich | Umsetzung | Lokal geprüft / ausstehend |
|---|---|---|
| Persönliche Identitäten, kein Defaultkonto | OIDC über `openid-client`, administrative Anlage mit temporärem Passwort; keine öffentliche Registrierung oder lokale Passwortannahme | PKCE-Callback mit signiertem Test-ID-Token im HTTP-/Browsertest; echte Login-/Passwortwechsel-/OTP-Prüfung siehe VERIFICATION.md |
| Passwortsicherheit und Recovery | Keycloak übernimmt Passwörter und Argon2-Hashing; 15 Zeichen Mindestlänge; temporäre Passwörter erzwingen Änderung beim nächsten Login | Realm-Konfiguration geprüft; administrative Vergabe/Reset und Sitzungswiderruf automatisiert geprüft |
| MFA | Verpflichtender Passwort-/OTP-Browser-Flow ohne alternative Ausführung. ACR 2 ist nur an diesen festen Flow gebunden; Admin-API-Zugriffe weisen ACR ohne 2 zurück | Admin ohne MFA-Claim → 403; echte OTP-Einrichtung, Recovery und Umgehungsversuche im Ziel-IdP noch prüfen |
| Brute-Force-/Rate-Schutz | Keycloak Login-Sperrpolitik, Anmeldestart-/Anlage-/Reset-Limits in der gemeinsamen Datenbank; keine öffentliche Resetfunktion | Konfiguration und serverseitige Funktionen; Last-/verteilte Angriffe am produktiven Reverse Proxy noch prüfen |
| OAuth-Integrität | Authorization Code + PKCE S256, State an HttpOnly-Transientcookie gebunden, Nonce, fünf Minuten Gültigkeit, einmaliges Verbrauchen; kanonische Redirect-URI | Echte PKCE-Prüfung im isolierten Testprovider und kompletter Browser-Rücksprung |
| Tokenprüfung | Introspection auf **jedem** geschützten Aufruf, aktive Identität, Audience und Rolle erforderlich, keine Freigabe bei Providerfehler | Falsches Token, Audience, Rolle, Admin-ACR und gesperrtes Konto getestet |
| Sitzungen | Zufälliges 256-Bit-Cookie, in DB nur Hash des Sitzungsschlüssels, Access-Token mit AES-256-GCM verschlüsselt; HttpOnly, SameSite=Strict, Secure bei HTTPS; maximal Access-Token-Laufzeit | Cookieattribute, CSRF und Logout/Widerruf getestet; Secure/HTTPS im tatsächlichen TLS-Deployment noch prüfen |
| Widerruf und Rollenwechsel | Lokale Sperre und `not_before`-Grenze für alle Clients, Websitzungen löschen, IdP-Logout bei Sperre/Reset/Rollenwechsel. Eigene Sperre/Rollenänderung gesperrt; eigener Reset meldet ab | Sofortiger lokaler Widerruf und Kontosperre im HTTP-Test; IdP-Logout-/Resetwirkung gegen echten Provider noch prüfen |
| CSRF | Schreibende Cookieaufrufe brauchen exakten Origin aus APP_URL und zufälliges Sitzungstoken als Header; kein CORS-Relaxing; Bearer-Clients bleiben ohne Cookie-/CSRF-Abhängigkeit | Fehlender Token oder fremder Origin → 403; korrekte Anfrage → 200 |
| Autorisierung | Zentraler `authorize`-Aufruf pro geschütztem API-Aufruf, Administratorprüfung vor Bodyverarbeitung für sensible Bereiche; keine Rechte aus Kundenzuordnung | Anonym alle Datenbereiche → 401, Mitarbeiter Settings/Audit/Users/Löschen → 403 |
| Eingabevalidierung und Injection | Strikte Zod-Modelle, allowlisted Felder, SQL-Parameterbindung, React-Textescaping; keine HTML-Interpretation aus Kommentaren/Dateien | Fremde Kundennummer im PATCH abgewiesen, Filtergrenzen, Datums-/MAC-Validierung und Versionen getestet |
| Import und Upload | Typ-/Datei-/Zeilen-/Zellgrenzen, UTF-8, keine Formeln/Links/Fehlerzellen, entpackte Größenbudgetprüfung vor XLSX-Verarbeitung; keine Ausführung von Dateiinhalten | CSV/XLSX, führende Nullen, Datum, Formelabweisung und Dateigröße getestet; zusätzliche ZIP-Fuzz-/Ressourcenprüfungen vor öffentlichem Betrieb empfohlen |
| Fachliche Integrität | Serverseitige Nummernerzeugung plus UNIQUE, Transaktionen, Versionsvergleich, Preview an Login gebunden, Identitätsabgleich über beide Felder; Import-Belege und atomare Freigaben | Kollisionswiederholung, Constraint, alle Importkategorien, Erstfreigabe, Replay, Rollback und erhaltene Periodenzahlung getestet |
| Ausgehender Versand | Produktivschalter standardmäßig aus; Einwilligung, aktuelles Ende und Ziel unmittelbar erneut prüfen; festes separates Testziel; atomare eindeutige Versandbelege | Produktiv aus/Test an feste Nummer, Produktivdeduplizierung und unklarer Timeout ohne Wiederholung getestet |
| Kryptografie und Geheimnisse | Sichere Zufallsgeneratoren, TLS für Produktion, keine Token in Fehlertexten/Logs, Schlüssel ausschließlich in Umgebung, lokale .env ignoriert; AEAD für gespeicherte Webtokens | Audit-/Fehlerpfade geprüft; Schlüsselmanagement, Backups und OS-Rechte im Zielsystem noch abnehmen |
| Audit | Benutzer/technischer Actor, UTC-Zeitpunkt, Aktion und fachliche Änderungen; Sicherheitsverweigerungen, Importe, Löschungen, Verlängerungen und Zahlungen; API-Zugriff nur Admin | Ereignisse und Logschutz getestet. Manipulationssicheren externen Logexport, Aufbewahrung und Zugriffstrennung vor Produktion betreiben |
| Browserhärtung | CSP mit frischem Skript-Nonce, `strict-dynamic`, kein `unsafe-eval` in Produktion; keine Frames/Objekte; Style-Inline nur für dynamische Diagramme; Nosniff, Frame-Deny, Permissions-Policy, Referrer-Policy | Produktionsbrowserabläufe ohne JavaScript-Fehler; TLS/HSTS am Reverse Proxy prüfen. CSS erlaubt `unsafe-inline`, Skripte nicht |
| Abhängigkeiten | Lockfile, gezielte Overrides für gepatchte transitive uuid-/minimatch-Versionen; kein erzwungener Framework-Downgrade | `npm audit` im dokumentierten Lauf ohne bekannte Funde; regelmäßige Wiederholung erforderlich |

## Deployment-Prüfungen vor Freigabe

1. In Keycloak Browser-Flow, OTP-Pflicht, Admin-ACR-Bindung, deaktivierte öffentliche Registrierung/Direct Grants und beschränkte Redirect-URIs im echten Login prüfen. Der feste ACR-Mapper darf nur mit dem mitgelieferten obligatorischen MFA-Flow verwendet werden.
2. Administrative Vergabe und Reset im Ziel-IdP prüfen: temporäres Passwort, erzwungener Wechsel, erhaltene OTP-Geräte und Sitzungswiderruf. Änderungen außerhalb der App mit IdP-Sitzungslogout kombinieren.
3. Produktive TLS-/Proxy-Konfiguration, Hostnamen und HSTS prüfen. `ALLOW_LOCAL_HTTP=false`; Keycloak produktiv statt im Development-Modus betreiben. Clientsecret, Sessionkey und Service-Account-Rechte beschränken.
4. Datenbank-/Volume-ACL, verschlüsselte Backups, Wiederherstellungstest, externe Audit-Aufbewahrung, Monitoring und Updateprozess einrichten. Altes Anwendungsrelease darf nicht parallel auf das neue Schema schreiben.
5. Last-, Fuzz-, Barrierefreiheits- und unabhängige ASVS-L2-Abnahme auf der Zielumgebung durchführen. Diese Prüfungen wurden nicht als erledigt ausgegeben.

Referenzen: [Keycloak-Administration einschließlich MFA und Passwortpolitik](https://www.keycloak.org/docs/latest/server_admin/index.html), [Realm-Import und Umgebungsvariablen](https://www.keycloak.org/server/importExport), [openid-client](https://github.com/panva/openid-client), [Telegram Bot API](https://core.telegram.org/bots/api), [offizielle WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/).

## Erweiterung November 2026

Anmeldung unter derselben Origin im vorhandenen Layout; keine Passwortannahme durch die App und kein Passwortgrant für persönliche Logins. Validierte interne Rücksprünge, Sitzungskontrolle vor Kundendatenzugriff. Administrative Vergabe/Reset ohne Passwort in Antwort oder Audit. Massenfreigaben sind login- und versionsgebunden; WhatsApp verlangt Admin und alle bestehenden Versandprüfungen. PostgreSQL nutzt Nicht-Superuser-Rollen, explizite Migrationen und gemeinsame Transaktionssperren. Nur Caddy veröffentlicht Ports, IdP-Admin/Master bleiben intern. Container-Neuinstallation, TLS, Restore und unabhängige vollständige ASVS-L2-Abnahme bleiben Zielserveraufgaben.

## Erweiterung 0.3

Backup-APIs verlangen Administratorrolle/MFA und persönliche Cookie-Sitzung; Bearerzugriffe sind ausgeschlossen. Erstellung ist CSRF-/Origin- und ratenbegrenzt. Zufällige Job-IDs sind an den erstellenden Login gebunden; keine öffentlichen Downloadtokens. Geschützte temporäre Verzeichnisse, Pfadprüfung vor Bereinigung, Ablauf nach 15 Minuten, Einmalkonsum. pg_dump verwendet libpq-Umgebungsvariablen, keine Credentials in argv/Browser/Audit; rohe Prozessfehler werden verworfen und nur feste Fehlerkategorien protokolliert. Der Dump enthält sensible Kundendaten und technische Sitzungstabellen, keine PostgreSQL-Rollenpasswörter; vertraulich aufbewahren.

Aktualisierungsimporte verlangen MAC-Zustimmung pro Zeile auch auf dem Server; keine implizite Neuanlage und keine automatische Fremdzuordnung. Commit klassifiziert unter derselben Transaktionssperre erneut. APP_DOMAIN wird durch Compose fest vorgegeben, kein Ableiten vertrauenswürdiger Origins aus eingehenden Host-Headern. identity-config erhält die Sicherheitskonfiguration und ersetzt nur die erlaubten Web-Ziele/Realm-Frontendadresse.

## HTTPS-Assistent und getrennte Importfreigaben

Caddy erhält explizit nur den ACME-Issuer von Let’s Encrypt; Staging und Production sind getrennte Verzeichnisse. DNS muss zu allen angegebenen öffentlichen Server-Adressen passen. Interaktiver Plan und ausdrückliche Zustimmung vor .env-Änderung, geschützte Originalkopie, eingeschränkte Wiederherstellung auf Domainwerte; Secrets bleiben aus Vorschau/Logs. HTTPS_ENABLED=false ist eine bewusst gewählte unverschlüsselte Betriebsart; Cookie-/IdP-HTTPS-Flags werden passend umgestellt. HTTPS bleibt Standard für Produktion, Staging dient ausschließlich Tests.

Importfreigaben unterscheiden Datum, Name und MAC serverseitig. Einzelne Vorschläge erteilen keine Zustimmung zu anderen Feldern. Fehlende Datumswerte löschen keine Daten, erstmaliges Datum ändert den aktuellen Zeitraum, Versions-/Trefferlage wird beim Commit unter Transaktionssperre geprüft. Die Fälligkeitsübersicht zeigt nur aktuelle Zeiträume; ihre Löschaktionen verwenden dieselbe Adminprüfung und Bestätigung wie die übrige Oberfläche.
