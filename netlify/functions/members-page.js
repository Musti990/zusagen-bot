// Öffentliche Webseite, die alle Servermitglieder mit Rollen und HP/NP-Positionen zeigt.
// Erreichbar unter: https://DEIN-SITE.netlify.app/.netlify/functions/members-page

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseHpNp(nick) {
  const hpMatch = nick.match(/HP:\s*([A-ZÄÖÜ,0-9]+)/);
  const npMatch = nick.match(/NP:\s*([A-ZÄÖÜ,0-9]+)/);
  return {
    hp: hpMatch ? hpMatch[1].split(',').filter(Boolean) : [],
    np: npMatch ? npMatch[1].split(',').filter(Boolean) : [],
  };
}

exports.handler = async (event) => {
  const guildId = event.queryStringParameters?.guild || process.env.GUILD_ID;

  if (!guildId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: '<h1>Fehler</h1><p>Keine Server-ID gefunden. Entweder GUILD_ID als Umgebungsvariable setzen, oder ?guild=DEINE_SERVER_ID an die URL anhängen.</p>',
    };
  }

  const authHeader = { Authorization: `Bot ${process.env.DISCORD_TOKEN}` };

  const [rolesRes, membersRes] = await Promise.all([
    fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, { headers: authHeader }),
    fetch(`https://discord.com/api/v10/guilds/${guildId}/members?limit=1000`, { headers: authHeader }),
  ]);

  if (!rolesRes.ok || !membersRes.ok) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: '<h1>Fehler</h1><p>Konnte Daten nicht von Discord laden. Prüfe DISCORD_TOKEN und ob "Server Members Intent" aktiviert ist.</p>',
    };
  }

  const roles = await rolesRes.json();
  const roleById = {};
  roles.forEach((r) => (roleById[r.id] = r));

  const members = await membersRes.json();

  const rows = members
    .filter((m) => !m.user?.bot)
    .map((m) => {
      const nick = m.nick || m.user?.username || 'Unbekannt';
      const baseName = nick.split('|')[0].trim();
      const { hp, np } = parseHpNp(nick);

      const memberRoles = (m.roles || [])
        .map((id) => roleById[id])
        .filter((r) => r && r.name !== '@everyone')
        .sort((a, b) => b.position - a.position)
        .map((r) => r.name);

      return { baseName, roles: memberRoles, hp, np };
    })
    .sort((a, b) => a.baseName.localeCompare(b.baseName));

  const tableRows = rows
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(r.baseName)}</td>
        <td>${r.roles.map((x) => `<span class="badge">${escapeHtml(x)}</span>`).join(' ') || '—'}</td>
        <td>${r.hp.map((x) => `<span class="badge hp">${escapeHtml(x)}</span>`).join(' ') || '—'}</td>
        <td>${r.np.map((x) => `<span class="badge np">${escapeHtml(x)}</span>`).join(' ') || '—'}</td>
      </tr>`
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Mitgliederübersicht</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; background: #0f0f12; color: #e5e5e5; margin: 0; padding: 2rem 1rem; }
  h1 { text-align: center; margin-bottom: 0.25rem; }
  p.sub { text-align: center; color: #9ca3af; margin-top: 0; margin-bottom: 2rem; }
  table { width: 100%; max-width: 900px; margin: 0 auto; border-collapse: collapse; background: #17171c; border-radius: 12px; overflow: hidden; }
  th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid #26262e; }
  th { background: #1f1f27; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.03em; color: #9ca3af; }
  tr:last-child td { border-bottom: none; }
  tr:hover { background: #1c1c23; }
  .badge { display: inline-block; background: #2a2a33; color: #e5e5e5; padding: 0.15rem 0.5rem; border-radius: 6px; font-size: 0.8rem; margin: 0.1rem; }
  .badge.hp { background: #3730a3; }
  .badge.np { background: #92400e; }
  .count { text-align: center; color: #9ca3af; margin-top: 1.5rem; font-size: 0.9rem; }
</style>
</head>
<body>
  <h1>Mitgliederübersicht</h1>
  <p class="sub">Automatisch aktualisiert direkt aus Discord — Rollen, Haupt- (HP) und Nebenpositionen (NP)</p>
  <table>
    <thead>
      <tr><th>Name</th><th>Rollen</th><th>Hauptposition</th><th>Nebenposition</th></tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>
  <p class="count">${rows.length} Mitglieder</p>
</body>
</html>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: html,
  };
};
