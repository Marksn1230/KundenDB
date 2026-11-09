# API v1

Basis: `/api/v1`. OpenAPI-Datei: [openapi.json](openapi.json), live `/api/v1/openapi.json`. Fehlerformat: `{ "error": { "message": "…", "details": [] } }`. Alle Kalenderdaten ISO `YYYY-MM-DD`; keine UTC-Mitternacht oder Uhrzeit als Servicefeld senden. Fehlende Daten sind `null`, nicht ein erfundenes Datum.

## Authentifizierung

Web: `/api/auth/login` beginnt Authorization Code + PKCE S256 mit serverseitig gebundenem State/Nonce. Callback `/api/auth/callback` setzt ein HttpOnly-Sitzungscookie; Produktivbetrieb Secure und SameSite=Strict. `/me` liefert Benutzer und CSRF-Token. Schreibende Cookie-Anfragen brauchen `Origin: <APP_URL-Origin>` und `X-CSRF-Token`. Das Token ist kein allgemeiner API-Schlüssel.

Native Clients: OIDC-Discovery des eigenen Keycloak-Realms, Authorization Code + PKCE im Systembrowser. Token per `Authorization: Bearer …`; nur Access-Tokens mit aktiver Introspection, Rolle und Zielgruppe **kundenraum-api** werden angenommen. Administratoren brauchen ACR **2**. Kein Passwortgrant, kein Clientsecret in iOS, keine Speicherung von Tokens in UserDefaults. Details zur ausstehenden Client-Aktivierung stehen in der README.

## Kunden und Versionen

```http
GET /api/v1/customers?q=alpen&provider=Art&assignee=Marko&month=11&year=2026&payment_status=Unbezahlt&page=1&per_page=25
Authorization: Bearer <access-token>
```

Antwort enthält `data`, `total`, `page`, `per_page` (maximal 100). Filter sind kombinierbar. `q` sucht Kundennummer, Name, Telefon und MAC. `package_months` erlaubt 1,6,7,12,14; `service_status=active|expired` ist vom Zahlungsstatus unabhängig. Detail: `GET /customers/{id}` liefert `{ data, periods }`. `{id}` ist die interne numerische ID, keine Kundennummer.

Neuanlage `POST /customers`:

```json
{
  "name": "demo.alpen",
  "mac_address": "02:00:00:00:00:01",
  "provider": "Art",
  "assignee": "Marko",
  "package_months": 1,
  "service_start": "2026-01-31",
  "payment_status": "Unbezahlt",
  "postal_code": "00123"
}
```

Antwort **201** einschließlich schreibgeschützter serverseitiger `customer_number`, `version` und berechnetem Ende `2026-02-28`. Zusätzliche nicht definierte Eingabefelder werden zurückgewiesen.

```http
PATCH /api/v1/customers/42
Content-Type: application/json
```

```json
{ "version": 3, "data": { "comment": "Fiktive Notiz", "phone": "+436641234567" } }
```

Nur explizite Felder ändern sich. Importierte Enddaten bleiben erhalten, wenn `service_end` nicht ausdrücklich geändert wird. `DELETE /customers/{id}` benötigt Administratorrolle und `{ "version": 3, "confirm": true }`.

## Verlängerung und Zahlung

`POST /customers/{id}/renew-preview` und `/renew` erhalten dasselbe Modell:

```json
{ "version": 3, "package_months": 6, "payment": "unpaid" }
```

`service_start` ist optional. Ohne Angabe laufend → bisheriges Ende; abgelaufen → heute in Europe/Vienna. `payment=keep` übernimmt den bisherigen Status; `unpaid` setzt den neuen auf Unbezahlt. Preview schreibt nichts; Renew archiviert den bisherigen Zeitraum und erhöht die Version atomar. `POST /service-preview` berechnet eine freie Formulavorschau aus Beginn und Paket.

`PATCH /customers/{id}/payment` kann den aktuellen oder historischen Zeitraum ändern:

```json
{ "version": 4, "period_id": 17, "payment_status": "Bezahlt" }
```

Jede echte Zahlungsänderung erhöht die Kundenversion und wird protokolliert.

## Dateiimport

1. `POST /imports/file`, Multipart-Feld `file` → `headers` und rohe `rows`.
2. `POST /imports/preview` → Snapshot mit Kategorien; keine Kundenänderung.

```json
{
  "profile": "unified",
  "rows": [{ "Benutzer": "demo.alpen", "Gerät": "020000000001", "Ende": "31.12.2026" }],
  "mapping": { "Benutzer": "name", "Gerät": "mac_address", "Ende": "service_end" }
}
```

Kategorien `existing`, `changed`, `new`, `review`. Name und MAC/Kennung dienen gemeinsam dem Abgleich. Freie Kennungen werden außen getrimmt und unter Beachtung der Groß-/Kleinschreibung verglichen. Die Moduserkennung kann mit modes: { "0": "identifier" } pro Zeile korrigiert werden. Alle drei Pflichtfelder gelten für jede Datei; leere optionale Werte überschreiben nichts. Bei Bedarf erzeugt `resolutions: { "0": 42 }` eine **neue** Vorschau mit expliziter manueller Zuordnung der ersten Zeile zur internen Kunden-ID 42. Doppelte Zeilen und nicht eindeutige Identitäten bleiben gesperrt.

3. `POST /imports/commit`:

```json
{ "preview_id": "<uuid aus Vorschau>", "selection": [{ "index": 0, "payment": "keep" }] }
```

Nur ausgewählte Indizes werden freigegeben. Leere Auswahl schreibt keine Kunden. Default ist `keep`, individuelle Wahl `unpaid`; die Weboberfläche bietet zusätzlich Sammelauswahl. Antwort `{ "created": 1, "updated": 0, "skipped": 0 }`. Die identische Freigabe-ID ist idempotent; nach 409 muss eine neue Vorschau erzeugt werden. Die Vorschau ist 30 Minuten gültig und an den Benutzer gebunden.

## Reports und Administration

`GET /reports?provider=Art&assignee=Marko` liefert `unpaid`, separat `undated`, Monatsbuckets und zugehörige `periods` mit Kundenreferenzen. Rückstände sind volle Kalendermonate ab Fälligkeit; `overdue_label` kennzeichnet kurze Rückstände oder noch nicht fällige Posten.

Nur Administrator: `/settings`, `/messages/preview`, `/messages/whatsapp-test`, `/messages/telegram-test`, `/deliveries`, `/audit`, `/users`. Secrets sind ausschließlich Umgebungsvariablen. Testversand erlaubt keine Empfängerparameter. `/users` unterstützt die Aktionen `create`, `role`, `active` und `reset`; die OpenAPI-Datei beschreibt die Eingaben. Bearer-Tokens erhalten dadurch keine weitergehenden Rechte als Websitzungen.

## Relevante HTTP-Statuscodes

| Code | Bedeutung / Clientverhalten |
|---|---|
| 400 | Eingaben korrigieren; Details enthalten Feldnamen |
| 401 | Nicht angemeldet, Token abgelaufen/ungültig oder gesperrt; erneut anmelden |
| 403 | Rolle, MFA oder CSRF-Prüfung fehlt |
| 404 | Datensatz / Route nicht vorhanden |
| 409 | Versions-/Identitätskonflikt; Detail oder Importvorschau neu laden |
| 413 | Datei/Anfrage überschreitet Grenze |
| 415 | JSON bzw. unterstütztes Format verwenden |
| 429 | Rate Limit; nach 15 Minuten erneut versuchen |
| 502 / 503 | Providerfehler oder fehlende Einrichtung; keine automatische fachliche Freigabe |

## Integrierte Anmeldung und Massenaktionen

/api/auth/login?returnTo=%2Fkunden%2F42 speichert einen validierten internen Rücksprung. Das OIDC-Formular liegt unter derselben Origin /auth. Passwörter und OTP verarbeitet Keycloak im Kundenraum-Theme. Anonyme interne Seiten laden keine Kundendaten.

Kunden unterstützen mac_mode: mac | identifier (Default mac). Freie Kennungen bleiben in mac_address. Lokale Telefonnummern werden über settings.default_country (Default AT) normalisiert; internationale Vorwahlen bleiben erhalten. Unklare Nummern sind vom Versand ausgeschlossen.

POST /bulk/preview mit {"action":"paid","customers":[{"id":42,"version":3}]} liefert Batch-ID, Anzahl, berechtigte/ausgeschlossene Einträge und Gründe. action: whatsapp benötigt Administratorrechte und liefert Vorlage/Nachrichtenvorschau. Maximal 500 Konten; doppelte IDs sind unzulässig. POST /bulk/commit mit {"batch_id":"<id>","confirm":true} liefert successful, skipped, failed und einzelne Ergebnisse. Vorschauen sind an den Login gebunden. Wiederholungen derselben abgeschlossenen Freigabe liefern das gespeicherte Ergebnis; laufende WhatsApp-Batches liefern 409. Geänderte Kunden werden nicht blind überschrieben. Alle Versand-Gates werden unmittelbar vor dem Senden erneut geprüft.

POST /users mit {"action":"create","username":"demo.user","role":"employee","password":"<individuelles initiales Passwort>"} legt ein persönliches Login an. action: reset benötigt subject und ein neues temporäres password. Mindestens 15, höchstens 128 Zeichen, ausschließlich schreibbar. Keine Rückgabe/Protokollierung, keine Einladungs-E-Mail. Die nächste Anmeldung verlangt Passwortwechsel. Reset widerruft Sessions und bewahrt OTP. Selbst-Reset liefert signed_out: true; eigene Sperre/Rollenänderung bleibt gesperrt.

Öffentlich: GET /health liefert ausschließlich {"status":"ok"} oder 503/not_ready, keine Verbindungsdetails. Vollständige Schemas, Grenzen und Fehler stehen in OpenAPI.

## Aktualisierungsimport und Datenbank-Backups

POST /imports/preview akzeptiert mode: existing_only (Standard all). In diesem Modus zählen nur name, mac_address, mac_mode und service_end; andere Stammdaten werden nicht überschrieben. Ergebnis unmatched bedeutet Kein Treffer, existing Unverändert. changed liefert previous_mac, previous_mac_mode, previous_end und requires_mac_approval. Bei requires_mac_approval muss die einzelne Auswahl in POST /imports/commit ausdrücklich approve_mac: true enthalten. Das erteilt keine Neuanlageberechtigung. Reiner Kennungswechsel erhält Zahlung; eine Enddatumsänderung nutzt weiterhin payment: keep | unpaid. Bei geänderter Trefferlage/Version 409, komplette Freigabe zurückgerollt.

Nur Admin-Websitzung (keine Bearer-Tokens): GET /backups liefert Verfügbarkeit; POST /backups mit {} und gültigem Origin/CSRF liefert 202 und BackupJob. GET /backups/{backup_id} liefert running, ready oder failed für den erstellenden Administrator. GET /backups/{backup_id}/download liefert einmalig application/octet-stream mit Content-Disposition und anschließend 404. Andere Administratoren erhalten 404, Mitarbeiter 403, anonyme Clients 401. Lebensdauer 15 Minuten; maximal drei Starts/15 Minuten und ein gleichzeitig laufender Dump. SQLite-Umgebung: Erstellung 503. Fehler zeigen keine DB-Zugangsdaten. OpenAPI enthält die Modelle und Grenzen.
