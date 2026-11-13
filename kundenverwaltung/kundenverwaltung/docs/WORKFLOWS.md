# Kundenverwaltung: Sitzungen, Kassierer, Telegram und Wiederherstellung

Diese Erweiterung verwendet die vorhandene Anwendung im inneren Projekt `kundenverwaltung/kundenverwaltung`. PostgreSQL-Migrationen: `002_customer_workflows.sql` und `003_security_settings.sql`; SQLite: Schema 6. Bestehende Kundennummern, Zahlungszeiträume und Fälligkeiten bleiben erhalten. Zahlungsmethode und Kassiererzuweisung beginnen bei Bestandskunden leer. Die Migration verwirft alte Anwendungssitzungen; danach erneut anmelden.

## Bestehenden Server aktualisieren

Für einen bereits laufenden Server die [fortsetzbare Update-Anleitung](UPDATE.md) verwenden. Sie sichert das alte Image und beide Datenbanken vor der Migration und dem Realm-Abgleich. Der eigenständige Hintergrundlauf ersetzt die frühere manuelle `dc`-Befehlsfolge und bleibt nach einer neuen PuTTY-Anmeldung prüfbar.

Die bisherigen Servergeheimnisse bleiben erhalten. `restore-db` ist eine eigene interne PostgreSQL-Instanz mit separatem Datenvolume. Sie veröffentlicht keinen Hostport. Der Datenbankname muss sich auch bei eigener Konfiguration von der Live-Datenbank unterscheiden; dies wird vor dem Einlesen geprüft. Der Restore-Benutzer hat weder Superuser-, CREATEDB- noch CREATEROLE-Rechte. Nur die Webanwendung erreicht zusätzlich dieses Netz. Sicherheitsbackups liegen dauerhaft im Volume `restore-safety-backups`, im Webcontainer unter `/app/backups`. Dieses Volume in die externe Serversicherung aufnehmen. Bei bereits bestehenden externen Docker-Netzen muss das ausschließlich für Caddy/Keycloak verwendete Netz `172.30.93.0/29` frei sein; bei einer Anpassung Caddy-Adresse, Keycloak-Adresse, Proxyziel und `KC_PROXY_TRUSTED_ADDRESSES` gemeinsam ändern.

Neuinstallationen verwenden dieselben Migrationen und den verwalteten Realm. Nach dem bisherigen `bootstrap` ist kein zusätzlicher manueller Flow erforderlich. `identity-config` gleicht weiterhin ausschließlich die Login-Domain ab; `identity-policy` aktualisiert die hier beschriebenen Login-Regeln. Bei vorhandenen Realms wird kein Import über gespeicherte Benutzer geschrieben.

## 60 Minuten tatsächliche Inaktivität

Realm → Sessions: **SSO Session Idle = 3600 Sekunden**, **Client Session Idle = 3600 Sekunden**. SSO Session Max und Client Session Max bleiben getrennt bei **28800 Sekunden (8 Stunden)**. Beide verwalteten Clients `kundenraum-web` und `kundenraum-ios` haben `client.session.idle.timeout=3600` und `client.session.max.lifespan=28800`. Der iOS-Client bleibt deaktiviert. Realm → Tokens: Access Token Lifespan bleibt **900 Sekunden**, unabhängig vom Inaktivitätslimit. Clientbezogene Token-Overrides dürfen für das Inaktivitätslimit kurz bleiben; die Anwendung erneuert Access-Tokens mit dem verschlüsselt gespeicherten Refresh-Token.

Die Websitzung speichert eine absolute Ablaufzeit, Tokenablauf und letzte Benutzeraktivität getrennt. Pointer-, Tastatur-, Scroll- und Touch-Ereignisse melden Aktivität an den CSRF-geschützten Endpunkt `/api/v1/activity`. Abfragen, Worker, Statuspolling und Token-Refresh ändern diese Aktivitätszeit nicht. Vor jedem Refresh prüft der Server zuerst das Inaktivitätslimit. Eine abgelaufene Sitzung muss neu angemeldet werden; der Browser-Flow enthält keinen Cookie-Schritt für automatische Wiederanmeldung. Nach spätestens acht Stunden erfolgt auch bei Aktivität eine erneute Anmeldung.

Für einen laufenden Realm führt der oben genannte Befehl `run --rm identity-policy` den Realm-/Client-Abgleich aus, ergänzt die Kassiererrolle, stellt den bestehenden Passwort-/OTP-Flow um und widerruft bestehende Keycloak-Sitzungen. Alternativ in der Admin-Konsole die genannten Realm-/Clientwerte setzen und den Flow wie im nächsten Abschnitt konfigurieren. Bei manuellem Abgleich auch kürzere bisherige Client-Overrides entfernen. Die Anwendung wird mit `SESSION_IDLE_SECONDS=3600` ausgeliefert. Ein anderes Limit ist ausschließlich in einer separaten Test-Compose-Datei für die Abnahme vorgesehen.

## 2FA-Ausnahmen und Proxygrenze

Passwortanmeldung bleibt immer erforderlich. Im vorhandenen Flow `kundenraum-mfa` bleibt Username Password Form REQUIRED. Danach folgt Conditional OTP Form REQUIRED mit:

- Skip OTP Role: `kassierer`.
- No OTP for Header: `^X-Kundenraum-OTP-Policy: skip$`.
- Default OTP Outcome: `force`.
- Kein steuerbares Benutzerattribut.

CONFIGURE_TOTP bleibt als Required Action verfügbar, aber nicht global standardmäßig aktiv. Die Conditional-OTP-Ausführung fordert außerhalb der Ausnahmen die Einrichtung an. Beim Umstellen eines Kontos auf Kassierer entfernt die Anwendung eine noch ausstehende CONFIGURE_TOTP-Aktion. Ein bereits eingerichteter OTP-Schlüssel bleibt erhalten. Pro Login-Konto wird über die Benutzerverwaltung genau eine der drei Anwendungsrollen vergeben. Die IP-Ausnahme betrifft Administratoren und Mitarbeiter; Kassierer benötigen unabhängig von ihrer IP kein OTP. Der bestehende ACR-2-Mapper bezeichnet in dieser Installation die erfüllte verwaltete Login-Richtlinie; er ist bei einer Ausnahme kein Nachweis eines tatsächlich eingegebenen OTP.

Administrator → **Einstellungen → Sicherheit → 2FA-IP-Freigaben**. Einzelne öffentliche IPv4-/IPv6-Adressen eintragen, eine pro Zeile. Netzbereiche, Platzhalter, Hostnamen und private Adressen sind serverseitig gesperrt. Die Liste startet leer. **IP-Freigaben speichern** speichert und aktiviert geänderte Regeln automatisch. Status und aktive Adressen sind sichtbar; bei unverändertem Inhalt startet kein Container neu.

Der separate `security-controller` prüft die generierte Caddy-Konfiguration mit denselben Domain-/ACME-Variablen wie der normale Start. Anschließend startet er ausschließlich Keycloak und Caddy im eigenen Compose-Projekt neu und wartet auf Bereitschaft. Fehler vor dem Neustart lassen den bisherigen Dienst laufen; bei einem fehlgeschlagenen Neustart wird die vorherige Liste wiederhergestellt und der Wiederanlauf versucht. Ergebnis und ausführender Administrator werden auditiert. Web, Worker und Datenbanken werden nicht neu gestartet. Die Seite wartet bei einer kurzen Verbindungsunterbrechung weiter auf das Ergebnis.

Die Webanwendung erhält keinen Docker-Socket. Nur der getrennte Steuerungsdienst kann ihn verwenden; dieser veröffentlicht keinen Port und nimmt keine HTTP-Aufträge entgegen. Er liest ausschließlich die versionierte Datenbankliste. Das separate Konfigurationsvolume wird im Proxy schreibgeschützt eingebunden. Die automatisch erzeugten Regeln verwenden exklusive `handle`-Zweige mit einem exakten `remote_ip`-Matcher; alle anderen Anfragen erzwingen OTP. Caddy überschreibt die weitergeleiteten IP-/OTP-Header. Keycloak vertraut ausschließlich dem festgelegten Caddy-Pfad. Keine zusätzliche Proxy-/CDN-Stufe vor Caddy schalten.

**Die frühere manuelle Datei `deploy/mfa-allowlist.caddy` wird nicht mehr ausgewertet.** Sie wird beim Update nur als Altdatei gesichert; alte Ausnahmen werden bewusst nicht übernommen. Anschließend in den Einstellungen neu erfassen. Bei eigenen Netzen `MFA_KEYCLOAK_UPSTREAM` im Steuerungsdienst gemeinsam mit Caddy-/Keycloak-IP und Keycloak-Proxyvertrauen anpassen.

Zum Entzug die Liste in den Einstellungen leeren und speichern. Nach Status „aktiv“ verlangen neue Anmeldungen wieder OTP. Bereits angemeldete Sitzungen werden durch einen Listenwechsel nicht beendet; für deren Widerruf die Benutzerverwaltung bzw. den dokumentierten Realm-Abgleich verwenden. Kassierer bleiben rollenbedingt ohne OTP. Die IP-Liste gehört zur Server-Sicherheitskonfiguration und wird bei einem Kundenbackup-Restore nicht auf einen früheren Stand zurückgesetzt.

Falls der Administrator wegen eines defekten OTP-Geräts nicht in die Oberfläche kommt, kann ein berechtigter Serveradministrator ausschließlich eine validierte eigene öffentliche IP über den vorhandenen Webcontainer zur Aktivierung vormerken:

```bash
sudo docker compose -f compose.server.yml exec -T web node --import tsx --input-type=module -e 'import {securitySettings,saveSecuritySettings} from "./lib/security-settings.ts"; const s=await securitySettings(); console.log(await saveSecuritySettings({version:s.version,addresses:process.argv.slice(1)},"server-console-recovery"));' DEINE_OEFFENTLICHE_IP
```

Der normale Sicherheitsdienst prüft und aktiviert auch diese Wiederherstellung; sie wird als `server-console-recovery` protokolliert. Danach erneut anmelden und die Liste in der Oberfläche kontrollieren.

Technische Grundlage: [Keycloak Reverse Proxy](https://www.keycloak.org/server/reverseproxy) und [Conditional OTP in der verwendeten Version](https://github.com/keycloak/keycloak/blob/26.8.2/services/src/main/java/org/keycloak/authentication/authenticators/browser/ConditionalOtpFormAuthenticator.java). Die verwendete Version prüft bei der Headerausnahme ausdrücklich die Vertrauenswürdigkeit des Proxys.

## Telegram: zwei Berichte pro lokalem Tag

Einstellungen → Benachrichtigungen: Erste tägliche Versandzeit mit Stunde und Minute; zweite Zeit optional einschalten. Beide Zeiten müssen verschieden sein. Zeitzone ist immer **Europe/Vienna**. Nach Speichern zeigt die Oberfläche die nächste geplante Ausführung. Der Ein-/Aus-Schalter und der unabhängige Testversand bleiben erhalten.

Berichte enthalten nur befüllte Abschnitte **🔴 Abgelaufen**, **⏰ Läuft heute ab**, **📅 Läuft demnächst ab**, jeweils mit Anzahl sowie Kundennummer, Name und Serviceende. Abgelaufene aktuelle Services bleiben in beiden Berichten sichtbar. Der Filter für bevorstehende Abläufe verwendet die gespeicherte Tagesanzahl.

Jeder Slot erhält einen Datenbankschlüssel `tg:JJJJ-MM-TT:1` bzw. `:2`. Ein UNIQUE-Constraint und die gemeinsame Datenbanksperre verhindern doppelte Claims durch parallele Worker. Claims werden vor dem Netzwerkaufruf festgeschrieben; beim Neustart werden sie nicht erneut gesendet. Frühere Tagesschlüssel werden bei der Migration Slot 1 zugeordnet. Ein Kunde kann absichtlich in beiden Berichten stehen. Nach einem Neustart werden überfällige Slots desselben Tages nachgeholt. Frühere Tage werden nicht rückwirkend abgearbeitet.

Sommerzeit: Eine nicht existierende Uhrzeit wird beim ersten Tick nach der Zeitlücke ausgeführt; in der doppelten Herbststunde verhindert der Tagesschlüssel einen zweiten Versand. Der Worker prüft jede Minute. Telegram bietet keine transaktionale Zustellgarantie zusammen mit unserer Datenbank: Bei unklarem Netzwerkergebnis bleibt der Status `unknown`, ohne automatischen Wiederholungsversand. Vor einer manuellen Wiederholung beim Anbieter prüfen. Die Abnahme verwendet ausschließlich simulierte Transporte; keine produktiven Empfänger werden angeschrieben.

## Backup über die Oberfläche wiederherstellen

Nur Administratoren mit persönlicher Websitzung können diese Funktion verwenden. Bearer-Tokens sind ausgeschlossen. Vor Upload und Bestätigung muss die Anmeldung höchstens fünf Minuten alt sein; dazu im Dialog **Für Wiederherstellung erneut anmelden** verwenden. Da der Login-Flow immer das Passwort verlangt, ist dies eine aktuelle Authentifizierung nach der geltenden OTP-/IP-Regel.

1. Einstellungen → Datenbank-Backup → Datei wählen. Unterstützt wird **PostgreSQL-Custom-Dump `.dump`**, genau das Format des vorhandenen Downloads; maximal 50 MiB.
2. **Backup hochladen und prüfen**. Signatur und pg_restore-Verarbeitbarkeit werden serverseitig geprüft. Ausführbare Archivobjekte wie Funktionen und Trigger sowie fremde Schemas werden abgewiesen. Die Datei wird ausschließlich auf der separaten Restore-Instanz eingelesen, auf den aktuellen Schema-Stand migriert und auf Tabellen, Spalten und Lesbarkeit geprüft.
3. Die Oberfläche zeigt die konkrete Zieldatenbank und dass der aktuelle Datenstand ersetzt wird. Die Bestätigung erfordert ein ausdrücklich gesetztes Kontrollkästchen.
4. Nach erneuter Prüfung wird der Wartungsmodus aktiviert. Eine gemeinsame Datenbanksperre lässt laufende Schreibaktionen und Versandjobs zuerst enden. Währenddessen werden neue Schreibaktionen pausiert; neue Versandjobs warten. Vor der Umschaltung entsteht automatisch ein dauerhaftes `before-restore-….dump` im Sicherheitsbackup-Volume. Scheitert diese Sicherung, wird nichts übernommen.
5. Die Übernahme der geprüften Kundendaten, Perioden, Einstellungen, Zuweisungen, Versandbelege und Audits erfolgt in **einer PostgreSQL-Transaktion**. Die installierte Schema-Version bleibt erhalten. Flüchtige Vorschauen und andere Websitzungen werden verworfen; die aktuelle Administratorsitzung bleibt für Fortschritt und Ergebnis erhalten. Keycloak-Passwörter und OTP-Geheimnisse bleiben in der separaten Identity-Datenbank.
6. Erfolg oder Fehler werden mit Administrator, Datenbank, Zeitpunkt und Sicherheitsbackup im Audit protokolliert. Uploads laufen nach 15 Minuten ab und werden nach Abschluss entfernt. Auch verwaiste Uploads eines früheren Prozesses werden bereinigt.

Fehler vor dem Commit rollen die gesamte Datenübernahme zurück. Der bisherige Datenstand bleibt aktiv und die Sperre wird freigegeben. Stirbt ein Prozess, gibt PostgreSQL dessen Sperren frei und rollt offene Transaktionen zurück; der nächste Worker prüft und beseitigt einen verwaisten Wartungsstatus. Ein unterbrochener Restore wird nicht automatisch wiederholt. Bei unklarem Ergebnis `restore.complete` bzw. `restore.failed` im Audit kontrollieren.

Rückkehr zu einem bereits erfolgreich ersetzten Stand: Das passende Sicherheitsbackup aus dem Webcontainer auf einen geschützten Administrationsrechner kopieren und mit derselben Upload-/Prüf-/Bestätigungsfunktion zurückspielen:

```bash
docker compose -f compose.server.yml exec -T web ls /app/backups
docker compose -f compose.server.yml cp web:/app/backups/DATEINAME.dump ./DATEINAME.dump
```

Ist die Weboberfläche nicht betriebsbereit, Web und Worker stoppen, die aktuelle Datenbank zusätzlich sichern und den in SERVER.md dokumentierten pg_restore-Weg verwenden. Nach einer vollständigen manuellen Rücksicherung aus einem Sicherheitsbackup den Wartungsmarker mit `UPDATE maintenance SET active=0 WHERE id=1` freigeben, anschließend Migration und Dienste starten. Kein `down -v` verwenden. Keycloak benötigt weiterhin eine eigene Wiederherstellung seiner Datenbank. Sicherheitsbackups werden absichtlich nicht automatisch gelöscht; Aufbewahrung und externe Kopien administrativ festlegen.

## Kundenformulare, Fälligkeit und Kassierer

Neue und verlängerte Servicezeiträume erhalten `due_date = service_start + 1 Kalendermonat`, mit Monatsendkappung, z.B. 31.01.2026 → 28.02.2026. Das Formular zeigt den berechneten Wert schreibgeschützt. Importierte Kunden ohne Startdatum behalten eine offene Fälligkeit; beim Ergänzen des Beginns wird sie berechnet. Unveränderte Bestandszeiträume und archivierte Fälligkeiten werden nicht umgeschrieben. Reports gruppieren Zahlungswerte nach `due_date`, Serviceabläufe nach `service_end`.

Zahlungsmethode ist Bar, Konto oder bei Bestandskunden Nicht angegeben. Konto blendet Welches Konto? ein. Bei Bar entfernt der Server eine eventuell mitgesendete Kontobezeichnung. Die Kundenliste zeigt eine eigene Spalte. Die administrative Ansicht zeigt außerdem den zugewiesenen Kassierer.

Anlegen und Bearbeiten verwenden dieselbe Änderungsprüfung. Außenklick, X, Abbrechen oder Escape schließen unveränderte Formulare sofort. Bei Änderungen erscheint Ungespeicherte Änderungen verwerfen? mit Weiter bearbeiten und Änderungen verwerfen. Weiter bearbeiten erhält alle Eingaben. Werden alle Eingaben zurückgesetzt oder erfolgreich gespeichert, entfällt die Warnung.

Administrator → Login-Konten → Rolle Kassierer. Initialpasswort und Passwortwechsel bleiben erhalten; Kassierer brauchen kein OTP. Im Kundenformular Durch Kassierer kassieren aktivieren und einen konkreten aktiven Kassierer wählen. Ohne Auswahl lässt sich das Formular nicht speichern; fremde oder gesperrte Benutzerkennungen werden serverseitig abgewiesen.

Kassierer landen nach dem Login auf `/meine-offenen-kunden`. Offen bedeutet hier: **aktueller Servicezeitraum mit Zahlungsstatus Unbezahlt oder Unbekannt**; ein abgelaufenes Serviceende beseitigt eine offene Zahlung nicht. Historische Perioden werden dort nicht angezeigt. Jeder Kassierer sieht ausschließlich seine Zuweisungen und kann ausschließlich deren aktuellen Zeitraum auf bezahlt setzen. Die Buchung nutzt die vorhandene Zahlungslogik, prüft Zuweisung und Perioden-ID erneut, protokolliert Kassierer und Zeitraum und ist bei identischer Wiederholung idempotent. Danach verschwindet der Kunde sofort. Andere Kunden-APIs einschließlich Details, Änderungen und Verlängerungen sowie Dashboard, Reports, Importe und Administration sind gesperrt. Direkte Seitenaufrufe führen zurück zur eigenen Liste.

## Reproduzierbare isolierte Abnahme

`compose.acceptance.yml` ist ausschließlich für lokale Tests. Es bindet HTTP/HTTPS an Loopback und verwendet ein internes Caddy-Testzertifikat. Die zwei IP-Testclients verwenden ein zusätzliches internes, nicht geroutetes Testnetz; die öffentlich aussehenden Quelladressen simulieren erlaubte und abgelehnte öffentliche IPs. Dieses Overlay nicht auf einem Produktivserver einsetzen.

Die Test-.env wird getrennt unter `.runtime/workflows.env` erzeugt und enthält `APP_DOMAIN=kundenraum.localhost`, `APP_VERSION=workflows-test` sowie neu generierte Geheimnisse. Projektname muss `kundenraum-workflows-test` sein. Bestehende `.env`, Nutzerdaten und andere Compose-Projekte werden nicht verwendet.

```powershell
npm run check
npm run build
npm test
node tests/acceptance-docker.mjs
node tests/acceptance-mfa-comments.mjs
node tests/acceptance-security.mjs
node tests/acceptance-scheduler.mjs
```

Die Browserabnahme setzt einen gestarteten Teststack und Testadministrator voraus. `acceptance-docker.mjs` verwendet fiktive Kunden und erzeugt lokale Testzugänge in `.runtime/workflows-access.txt`. Die Sicherheitsabnahme setzt ausschließlich den Testrealm kurzzeitig auf 10 Sekunden IdP-Inaktivität, einen einsekündigen Access-Token und drei Sekunden App-Inaktivität. Ihr finally-Block stellt Realm/Clients, Tokenlaufzeit, Webcontainer und leere IP-Liste wieder her und prüft die wirksamen 3600 Sekunden. Keine Testgeheimnisse, Datenbanken, Zertifikate oder Dumps committen.

Nach erfolgreichen technischen Prüfungen bleibt die Anwendung unter **https://kundenraum.localhost** erreichbar. Das lokale Testzertifikat kann im Browser als nicht vertrauenswürdig erscheinen; die Root-CA liegt im Caddy-Testvolume. Die manuelle Freigabe des Anwenders ist erforderlich, bevor Commit und Push auf den vorgesehenen Branch erfolgen.

Die öffentliche Root-CA des aktuellen lokalen Teststacks liegt zusätzlich unter `.runtime/workflows-ca.crt`. Bei Bedarf kann sie für den manuellen HTTPS-Test in den Zertifikatspeicher des eigenen Browsers importiert werden; sie wurde nicht automatisch systemweit installiert.

## Nachbesserung beim manuellen Test

Offene Zahlungen in Reports können direkt über Als bezahlt markieren gebucht werden, einschließlich historischer Zeiträume und offener Posten ohne Fälligkeitsdatum. Die Aktion verwendet die Perioden-ID der angezeigten Zeile und die bestehende Versionsprüfung. Nach Erfolg aktualisieren sich offene Posten und Auswertungen.

Die Kassiereransicht zeigt zugewiesene offene Kunden als responsive Karten mit Telefonnummer, MAC/Kennung, Adresse/PLZ, Punkten, Anbieter, Paket, Servicezuordnung, Servicebeginn/-ende, Fälligkeit, Zahlungsmethode/Konto und Kommentar. Punkte bleiben Punkte, einschließlich des Wertes 0; es wurde kein Preisfeld ergänzt. Die vorhandenen serverseitigen Rollen- und Zuweisungsprüfungen gelten unverändert. Diese Oberflächenkorrekturen benötigen keine weitere Datenbankmigration. Der Verlängerungsdialog zeigt die serverseitig berechnete Zahlungsfälligkeit.

## Kassierer-Kommentare

Die Kassiererkarte enthält immer ein direkt editierbares Kommentarfeld mit „Kommentar speichern“. Es bearbeitet den gemeinsamen Kundenkommentar ohne zusätzlichen Dialog. Ungespeicherte Eingaben bleiben bei Fehlern erhalten; vor einer Zahlung muss der Kommentar gespeichert werden. Der eigene Kommentar-Endpunkt prüft Rolle, aktive Zuweisung, aktuellen offenen Zeitraum und Version erneut. Fremde Kunden, bezahlte/alte Zeiträume und weitere Kundendaten sind gesperrt. Konflikte überschreiben keine zwischenzeitlichen Änderungen; Änderungen werden mit Kassierer und Zeitraum protokolliert.

Die zusätzliche IPv6-/Fehlerabnahme `tests/acceptance-mfa-ipv6-failure.mjs` verwendet ausschließlich das ignorierte Overlay `.runtime/mfa-ipv6.yml` mit einem nicht gerouteten internen IPv6-Netz. Sie prüft zwei echte IPv6-Quellen, eine IPv4-Quelle, Headerfälschung, fehlgeschlagene Validierung ohne Neustart und erneute Aktivierung nach Korrektur. Das Testskript setzt am Ende die IP-Liste leer. Keine fremden öffentlichen Netze werden kontaktiert.
