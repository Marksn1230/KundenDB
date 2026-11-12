# Kundenraum

**Bestehenden Server aktualisieren:** [GitHub-Update und Aktivierung ohne Neuinstallation](kundenverwaltung/kundenverwaltung/docs/UPDATE.md).

[Vollständige Installation auf einem neuen Linux-Server: GitHub, PostgreSQL, HTTPS und erster Login](kundenverwaltung/kundenverwaltung/docs/server-installation.md).

Die weiterentwickelte Anwendung befindet sich im vorhandenen inneren Projekt **[kundenverwaltung/kundenverwaltung](kundenverwaltung/kundenverwaltung/README.md)**. Das äußere Next.js-Starterprojekt bleibt erhalten; es ist nicht die Verwaltungsanwendung.

Vom geöffneten Workspace aus:

```powershell
npm run app:install
npm run setup
# Anschließend Keycloak wie in der Projekt-README einrichten.
npm run dev
```

Startanleitung, Migration, erste Administrator-Einrichtung, API und Versandkonfiguration: **[Projekt-README](kundenverwaltung/kundenverwaltung/README.md)**.
