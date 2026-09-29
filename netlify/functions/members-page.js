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

  const [rolesRes, membersRes, channelsRes] = await Promise.all([
    fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, { headers: authHeader }),
    fetch(`https://discord.com/api/v10/guilds/${guildId}/members?limit=1000`, { headers: authHeader }),
    fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, { headers: authHeader }),
  ]);

  if (!rolesRes.ok || !membersRes.ok) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: '<h1>Fehler</h1><p>Konnte Daten nicht von Discord laden. Prüfe DISCORD_TOKEN und ob "Server Members Intent" aktiviert ist.</p>',
    };
  }

  const channels = channelsRes.ok ? await channelsRes.json() : [];
  const textChannels = channels.filter((c) => c.type === 0).sort((a, b) => (a.position || 0) - (b.position || 0));

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

  const channelOptions = textChannels
    .map((c) => `<option value="${escapeAttr(c.id)}">#${escapeHtml(c.name)}</option>`)
    .join('');

  // Formation-Code -> welcher HP/NP-Tag-Code dafür zählt (LS/RS nutzen den generischen "ST"-Tag aus /position)
  const POSITION_TO_TAG = {
    TW: 'TW', LIV: 'LIV', ZIV: 'ZIV', RIV: 'RIV',
    LM: 'LM', RM: 'RM', ZDM: 'ZDM', ZDM2: 'ZDM', ZOM: 'ZOM',
    LS: 'ST', RS: 'ST',
  };

  function buildPlayerOptions(posCode) {
    const tag = POSITION_TO_TAG[posCode];
    const hpMatches = rows.filter((r) => r.hp.includes(tag));
    const npMatches = rows.filter((r) => r.np.includes(tag) && !r.hp.includes(tag));
    const others = rows.filter((r) => !r.hp.includes(tag) && !r.np.includes(tag));

    const opt = (r) => `<option value="${escapeAttr(r.baseName)}">${escapeHtml(r.baseName)}</option>`;

    let html = '<option value="">—</option>';
    if (hpMatches.length > 0) html += `<optgroup label="Hauptposition ${tag}">${hpMatches.map(opt).join('')}</optgroup>`;
    if (npMatches.length > 0) html += `<optgroup label="Nebenposition ${tag}">${npMatches.map(opt).join('')}</optgroup>`;
    html += `<optgroup label="Andere Spieler" class="others-group">${others.map(opt).join('')}</optgroup>`;
    return html;
  }

  const POSITION_GROUPS = [
    { title: '🔺 Sturm', codes: ['LS', 'RS'] },
    { title: '↔️ Flügel', codes: ['LM', 'RM'] },
    { title: '🔸 Mittelfeld', codes: ['ZDM', 'ZOM', 'ZDM2'] },
    { title: '🔹 Abwehr', codes: ['LIV', 'ZIV', 'RIV'] },
    { title: '🥅 Tor', codes: ['TW'] },
  ];

  // Koordinaten (% von links/oben) für die Spielfeld-Vorschau, Angriff = oben
  const PITCH_COORDS = {
    LS: [35, 15], RS: [65, 15],
    LM: [8, 42], ZDM: [30, 55], ZOM: [50, 45], ZDM2: [70, 55], RM: [92, 42],
    LIV: [22, 72], ZIV: [50, 75], RIV: [78, 72],
    TW: [50, 92],
  };

  const pitchMarkersHtml = Object.entries(PITCH_COORDS)
    .map(
      ([code, [x, y]]) => `
      <div class="pitch-marker" style="left:${x}%; top:${y}%;" data-marker="${code}">
        <div class="jersey">${code === 'ZDM2' ? 'ZDM' : code}</div>
        <div class="marker-name">—</div>
      </div>`
    )
    .join('');

  const pitchLinesHtml = `
    <div class="pitch-line-h" style="top:50%;"></div>
    <div class="pitch-circle"></div>
    <div class="pitch-box top"></div>
    <div class="pitch-box bottom"></div>
  `;

  const positionGroupsHtml = POSITION_GROUPS.map(
    (g) => `
      <div class="pos-group">
        <h4>${g.title}</h4>
        <div class="pos-fields">
          ${g.codes
            .map(
              (c) => `
            <label class="pos-field">
              <span>${c === 'ZDM2' ? 'ZDM' : c}</span>
              <select class="pos-select filtered" data-pos="${c}">${buildPlayerOptions(c)}</select>
            </label>`
            )
            .join('')}
        </div>
      </div>`
  ).join('');

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
  .lineup-builder { background: #17171c; border-radius: 12px; padding: 1.25rem; margin-top: 1.5rem; }
  .lineup-builder h2 { margin-top: 0; font-size: 1.1rem; }
  .lineup-top-row { display: flex; gap: 1rem; margin-bottom: 1.25rem; flex-wrap: wrap; }
  .top-field { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.8rem; color: #9ca3af; flex: 1; min-width: 160px; }
  .top-field select, .top-field input[type="text"], .top-field textarea { background: #0f0f12; color: #e5e5e5; border: 1px solid #2a2a33; border-radius: 8px; padding: 0.5rem; font-size: 0.9rem; font-family: inherit; resize: vertical; }
  .top-field.full-width { flex: 1 1 100%; }
  .builder-columns { display: flex; gap: 1.5rem; flex-wrap: wrap; align-items: flex-start; }
  .builder-fields { flex: 1 1 320px; min-width: 280px; }
  .pitch-preview { flex: 0 0 260px; }
  .pitch {
    position: relative;
    width: 100%;
    aspect-ratio: 2 / 3;
    min-height: 360px;
    border-radius: 10px;
    overflow: hidden;
    background: repeating-linear-gradient(to bottom, #2f9e44 0, #2f9e44 12%, #37b24d 12%, #37b24d 24%);
    border: 3px solid rgba(255,255,255,0.85);
  }
  .pitch-line-h { position: absolute; left: 0; right: 0; height: 2px; background: rgba(255,255,255,0.85); }
  .pitch-circle {
    position: absolute; left: 50%; top: 50%; width: 90px; height: 90px;
    border: 2px solid rgba(255,255,255,0.85); border-radius: 50%;
    transform: translate(-50%, -50%);
  }
  .pitch-box {
    position: absolute; left: 20%; width: 60%; height: 14%;
    border: 2px solid rgba(255,255,255,0.85);
  }
  .pitch-box.top { top: 0; border-top: none; }
  .pitch-box.bottom { bottom: 0; border-bottom: none; }
  .pitch-marker {
    position: absolute;
    transform: translate(-50%, -50%);
    display: flex; flex-direction: column; align-items: center;
    gap: 0.15rem;
    z-index: 2;
  }
  .jersey {
    width: 32px; height: 32px; border-radius: 50%;
    background: #111827; border: 2px solid #fff; color: #fff;
    display: flex; align-items: center; justify-content: center;
    font-size: 0.6rem; font-weight: bold;
  }
  .marker-name {
    background: rgba(0,0,0,0.65); color: #fff; font-size: 0.65rem;
    padding: 0.1rem 0.35rem; border-radius: 5px; white-space: nowrap;
    max-width: 90px; overflow: hidden; text-overflow: ellipsis;
  }
  @media (max-width: 700px) {
    .builder-columns { flex-direction: column; }
    .pitch-preview { flex: 1 1 auto; width: 100%; max-width: 320px; margin: 0 auto; }
  }
  .pos-group { margin-bottom: 1rem; }
  .pos-group h4 { margin: 0 0 0.5rem; font-size: 0.85rem; color: #9ca3af; }
  .pos-fields { display: flex; gap: 0.75rem; flex-wrap: wrap; }
  .pos-field { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.75rem; color: #9ca3af; }
  .pos-field select { background: #0f0f12; color: #e5e5e5; border: 1px solid #2a2a33; border-radius: 8px; padding: 0.4rem; font-size: 0.85rem; min-width: 130px; }
  select.filtered optgroup.others-group { display: none; }
  .show-all-toggle { display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; color: #9ca3af; margin-bottom: 1rem; cursor: pointer; }
  .show-all-toggle input { cursor: pointer; }
  #post-btn { margin-top: 0.5rem; background: #3730a3; color: #fff; border: none; padding: 0.65rem 1.25rem; border-radius: 8px; font-size: 0.9rem; cursor: pointer; }
  #post-btn:hover { background: #4338ca; }
  #post-btn:disabled { opacity: 0.6; cursor: not-allowed; }
  #post-status { margin-top: 0.6rem; font-size: 0.85rem; }
  #post-status.success { color: #4ade80; }
  #post-status.error { color: #f87171; }
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

      <section class="lineup-builder">
        <h2>Aufstellung erstellen (3-5-2)</h2>
        <div class="lineup-top-row">
          <label class="top-field">
            <span>Mannschaft</span>
            <input type="text" id="team-select" value="1 Mannschaft" list="team-suggestions" />
            <datalist id="team-suggestions">
              <option value="1 Mannschaft"></option>
              <option value="2 Mannschaft"></option>
            </datalist>
          </label>
          <label class="top-field">
            <span>Kanal</span>
            <select id="channel-select">${channelOptions}</select>
          </label>
        </div>

        <label class="show-all-toggle">
          <input type="checkbox" id="show-all-toggle" />
          <span>Alle Spieler anzeigen (statt nur passende Positionen)</span>
        </label>

        <label class="top-field full-width">
          <span>Beschreibung (optional)</span>
          <textarea id="description-input" rows="2" placeholder="z.B. Anpfiff 15 Uhr, bitte pünktlich sein"></textarea>
        </label>

        <div class="builder-columns">
          <div class="builder-fields">
            ${positionGroupsHtml}
          </div>
          <div class="pitch-preview">
            <div class="pitch">
              ${pitchLinesHtml}
              ${pitchMarkersHtml}
            </div>
          </div>
        </div>

        <button id="post-btn">In Discord posten</button>
        <p id="post-status"></p>
      </section>
    </main>
  </div>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
  <script>
    (function () {
      const postBtn = document.getElementById('post-btn');
      const statusEl = document.getElementById('post-status');
      const showAllToggle = document.getElementById('show-all-toggle');

      showAllToggle.addEventListener('change', () => {
        document.querySelectorAll('select.pos-select').forEach((sel) => {
          sel.classList.toggle('filtered', !showAllToggle.checked);
        });
      });

      document.querySelectorAll('select[data-pos]').forEach((sel) => {
        sel.addEventListener('change', () => {
          const marker = document.querySelector('.pitch-marker[data-marker="' + sel.dataset.pos + '"]');
          if (marker) {
            marker.querySelector('.marker-name').textContent = sel.value || '—';
          }
        });
      });

      postBtn.addEventListener('click', async () => {
        const positions = {};
        document.querySelectorAll('[data-pos]').forEach((sel) => {
          if (sel.value) positions[sel.dataset.pos] = sel.value;
        });
        const team = document.getElementById('team-select').value;
        const channelId = document.getElementById('channel-select').value;
        const description = document.getElementById('description-input').value;

        if (!channelId) {
          statusEl.textContent = '❌ Bitte einen Kanal auswählen.';
          statusEl.className = 'error';
          return;
        }

        postBtn.disabled = true;
        statusEl.textContent = 'Erstelle Bild vom Spielfeld …';
        statusEl.className = '';

        try {
          const pitchEl = document.querySelector('.pitch');
          const canvas = await html2canvas(pitchEl, { backgroundColor: null, scale: 2 });
          const image = canvas.toDataURL('image/png');

          statusEl.textContent = 'Wird gepostet …';

          const res = await fetch('/.netlify/functions/post-aufstellung', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ team, channelId, positions, description, image }),
          });
          const data = await res.json();
          if (res.ok) {
            statusEl.textContent = '✅ Aufstellung wurde gepostet!';
            statusEl.className = 'success';
          } else {
            statusEl.textContent = '❌ Fehler: ' + (data.error || 'Unbekannt');
            statusEl.className = 'error';
          }
        } catch (e) {
          statusEl.textContent = '❌ Netzwerkfehler beim Posten.';
          statusEl.className = 'error';
        } finally {
          postBtn.disabled = false;
        }
      });
    })();
  </script>

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
