// Öffentliche Webseite, die alle Servermitglieder mit Rollen und HP/NP-Positionen zeigt.
// Mit Filter-Sidebar (nach Rolle) und sortierbaren Spalten (clientseitig, kein Reload nötig).
// Erreichbar unter: https://DEIN-SITE.netlify.app/.netlify/functions/members-page

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/\n/g, ' ');
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

  // Rollen für die Sidebar sammeln, priorisiert 1./2. Mannschaft zuerst, Rest alphabetisch danach
  const allRoleNames = [...new Set(rows.flatMap((r) => r.roles))];
  const priority = ['1 Mannschaft', '2 Mannschaft'];
  const sidebarRoles = [
    ...priority.filter((p) => allRoleNames.includes(p)),
    ...allRoleNames.filter((r) => !priority.includes(r)).sort((a, b) => a.localeCompare(b)),
  ];

  const filterButtons = [
    `<button class="filter-btn active" data-role="__all__">Alle <span class="count">${rows.length}</span></button>`,
    ...sidebarRoles.map((r) => {
      const c = rows.filter((row) => row.roles.includes(r)).length;
      return `<button class="filter-btn" data-role="${escapeAttr(r)}">${escapeHtml(r)} <span class="count">${c}</span></button>`;
    }),
  ].join('');

  const tableRows = rows
    .map(
      (r) => `
      <tr data-roles="${escapeAttr(r.roles.join('|'))}" data-name="${escapeAttr(r.baseName)}">
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
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; background: #0f0f12; color: #e5e5e5; margin: 0; padding: 0; }
  header { text-align: center; padding: 2rem 1rem 1rem; }
  h1 { margin-bottom: 0.25rem; }
  p.sub { color: #9ca3af; margin-top: 0; }
  .layout { display: flex; gap: 1.5rem; max-width: 1100px; margin: 0 auto; padding: 0 1rem 2rem; align-items: flex-start; flex-wrap: wrap; }
  aside { background: #17171c; border-radius: 12px; padding: 1rem; min-width: 200px; flex: 0 0 200px; }
  aside h3 { margin: 0 0 0.75rem; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.03em; color: #9ca3af; }
  .filter-btn { display: flex; justify-content: space-between; align-items: center; width: 100%; text-align: left; background: transparent; border: none; color: #e5e5e5; padding: 0.5rem 0.6rem; border-radius: 8px; cursor: pointer; font-size: 0.9rem; margin-bottom: 0.15rem; }
  .filter-btn:hover { background: #1f1f27; }
  .filter-btn.active { background: #3730a3; color: #fff; }
  .filter-btn .count { color: #9ca3af; font-size: 0.8rem; }
  .filter-btn.active .count { color: #c7d2fe; }
  main { flex: 1; min-width: 300px; }
  table { width: 100%; border-collapse: collapse; background: #17171c; border-radius: 12px; overflow: hidden; }
  th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid #26262e; }
  th { background: #1f1f27; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.03em; color: #9ca3af; cursor: pointer; user-select: none; white-space: nowrap; }
  th:hover { color: #e5e5e5; }
  th .arrow { opacity: 0.4; margin-left: 0.25rem; font-size: 0.75rem; }
  tr:last-child td { border-bottom: none; }
  tr:hover { background: #1c1c23; }
  tr.hidden { display: none; }
  .badge { display: inline-block; background: #2a2a33; color: #e5e5e5; padding: 0.15rem 0.5rem; border-radius: 6px; font-size: 0.8rem; margin: 0.1rem; }
  .badge.hp { background: #3730a3; }
  .badge.np { background: #92400e; }
  .count-line { text-align: center; color: #9ca3af; margin-top: 1.25rem; font-size: 0.9rem; }
  @media (max-width: 700px) {
    .layout { flex-direction: column; }
    aside { flex: 1 1 auto; width: 100%; }
  }
</style>
</head>
<body>
  <header>
    <h1>Mitgliederübersicht</h1>
    <p class="sub">Automatisch aktualisiert direkt aus Discord — Rollen, Haupt- (HP) und Nebenpositionen (NP)</p>
  </header>
  <div class="layout">
    <aside>
      <h3>Nach Rolle filtern</h3>
      ${filterButtons}
    </aside>
    <main>
      <table id="members-table">
        <thead>
          <tr>
            <th data-sort="name">Name <span class="arrow">↕</span></th>
            <th data-sort="roles">Rollen <span class="arrow">↕</span></th>
            <th data-sort="hp">Hauptposition <span class="arrow">↕</span></th>
            <th data-sort="np">Nebenposition <span class="arrow">↕</span></th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
      <p class="count-line" id="count-line">${rows.length} Mitglieder</p>
    </main>
  </div>

  <script>
    (function () {
      const table = document.getElementById('members-table');
      const tbody = table.querySelector('tbody');
      const countLine = document.getElementById('count-line');
      const filterButtons = document.querySelectorAll('.filter-btn');
      let currentRole = '__all__';
      let sortKey = 'name';
      let sortAsc = true;

      function applyFilter() {
        const rows = Array.from(tbody.querySelectorAll('tr'));
        let visible = 0;
        rows.forEach((row) => {
          const roles = (row.dataset.roles || '').split('|');
          const match = currentRole === '__all__' || roles.includes(currentRole);
          row.classList.toggle('hidden', !match);
          if (match) visible++;
        });
        countLine.textContent = visible + ' Mitglieder' + (currentRole === '__all__' ? '' : ' (gefiltert nach "' + currentRole + '")');
      }

      filterButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
          filterButtons.forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          currentRole = btn.dataset.role;
          applyFilter();
        });
      });

      function cellText(row, key) {
        const cellIndex = { name: 0, roles: 1, hp: 2, np: 3 }[key];
        return row.children[cellIndex].textContent.trim().toLowerCase();
      }

      function applySort() {
        const rows = Array.from(tbody.querySelectorAll('tr'));
        rows.sort((a, b) => {
          const av = cellText(a, sortKey);
          const bv = cellText(b, sortKey);
          if (av < bv) return sortAsc ? -1 : 1;
          if (av > bv) return sortAsc ? 1 : -1;
          return 0;
        });
        rows.forEach((row) => tbody.appendChild(row));
      }

      table.querySelectorAll('th[data-sort]').forEach((th) => {
        th.addEventListener('click', () => {
          const key = th.dataset.sort;
          if (sortKey === key) {
            sortAsc = !sortAsc;
          } else {
            sortKey = key;
            sortAsc = true;
          }
          table.querySelectorAll('th .arrow').forEach((a) => (a.textContent = '↕'));
          th.querySelector('.arrow').textContent = sortAsc ? '↑' : '↓';
          applySort();
        });
      });
    })();
  </script>
</body>
</html>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: html,
  };
};
