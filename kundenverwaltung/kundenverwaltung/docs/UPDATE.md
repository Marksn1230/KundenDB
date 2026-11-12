# Bestehenden Server aktualisieren – auch nach PuTTY-/SSH-Abbruch fortsetzbar

Diese Anleitung ersetzt die frühere Befehlsfolge vollständig. **Die alte Anleitung mit `set -euo pipefail` und der Shell-Funktion `dc` nicht weiterverwenden.** `dc` war nur eine temporäre Funktion, kein installiertes Programm. Nach einer neuen SSH-Anmeldung existiert diese Funktion nicht mehr. `set -e` direkt in der interaktiven SSH-Shell konnte bei einem fehlgeschlagenen Befehl die Shell und damit PuTTY schließen. Welcher Befehl bei deinem bisherigen Versuch fehlschlug, ist ohne Protokoll nicht mehr feststellbar.

Im vollständigen Linux-Upgrade wurde außerdem ein konkreter Fehler im ausgelieferten Image reproduziert: Nach einem Checkout mit `umask 077` waren neue Quelldateien für den Containerbenutzer `node` nicht lesbar. Dadurch konnte `migrate` mit `EACCES` abbrechen. Das korrigierte Dockerfile übernimmt die Dateien mit passendem Eigentümer und prüft die Lesbarkeit bereits beim Image-Build als Anwendungsbenutzer. Der Quellcodewechsel verwendet außerdem gezielt `umask 022`, damit öffentliche Keycloak-/Proxy-Dateien in Bind-Mounts lesbar bleiben. Geheimnisse und Sicherungen behalten private Rechte.

Das neue Skript läuft als eigener Prozess, protokolliert alle Schritte und speichert seinen Fortschritt. Es **installiert oder deinstalliert Docker nicht**, verwendet kein `docker compose down`, kein Volume-Löschen und kein Pruning. `Recreate` in Compose bedeutet das Ersetzen eines Dienstcontainers unter Beibehaltung seiner Datenvolumes. `run --rm` räumt nur den einmaligen Migrations-/Abgleichcontainer auf.

## Nach deiner Snapshot-Wiederherstellung

Warte, bis der Snapshot zurückgespielt und der Server wieder erreichbar ist. Öffne dann eine **neue PuTTY-Sitzung**. Zuerst die bisherige Domain öffnen: Der alte Kundenraum mit seinen alten Kundendaten muss wieder laufen. Diese Anleitung greift nicht auf deinen Server zu; du startest den Lauf selbst nach der Wiederherstellung.

Die folgenden Beispiele verwenden den bisherigen Git-Installationspfad `/opt/kundenraum/kundenverwaltung/kundenverwaltung`. Falls du woanders installiert hast, den `cd`-Pfad anpassen. Keine Neuinstallation, kein erneutes Setup/Bootstrap, keine neue `.env` und kein neuer Compose-Projektname. Domain, Passwörter und Zertifikate bleiben erhalten.

## 1. Ordner und vorhandenes Docker prüfen

Jeden Block einzeln ausführen. Bei einer Fehlermeldung nicht zum nächsten Block wechseln. Die Befehle setzen **kein** `set -e` in deiner SSH-Shell.

```bash
set +e
cd /opt/kundenraum/kundenverwaltung/kundenverwaltung
pwd
ls -l compose.server.yml .env
docker --version
sudo docker info
```

`set +e` hebt vorsorglich ein eventuell noch gesetztes interaktives `errexit` auf. Wenn `docker --version` funktioniert, ist Docker installiert. Ein Fehler bei `docker info` kann ein Rechte- oder Dienstproblem sein; daraus folgt keine Deinstallation. In diesem Fall zunächst nur prüfen:

```bash
sudo systemctl status docker --no-pager
```

Keine Docker-Neuinstallation und keine Volume-Bereinigung als Reparatur versuchen. Die neue Update-Vorprüfung stoppt vor Änderungen, wenn Docker oder die erforderlichen Rechte fehlen.

## 2. Neues Update-Skript abrufen – noch keinen Dienst anhalten

Der im Snapshot enthaltene Quellstand bleibt zunächst aktiv. Nur die neue Skriptdatei wird aus dem abgerufenen GitHub-Stand in den ignorierten Laufzeitordner kopiert. Der eigentliche Quellcodewechsel passiert erst nach der Sicherung im Skript.

```bash
git status --short
git remote -v
mkdir -p .runtime
chmod 700 .runtime
git fetch origin && git show origin/master:kundenverwaltung/kundenverwaltung/scripts/update-server.sh > .runtime/update-runner.sh
```

Ein normaler GitHub-Clone verwendet `origin`. Falls dein vorhandener Remote tatsächlich `orgin` heißt, in der letzten Zeile **beide** Vorkommen von `origin` durch `orgin` ersetzen. Keine Remote-URL oder SSH-Schlüssel ändern. `git status --short` muss bei den Quellcodedateien sauber sein; `.env`, Daten, Backups und `.runtime` sind ignoriert.

Anschließend Syntax und Vorbedingungen prüfen:

```bash
bash -n .runtime/update-runner.sh
sudo bash .runtime/update-runner.sh check
```

Nur wenn **„Vorprüfung erfolgreich“** erscheint, mit Schritt 3 fortfahren. Die Prüfung verändert keine Datenbank und stoppt keinen Dienst. Sie prüft unter anderem:

- vorhandene `.env` und Compose-Datei;
- Docker-Zugriff und verfügbaren Speicher;
- genau das bisherige Compose-Projekt anhand seiner Containerlabels;
- bisherige zusätzliche Compose-Dateien, damit individuelle Einstellungen erhalten bleiben;
- sauberen Branch `master` und einen möglichen Fast-forward auf den bereits abgerufenen GitHub-Stand.

Sind mehrere Installationen im selben Ordner vorhanden, den ausdrücklich gewünschten bisherigen Projektnamen angeben, z.B. `sudo bash .runtime/update-runner.sh check --project meinprojekt`. Derselbe Zusatz gehört dann auch zum ersten `run`-Aufruf. Normalerweise wird er automatisch erkannt. Das Skript erfindet keinen neuen Projekt-/Volumenamen.

## 3. Update unabhängig von PuTTY starten

Zuerst die sudo-Anmeldung **im Vordergrund** bestätigen:

```bash
sudo -v
```

Danach den Hintergrundlauf starten:

```bash
sudo -n nohup bash .runtime/update-runner.sh run > .runtime/server-update-launch.log 2>&1 < /dev/null &
```

Der eigentliche Updater läuft nun als eigener privilegierter Prozess. Sein Docker-Zugriff hängt nicht von einem später abgelaufenen sudo-Ticket der SSH-Sitzung ab. Git arbeitet bei einem sudo-Start weiterhin als ursprünglicher Installationsbenutzer. `nohup` und die umgeleiteten Ein-/Ausgaben schützen den Lauf vor dem Schließen von PuTTY. Eine Paketinstallation wie tmux ist dafür nicht erforderlich.

Nach einigen Sekunden den Status prüfen:

```bash
sudo bash .runtime/update-runner.sh status
```

Erwartet ist ein gespeicherter Sicherungspfad, dein bisheriger Projektname, ein aktueller Schritt und die Meldung, dass der Prozess läuft. Wenn noch kein Lauf gespeichert wurde, das Startprotokoll lesen:

```bash
tail -n 60 .runtime/server-update-launch.log
```

Ein fehlgeschlagenes `sudo -n` oder eine Vorprüfung hat dann noch keine Anwendung gestoppt. Das erste `sudo -v` im Vordergrund muss erfolgreich gewesen sein.

## Was der Updater in welcher Reihenfolge macht

| Schritt | Aktion |
|---|---|
| `01-snapshot` | Alte Commit-ID, Quellarchiv, `.env`, Compose-Datei und das tatsächlich laufende alte Dockerimage sichern. |
| `02-source` | Fast-forward auf den zuvor abgerufenen GitHub-Commit; prüfen, dass `.env` unverändert bleibt. Kein Reset, kein automatischer Konflikt-Merge. |
| `03-build` | Neues Web-/Workerimage bauen. Bis hier läuft die bisherige Anwendung weiter. |
| `04-stop` | Caddy, Web, Worker und Keycloak für die Wartung anhalten. PostgreSQL und Docker selbst bleiben in Betrieb. |
| `05-backups` | Beide Datenbanken gemeinsam im Custom-Format sichern, Archivlisten und Prüfsummen erstellen und Kunden-/Periodenzahlen festhalten. |
| `06-databases` | Bisherige Datenbankdienste und Keycloak starten, separate neue Restore-Datenbank bereitstellen. Bestehende Volumes bleiben erhalten. |
| `07-migration` | Anwendungsschema in einer Transaktion auf Version 2 migrieren. |
| `08-keycloak` | Auf die Startbereitschaft warten und den vorhandenen Realm abgleichen, inklusive Kassiererrolle und 60-Minuten-Inaktivität. |
| `09-counts` | Vor Freigabe der Schreibdienste unveränderte Kunden-/Periodenzahlen und beide Dump-Prüfsummen prüfen. |
| `10-activate` | Web, Worker und Caddy starten und deren Bereitschaft abwarten. |
| `11-health` | Anwendungsgesundheit prüfen und den Lauf als erfolgreich markieren. |

Vorhandene Kundennummern, historische Fälligkeiten, Benutzer, Passwörter und OTP-Geräte bleiben erhalten. Es gibt weiterhin Punkte, kein neues Preisfeld. Die lokale 2FA-Testausnahme unseres Entwicklungsrechners wird nicht übertragen; die öffentliche Produktionsliste bleibt leer. Verwende auf dem Server keine `compose.acceptance.yml` und keine lokalen Test-Overlays.

Während der Schritte 04 bis 10 ist die Weboberfläche vorübergehend nicht erreichbar. Das ist die angekündigte Wartung, keine Docker-Deinstallation. Bei Fehlern stoppt der **Update-Prozess**, nicht deine übergeordnete SSH-Shell. Die Wartung bleibt gegebenenfalls bestehen, bis du den konkreten Fehler behebst und fortsetzt. Es findet keine ungefragte Datenbankrücksicherung statt.

## Nach neuer PuTTY-Anmeldung: Status, Protokoll und Fortsetzen

Diese Befehle brauchen keine Variablen oder Funktionen aus der vorherigen Sitzung:

```bash
cd /opt/kundenraum/kundenverwaltung/kundenverwaltung
sudo bash .runtime/update-runner.sh status
```

Ist der Prozess noch aktiv, keinen zweiten starten. Ist der Status `failed`, zunächst die vollständigen letzten Meldungen und Docker-Diagnose ansehen:

```bash
sudo tail -n 100 .runtime/server-update/last-attempt.log
sudo bash .runtime/update-runner.sh logs
```

`logs` verwendet automatisch den gespeicherten Projektnamen und die gespeicherten Compose-Dateien. Für einen Fehlerbericht reichen Schritt, Exit-Code und die konkrete Fehlermeldung; keine `.env`, Passwörter oder Dumps veröffentlichen.

Nach Behebung der Ursache wieder im Hintergrund fortsetzen:

```bash
sudo -v
```

```bash
sudo -n nohup bash .runtime/update-runner.sh resume > .runtime/server-update-launch.log 2>&1 < /dev/null &
```

`resume` liest den gesicherten Lauf ein. Abgeschlossene Phasen werden übersprungen. Insbesondere werden das ursprüngliche Wartungsbackup und das alte Image nicht durch neue Sicherungen überschrieben. Eine unvollständig ausgeführte Migration bzw. der Realm-Abgleich darf erneut ausgeführt werden; beide sind wiederholbar. Ein bereits vollständig abgeschlossener Lauf wird durch `resume` nicht noch einmal ausgeführt.

Typische Ursachen sind fehlender Speicher, Registry-/DNS-Zugriff beim Build, eine Docker-Netzüberlappung oder ein ungültiger interner Keycloak-Wartungszugang. Das konkrete Protokoll entscheidet. Beim Keycloak-Wartungszugang geht es um `KEYCLOAK_ADMIN_USER/PASSWORD`, nicht um dein persönliches Kundenraum-Administratorkonto. Nach einer bewussten Korrektur der vorhandenen `.env` kannst du den fehlgeschlagenen Schritt fortsetzen; die ursprüngliche `.env` liegt weiterhin im Update-Sicherungsverzeichnis.

Wenn zusätzlich der Server selbst neu gestartet oder nicht erreichbar war, können diese **lesenden** Befehle helfen:

```bash
sudo journalctl -u docker -n 80 --no-pager
sudo journalctl -k -n 100 --no-pager
df -h
```

Damit lassen sich z.B. ein Dienstfehler oder Speicherprobleme prüfen. Ein Verbindungsabbruch allein belegt weder deren Ursache noch eine Docker-Deinstallation.

## Erfolg kontrollieren

Bei `Status: complete` deine **bisherige Domain** im Browser öffnen und vollständig neu laden. Wegen des Realm-/Sitzungsabgleichs neu mit deinem bisherigen persönlichen Administrator anmelden.

Prüfe die vorhandenen Kunden, Servicehistorien und Zahlungen. Reports haben den Bezahl-Button; Kassierer sehen nur ihre zugewiesenen offenen Kunden mit Telefon, MAC/Kennung, Adresse und Punkten. Versand- und Backup-Einstellungen bleiben erhalten. Für Zahlungs-/Restore-Tests eigene Testdaten bzw. eine separate Testumgebung verwenden.

Sicherungen und das ausführliche Updateprotokoll liegen unter dem vom Status genannten `backups/server-update-…`-Verzeichnis. Es enthält vertrauliche Daten und gehört zusätzlich in eine geschützte externe Serversicherung. Diese Dateien werden nicht automatisch gelöscht. Der Updater benötigt keine neue `.env`, kein Setup/Bootstrap und keine neue DNS-/HTTPS-Einrichtung bei unveränderter Domain.

## Abbrechen oder auf Snapshot zurückgehen

Der Updater führt **keinen automatischen Restore**, kein `dropdb`, kein `down -v` und kein Löschen von Volumes aus. Bevor du einen Snapshot zurückspielst, darf kein Update-Prozess mehr laufen. Nutze dazu das im Status/Protokoll gespeicherte Prozess-/Schrittbild und beende einen tatsächlich noch laufenden Updater bewusst; nicht parallel Snapshot und Update ausführen.

Wenn bereits die Migration versucht wurde, nicht nur alte Quelldateien über den neuen Datenbankstand kopieren. Für eine vollständige Rückkehr gehören altes Image, Konfiguration und beide Datenbanken aus demselben Sicherungszeitpunkt zusammen. Die Update-Sicherung enthält `server.env`, `source-before.tar`, `application-image.tar.gz`, `db.dump`, `identity-db.dump` und die Commit-/Projektinformationen. Eine Rücksicherung überschreibt spätere Änderungen und muss ausdrücklich geplant werden. Dein bereits angekündigter zusammengehöriger Server-Snapshot ist dafür ein eigener Rückkehrweg.

Weitere fachliche Betriebsinformationen: [WORKFLOWS.md](WORKFLOWS.md). Die direkte alte `dc`-Befehlsfolge ist durch dieses Skript ersetzt.
