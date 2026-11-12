# Bestehende Serverinstallation von GitHub aktualisieren

Diese Anleitung ist für deinen **bereits laufenden Kundenraum mit der bisherigen GitHub-Version**. Sie erhält Kunden, Zahlungszeiträume, Benutzer, Passwörter, Domain und Zertifikate. Keine Neuinstallation durchführen. Die bestehende `.env` nicht durch eine Vorlage ersetzen und `setup`, `setup-server.mjs` oder `bootstrap` für dieses Update nicht erneut ausführen.

GitHub: [Marksn1230/KundenDB, Branch master](https://github.com/Marksn1230/KundenDB/tree/master). Der Anwendungsordner ist `kundenverwaltung/kundenverwaltung` innerhalb des Git-Clones. Nach der bisherigen Installationsanleitung lautet er `/opt/kundenraum/kundenverwaltung/kundenverwaltung`. Falls du einen anderen Installationspfad verwendest, den ersten `cd` entsprechend anpassen.

Voraussetzung ist die bisherige PostgreSQL-Installation mit `compose.server.yml`, nicht die lokale SQLite-/Windows-Konfiguration. Die Befehle in **derselben SSH-Bash-Sitzung** ausführen. Bei einem Fehler anhalten. Der Image-Build läuft zunächst bei weiter erreichbarer alter Anwendung. Für die zusammengehörigen Datenbanksicherungen und die Migration gibt es anschließend eine kurze Wartungsunterbrechung.

## 1. Bisherigen Stand und Konfiguration sichern

```bash
set -euo pipefail
cd /opt/kundenraum/kundenverwaltung/kundenverwaltung
test -f compose.server.yml
test -f .env
repo_dir="$(git rev-parse --show-toplevel)"
app_dir="$PWD"
umask 077

git status --short
test -z "$(git status --porcelain --untracked-files=normal)"
if git remote get-url origin >/dev/null 2>&1; then
  update_remote=origin
else
  update_remote=orgin
fi
git remote get-url "$update_remote"

dc() { sudo docker compose -f compose.server.yml "$@"; }
dc ps
web_container="$(dc ps -q web)"
test -n "$web_container"

df -h .
update_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="$app_dir/backups/update-$update_stamp"
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"

git rev-parse HEAD > "$backup_dir/commit-before.txt"
cp -p .env "$backup_dir/server.env"
chmod 600 "$backup_dir/server.env"
cp compose.server.yml "$backup_dir/compose-before.yml"
git archive --format=tar HEAD > "$backup_dir/source-before.tar"
sudo docker inspect --format '{{.Config.Image}}' "$web_container" > "$backup_dir/original-image.txt"
old_image_id="$(sudo docker inspect --format '{{.Image}}' "$web_container")"
rollback_image="kundenraum:rollback-$update_stamp"
sudo docker image tag "$old_image_id" "$rollback_image"
printf '%s\n' "$rollback_image" > "$backup_dir/rollback-image.txt"
sudo docker image save "$rollback_image" | gzip > "$backup_dir/application-image.tar.gz"
test -s "$backup_dir/application-image.tar.gz"
printf 'Update-Sicherung: %s\n' "$backup_dir"
```

`git status --short` muss leer sein. Bei lokalen Quellcodeänderungen zuerst deren Ursache klären; diese Anleitung überschreibt sie nicht mit `git reset` oder `git clean`. Die bisherigen `.env`, `data`, `backups` und Laufzeitdateien sind ignoriert und bleiben erhalten. Falls Git für deinen Server einen SSH-Deploy-Key verwendet, bleibt dessen bisherige Einrichtung bestehen.

Die Funktion `dc` verwendet das vorhandene Compose-Projekt. Falls du ursprünglich ein eigenes `-p PROJEKTNAME` verwendet hast, dieses **auch in der Funktion `dc`** ergänzen, beispielsweise `sudo docker compose -p meinprojekt -f compose.server.yml "$@"`. Nicht mit einem neuen Projektnamen starten: Dadurch würden andere Datenvolumes angelegt.

Das alte Image wird vor dem Build zusätzlich unter einem Rollback-Tag gesichert. Genügend Speicher für altes/neues Image und beide Datenbankdumps vorsehen. Das Sicherungsverzeichnis enthält vertrauliche Daten; nach erfolgreichem Update zusätzlich geschützt außerhalb des Servers sichern.

## 2. Neue Version pullen und bauen

```bash
git -C "$repo_dir" switch master
git -C "$repo_dir" pull --ff-only "$update_remote" master
git -C "$repo_dir" rev-parse HEAD

test -f migrations/postgres/002_customer_workflows.sql
test -f scripts/sync-login-policy.mjs
cmp .env "$backup_dir/server.env"
dc config --quiet
dc build web
```

`git pull --ff-only` stoppt bei abweichenden lokalen Commits, statt sie zusammenzuführen oder zu überschreiben. Der Build ersetzt noch keinen laufenden Container. `cmp` stellt sicher, dass die Servergeheimnisse unverändert sind. `APP_VERSION` darf bei seinem vorhandenen Wert bleiben: Das lokal gebaute Image erhält diesen Tag; der alte Stand ist zusätzlich über den Rollback-Tag gesichert. Für dieses Update sind weder ein GHCR-Login noch ein Paketmanager auf dem Server erforderlich.

Wenn Pull oder Build fehlschlagen, **nicht mit Schritt 3 fortfahren**. Die bisherigen Container bleiben in Betrieb. Nur `git pull` oder `docker compose restart` allein aktiviert diese Erweiterung nicht.

## 3. Dienste anhalten und beide Datenbanken gemeinsam sichern

```bash
dc stop caddy web worker keycloak

dc exec -T db pg_dump -U postgres -d kundenraum -Fc > "$backup_dir/kundenraum.dump"
dc exec -T identity-db pg_dump -U postgres -d keycloak -Fc > "$backup_dir/keycloak.dump"
test -s "$backup_dir/kundenraum.dump"
test -s "$backup_dir/keycloak.dump"

dc exec -T db pg_restore --list < "$backup_dir/kundenraum.dump" > "$backup_dir/kundenraum.contents"
dc exec -T identity-db pg_restore --list < "$backup_dir/keycloak.dump" > "$backup_dir/keycloak.contents"
test -s "$backup_dir/kundenraum.contents"
test -s "$backup_dir/keycloak.contents"

dc exec -T db psql -U postgres -d kundenraum -At -v ON_ERROR_STOP=1 \
  -c "SELECT 'customers='||COUNT(*) FROM customers; SELECT 'periods='||COUNT(*) FROM periods;" \
  > "$backup_dir/counts-before.txt"
cat "$backup_dir/counts-before.txt"
```

Nur bei erfolgreichen Sicherungen fortfahren. Die Archivlistenprüfung erkennt beschädigte Formate; sie ersetzt keinen vollständigen Restore-Test. Alle folgenden Schritte setzen voraus, dass die genannten Datenbanken aus der bisherigen Installation tatsächlich `kundenraum` und `keycloak` heißen. Individuell geänderte Datenbanknamen vorher in diesen Befehlen anpassen.

Bei einem Backupfehler die Ursache beheben und die Sicherung wiederholen; keine Migration starten. Die bisherige Datenbank wurde bis hierhin nicht verändert. Wenn du das Update abbrechen möchtest, den gesicherten Quellstand und das alte Image wie unter Rückkehr beschrieben aktivieren; eine Datenbankrücksicherung ist vor der Migration nicht nötig.

## 4. Datenbank migrieren, laufenden Keycloak-Realm abgleichen, aktivieren

```bash
dc up -d --wait db identity-db restore-db keycloak
dc run --rm migrate
dc run --rm identity-policy
dc up -d --wait web worker caddy
dc ps
```

Erwartete Migrationsausgabe: PostgreSQL **Version 2**. Kundennummern, gespeicherte Zahlungsfälligkeiten und historische Zeiträume bleiben erhalten. Die neuen Felder für Zahlungsmethode und Kassierer starten ohne automatische Zuordnung. Es gibt weiterhin Punkte; es wird kein Preisfeld ergänzt.

`identity-policy` ist für einen **bereits vorhandenen Realm erforderlich**. Ein Realm-Import beim Containerstart aktualisiert vorhandene Realms nicht. Der Befehl wartet auf einen bereiten Keycloak, setzt Realm-/Client-Inaktivität auf 60 Minuten, erhält die separate maximale Sitzungsdauer von 8 Stunden, ergänzt die Kassiererrolle und gleicht den Passwort-/Conditional-OTP-Flow ab. Vorhandene persönliche Konten, Passwörter und OTP-Geräte werden nicht neu angelegt. Bestehende Sitzungen werden beendet; anschließend frisch anmelden.

Die neue separate PostgreSQL-Instanz `restore-db` dient der Uploadprüfung für Web-Wiederherstellungen. Ihre Zugangsdaten werden aus der **bestehenden** Compose-Konfiguration abgeleitet. Dafür sind keine neuen Geheimnisse in `.env` nötig. Die neuen Volumes `restore-db-data` und `restore-safety-backups` bleiben erhalten; letzteres in die externe Serversicherung aufnehmen. Das interne Proxynetz `172.30.93.0/29` muss frei sein. Bei einer Netzüberlappung gemäß [WORKFLOWS.md](WORKFLOWS.md) die zusammengehörigen Proxyadressen anpassen, bevor die Dienste gestartet werden.

Die öffentliche 2FA-IP-Liste wird **leer** ausgeliefert. Die während unseres lokalen Tests aktivierte Ausnahme unter `.runtime/manual-2fa.yml` wird nicht auf deinen Server übertragen. Für Administrator und Mitarbeiter gilt auf dem Server weiterhin OTP, sofern du selbst keine öffentliche IP freigibst. Kassierer benötigen kein OTP. Verwende auf dem Server ausschließlich `compose.server.yml`, keine `compose.acceptance.yml`, Testzertifikate oder lokale `.runtime`-Overlays.

Bei einer Fehlermeldung nicht einfach `bootstrap` oder das Setup erneut ausführen. Bei ungültigem Keycloak-Wartungszugang einen gültigen internen Verwaltungszugang in der vorhandenen `.env` konfigurieren und `identity-policy` erneut ausführen. Das ist ein anderer Zugang als dein persönlicher Administrator-Login.

## 5. Nach dem Update prüfen

```bash
dc exec -T db psql -U postgres -d kundenraum -At -v ON_ERROR_STOP=1 \
  -c "SELECT version FROM schema_migrations ORDER BY version; SELECT 'customers='||COUNT(*) FROM customers; SELECT 'periods='||COUNT(*) FROM periods;"
dc exec -T web printenv SESSION_IDLE_SECONDS
dc exec -T web node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(async r=>{console.log(r.status,await r.text());process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
dc logs --tail=60 web worker keycloak caddy
```

Erwartet: Migrationen 1 und 2, unveränderte Kunden-/Periodenzahlen gegenüber `counts-before.txt`, `SESSION_IDLE_SECONDS=3600` und Health-HTTP **200**. Die zusätzliche Restore-Instanz besitzt keine öffentlich erreichbaren Ports. Die ursprünglichen Kunden- und Identity-Volumes sowie die Caddy-Zertifikatsvolumes bleiben dieselben.

Öffne anschließend **deine bisherige Domain** und lade die Seite vollständig neu:

1. Mit dem bisherigen persönlichen Administrator anmelden und vorhandene Kunden prüfen.
2. Reports → Offene Zahlungen: Als bezahlt markieren bezahlt den angezeigten Zeitraum. Zum Funktionstest einen eigenen Testkunden verwenden, keinen echten offenen Posten unbeabsichtigt bezahlen.
3. Einstellungen → Login-Konten: Bei Bedarf Kassierer anlegen; anschließend konkrete Kunden im Kundenformular zuweisen. Kassierer sehen nur ihre eigenen offenen aktuellen Zeiträume mit Telefon, MAC/Kennung, Adresse, Punkten und Zahlungsdaten.
4. Telegram: erste tägliche Zeit, optional zweite Zeit einstellen. Die vorhandenen Ein-/Aus-Schalter bleiben erhalten. Einen Testversand ausschließlich an den dafür vorgesehenen Empfänger ausführen.
5. Einstellungen → Datenbank-Backup: ein Backup herunterladen und sicher aufbewahren. Einen Restore-Test ausschließlich in einer separaten Testumgebung durchführen.

Eine zusätzliche DNS-/Domain-/HTTPS-Einrichtung ist bei unveränderter Domain nicht erforderlich. Alle Details zu Rollen, IP-Liste, Telegram und Wiederherstellung stehen in [WORKFLOWS.md](WORKFLOWS.md).

## Rückkehr zum vorherigen Stand

Bei einem Fehler während des Updates und **bevor der neue Stand wieder für echte Schreibzugriffe geöffnet wurde**, kannst du zum gemeinsamen Wartungsbackup zurückkehren. Wurde bereits im neuen Stand gearbeitet, würde das Zurückspielen diese späteren Änderungen verlieren. In diesem Fall zuerst beide aktuellen Datenbanken zusätzlich sichern und die Übernahme dieser Änderungen planen.

Die folgenden Schritte sind eine bewusste Rücksicherung: Sie ersetzen beide Datenbanken durch die gesicherten Stände. **Nur bei tatsächlich notwendigem Rollback ausführen**, nicht nach einem erfolgreichen Update. Prüfe zuerst den angezeigten Sicherungspfad und beide Dumps. Keine Volumes löschen und kein `down -v` ausführen.

Wenn dieselbe SSH-Sitzung noch offen ist, sind `backup_dir` und `dc` bereits gesetzt. Nach einer neuen Anmeldung zuerst den tatsächlichen Sicherungspfad einsetzen:

```bash
set -euo pipefail
cd /opt/kundenraum/kundenverwaltung/kundenverwaltung
app_dir="$PWD"
repo_dir="$(git rev-parse --show-toplevel)"
read -r -p 'Vollständiger Pfad zur Update-Sicherung: ' backup_dir
test -d "$backup_dir"
test -s "$backup_dir/commit-before.txt"
test -s "$backup_dir/server.env"
test -s "$backup_dir/kundenraum.dump"
test -s "$backup_dir/keycloak.dump"
dc() { sudo docker compose -f compose.server.yml "$@"; }
printf 'Rücksicherung aus: %s\n' "$backup_dir"
```

Auch hier gegebenenfalls denselben eigenen Compose-Projektnamen in `dc` ergänzen. Danach nur bei bestätigtem Ziel fortfahren:

```bash
umask 077
dc stop caddy web worker keycloak
# Auch den aktuellen Fehlerzustand vor der Rücksicherung erhalten.
dc exec -T db pg_dump -U postgres -d kundenraum -Fc > "$backup_dir/before-rollback-kundenraum.dump"
dc exec -T identity-db pg_dump -U postgres -d keycloak -Fc > "$backup_dir/before-rollback-keycloak.dump"

dc exec -T db dropdb -U postgres --if-exists --force kundenraum
dc exec -T db createdb -U postgres -O kundenraum kundenraum
dc exec -T db pg_restore -U postgres --role=kundenraum --no-owner --no-acl --exit-on-error -d kundenraum < "$backup_dir/kundenraum.dump"

dc exec -T identity-db dropdb -U postgres --if-exists --force keycloak
dc exec -T identity-db createdb -U postgres -O keycloak keycloak
dc exec -T identity-db pg_restore -U postgres --role=keycloak --no-owner --no-acl --exit-on-error -d keycloak < "$backup_dir/keycloak.dump"

git -C "$repo_dir" switch --detach "$(cat "$backup_dir/commit-before.txt")"
cp -p "$backup_dir/server.env" .env
rollback_image="$(cat "$backup_dir/rollback-image.txt")"
if ! sudo docker image inspect "$rollback_image" >/dev/null 2>&1; then
  gzip -dc "$backup_dir/application-image.tar.gz" | sudo docker image load
fi
sudo docker image tag "$rollback_image" "$(cat "$backup_dir/original-image.txt")"
dc up -d --wait db identity-db keycloak web worker caddy
dc ps
```

Der alte Quellstand, das alte Image, die alte `.env` und beide Datenbanken gehören danach wieder zusammen. Nicht zusätzlich die neue Migration gegen den zurückgesicherten alten Stand ausführen. Die ungenutzten neuen Restore-Volumes können bestehen bleiben. Nach der Rückkehr neu anmelden und Kunden-/Periodenzahlen prüfen. Ein späterer neuer Updateversuch beginnt wieder mit `git switch master` und einer frischen Wartungssicherung.
