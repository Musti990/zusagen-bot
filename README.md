# Loco Event Bot (Netlify-Variante)

Gleicher Bot wie zuvor (✅ Accepted / ❓ Maybe / ❌ Declined per Button, Limit,
Live-Countdown), aber **ohne Dauerprozess** — läuft komplett über eine
Netlify Function, die Discord bei jedem Klick kurz aufruft (HTTP Interactions
statt Gateway/WebSocket). Passt perfekt zum Netlify-Gratistarif.

## 1. Discord Application vorbereiten

1. https://discord.com/developers/applications → **New Application**.
2. Unter **General Information**:
   - **Application ID** kopieren → `APPLICATION_ID`
   - **Public Key** kopieren → `DISCORD_PUBLIC_KEY`
3. Unter **Bot** → **Reset Token** → Token kopieren → `DISCORD_TOKEN`
   (wird nur lokal für die einmalige Befehlsregistrierung gebraucht).
4. Unter **OAuth2 → URL Generator**: Scopes `bot` + `applications.commands`,
   Permission `Send Messages` + `Embed Links`. Link öffnen, Bot auf den
   Server einladen lassen (braucht "Server verwalten"-Recht der einladenden
   Person, wie besprochen).

**Wichtig:** Das Feld **"Interactions Endpoint URL"** auf der General-
Information-Seite lässt sich erst ausfüllen, NACHDEM die Netlify Function
live ist (Discord testet die URL sofort beim Speichern). Also erst deployen
(Schritt 3), dann diese URL eintragen.

## 2. Projekt einrichten

```bash
npm install
cp .env.example .env
```

`.env` ausfüllen mit `APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_TOKEN`
(und optional `GUILD_ID` für sofortige statt globale Registrierung).

## 3. Auf Netlify deployen

- Projektordner in ein GitHub-Repo pushen und auf https://app.netlify.com
  als neue Site importieren (oder `netlify deploy --prod` mit der Netlify-CLI).
- In den Netlify **Site settings → Environment variables** nur
  `DISCORD_PUBLIC_KEY` eintragen (mehr braucht die Function nicht).
- Nach dem Deploy ist die Function erreichbar unter:
  `https://DEIN-SITE-NAME.netlify.app/.netlify/functions/interactions`

## 4. Interactions Endpoint URL setzen

Im Developer Portal unter **General Information** bei **Interactions
Endpoint URL** genau diese Netlify-URL eintragen und speichern. Discord
schickt einen Test-Ping; wenn die Function korrekt antwortet, wird
gespeichert (grüner Haken).

## 5. Slash-Command registrieren (einmalig, lokal)

```bash
npm run register
```

Das trägt `/event` bei Discord ein (bei gesetzter `GUILD_ID` sofort sichtbar,
sonst global nach bis zu einer Stunde).

## 6. Benutzen

```
/event titel:LOCO NIGHT CUP datum:14.09.2026 uhrzeit:22:50 limit:20 info:AFC Beko | zom-wi
```

## Speicherung der Anmeldungen

Die Event-Daten (wer zugesagt/vielleicht/abgesagt hat) liegen in
**Netlify Blobs** — einem einfachen Key-Value-Speicher, der automatisch zur
Netlify-Site gehört und im Gratistarif enthalten ist. Kein externer Dienst
nötig.

## Grenzen dieser Variante

- Netlify-Function-Aufrufe sind im Gratistarif limitiert (Stand: 125.000
  Aufrufe/Monat) — für ein Event-Bot in einem normalen Discord-Server
  bei weitem ausreichend.
- Es gibt keinen Dauerprozess, der z.B. proaktiv Nachrichten schicken könnte
  (Erinnerungen o.ä.) — der Bot reagiert nur auf Klicks/Commands, das reicht
  aber für den hier gewünschten Anwendungsfall komplett aus.
