// Öffentliche Webseite, die alle Servermitglieder mit Rollen und HP/NP-Positionen zeigt.
// Mit Filter-Sidebar (nach Rolle) und sortierbaren Spalten (clientseitig, kein Reload nötig).
// Erreichbar unter: https://DEIN-SITE.netlify.app/.netlify/functions/members-page

const { getStore } = require('@netlify/blobs');

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

// Lädt alle gespeicherten /event-Abstimmungen (aus derselben Blobs-Datenbank wie interactions.js)
// und gibt sie mit Titel, Zeitstempel und den Namen der "Accepted"-Liste zurück.
async function loadEvents(guildId) {
  try {
    const store = getStore({
      name: 'rsvp-events',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN,
    });
    const listResult = await store.list();
    const keys = (listResult.blobs || []).map((b) => b.key);

    const events = [];
    for (const key of keys) {
      try {
        const ev = await store.get(key, { type: 'json' });
        if (ev && (!guildId || !ev.guildId || ev.guildId === guildId)) {
          events.push({
            id: key,
            title: ev.title || 'Ohne Titel',
            timestamp: ev.timestamp || 0,
            accepted: (ev.accepted || []).map((u) => ({ id: u.id, name: u.name, role: u.role || null, votedAt: u.votedAt || null })),
            maybe: (ev.maybe || []).map((u) => ({ id: u.id, name: u.name, role: u.role || null, votedAt: u.votedAt || null })),
            declined: (ev.declined || []).map((u) => ({ id: u.id, name: u.name, role: u.role || null, votedAt: u.votedAt || null })),
          });
        }
      } catch {
        // einzelnes fehlerhaftes Event überspringen, Rest trotzdem laden
      }
    }
    events.sort((a, b) => b.timestamp - a.timestamp);
    return events.slice(0, 30);
  } catch {
    return [];
  }
}

// Scannt die letzten Nachrichten in den (text-)Kanälen, um pro Person den Zeitpunkt
// der letzten Nachricht zu ermitteln. Kein Dauerzuhören nötig, nur ein Abruf bei Seitenaufruf.
async function loadMessageActivity(textChannels, authHeader) {
  const lastMessageByUser = {};
  const channelsToScan = textChannels.slice(0, 10);

  await Promise.all(
    channelsToScan.map(async (ch) => {
      try {
        const res = await fetch(`https://discord.com/api/v10/channels/${ch.id}/messages?limit=100`, {
          headers: authHeader,
        });
        if (!res.ok) return;
        const messages = await res.json();
        for (const msg of messages) {
          if (!msg.author || msg.author.bot) continue;
          const ts = new Date(msg.timestamp).getTime();
          if (!lastMessageByUser[msg.author.id] || ts > lastMessageByUser[msg.author.id]) {
            lastMessageByUser[msg.author.id] = ts;
          }
        }
      } catch {
        // einzelnen Kanal überspringen, Rest trotzdem auswerten
      }
    })
  );

  return lastMessageByUser;
}

// Fasst aus allen gespeicherten Events zusammen, wie oft und wann zuletzt jede Person abgestimmt hat.
function aggregateVoteActivity(votingEvents) {
  const stats = {};
  for (const ev of votingEvents) {
    for (const list of [ev.accepted, ev.maybe, ev.declined]) {
      for (const u of list) {
        if (!u.id) continue;
        if (!stats[u.id]) stats[u.id] = { count: 0, lastVotedAt: 0 };
        stats[u.id].count++;
        if (u.votedAt && u.votedAt > stats[u.id].lastVotedAt) {
          stats[u.id].lastVotedAt = u.votedAt;
        }
      }
    }
  }
  return stats;
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

  const [rolesRes, membersRes, channelsRes, votingEvents] = await Promise.all([
    fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, { headers: authHeader }),
    fetch(`https://discord.com/api/v10/guilds/${guildId}/members?limit=1000`, { headers: authHeader }),
    fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, { headers: authHeader }),
    loadEvents(guildId),
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

      return { id: m.user?.id, baseName, roles: memberRoles, hp, np };
    })
    .sort((a, b) => a.baseName.localeCompare(b.baseName));

  const lastMessageByUser = await loadMessageActivity(textChannels, authHeader);
  const voteStats = aggregateVoteActivity(votingEvents);

  const ACTIVE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // 14 Tage
  const now = Date.now();

  const activityRows = rows.map((r) => {
    const lastMessageAt = lastMessageByUser[r.id] || 0;
    const voteInfo = voteStats[r.id] || { count: 0, lastVotedAt: 0 };
    const lastActive = Math.max(lastMessageAt, voteInfo.lastVotedAt);
    const status = lastActive === 0 ? 'unbekannt' : now - lastActive < ACTIVE_WINDOW_MS ? 'aktiv' : 'inaktiv';
    return {
      baseName: r.baseName,
      lastMessageAt,
      voteCount: voteInfo.count,
      lastVotedAt: voteInfo.lastVotedAt,
      lastActive,
      status,
    };
  });
  activityRows.sort((a, b) => b.lastActive - a.lastActive);

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

  function fmtRelative(ms) {
    if (!ms) return '—';
    const diffMs = Date.now() - ms;
    const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
    if (diffDays <= 0) return 'heute';
    if (diffDays === 1) return 'gestern';
    if (diffDays < 30) return `vor ${diffDays} Tagen`;
    return new Date(ms).toLocaleDateString('de-DE');
  }

  const statusBadge = { aktiv: '🟢 Aktiv', inaktiv: '🔴 Inaktiv', unbekannt: '⚪ Unbekannt' };

  const activityRowsHtml = activityRows
    .map(
      (r) => `
      <tr data-status="${r.status}">
        <td>${escapeHtml(r.baseName)}</td>
        <td>${fmtRelative(r.lastMessageAt)}</td>
        <td>${r.voteCount}</td>
        <td>${fmtRelative(r.lastVotedAt)}</td>
        <td>${statusBadge[r.status]}</td>
      </tr>`
    )
    .join('');

  const channelOptions = textChannels
    .map((c) => `<option value="${escapeAttr(c.id)}">#${escapeHtml(c.name)}</option>`)
    .join('');

  const eventOptions = [
    '<option value="">— Kein Event / alle Spieler —</option>',
    ...votingEvents.map((ev) => {
      const dateLabel = ev.timestamp ? new Date(ev.timestamp * 1000).toLocaleDateString('de-DE') : '';
      return `<option value="${escapeAttr(ev.id)}">${escapeHtml(ev.title)}${dateLabel ? ' (' + dateLabel + ')' : ''} — ${ev.accepted.length} zugesagt</option>`;
    }),
  ].join('');

  const eventManageRows = votingEvents
    .map((ev) => {
      const dateLabel = ev.timestamp ? new Date(ev.timestamp * 1000).toLocaleDateString('de-DE') : '';
      return `
      <li data-event-id="${escapeAttr(ev.id)}">
        <span>${escapeHtml(ev.title)}${dateLabel ? ' (' + dateLabel + ')' : ''} — ${ev.accepted.length} zugesagt</span>
        <button class="delete-event-btn" data-event-id="${escapeAttr(ev.id)}">🗑️ Löschen</button>
      </li>`;
    })
    .join('');

  // Zugesagt- und Abgesagt-Namen pro Event als JSON einbetten, damit die Positions-Dropdowns
  // und die Absagen-Liste clientseitig ohne weiteren Serverkontakt darauf reagieren können.
  const eventAcceptedJson = JSON.stringify(
    Object.fromEntries(votingEvents.map((ev) => [ev.id, ev.accepted]))
  ).replace(/</g, '\\u003c');
  const eventDeclinedJson = JSON.stringify(
    Object.fromEntries(votingEvents.map((ev) => [ev.id, ev.declined]))
  ).replace(/</g, '\\u003c');

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
  .tabs { display: flex; justify-content: center; gap: 0.5rem; padding: 0 1rem 1.5rem; flex-wrap: wrap; }
  .tab-btn { background: #17171c; color: #9ca3af; border: 1px solid #26262e; padding: 0.6rem 1.1rem; border-radius: 10px; font-size: 0.9rem; cursor: pointer; }
  .tab-btn:hover { color: #e5e5e5; }
  .tab-btn.active { background: #3730a3; color: #fff; border-color: #3730a3; }
  .tab-panel { display: none; }
  .tab-panel.active { display: block; }
  #tab-event, #tab-aufstellung, #tab-activity, #tab-proclubs { max-width: 1100px; margin: 0 auto; padding: 0 1rem 2rem; }
  #pc-search-results, #pc-results { margin-top: 1rem; }
  .pc-club-card { display: flex; align-items: center; gap: 0.75rem; background: #0f0f12; border: 1px solid #26262e; border-radius: 10px; padding: 0.75rem 1rem; margin-bottom: 0.5rem; }
  .pc-club-card img { width: 40px; height: 40px; border-radius: 6px; }
  .pc-club-card button { margin-left: auto; background: #3730a3; color: #fff; border: none; padding: 0.4rem 0.8rem; border-radius: 6px; cursor: pointer; font-size: 0.85rem; }
  #pc-search-btn, #pc-load-btn { background: #3730a3; color: #fff; border: none; padding: 0.55rem 1.1rem; border-radius: 8px; cursor: pointer; font-size: 0.9rem; }
  #pc-search-btn:hover, #pc-load-btn:hover { background: #4338ca; }
  .pc-stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 0.75rem; margin-bottom: 1.25rem; }
  .pc-stat-box { background: #0f0f12; border: 1px solid #26262e; border-radius: 10px; padding: 0.75rem; text-align: center; }
  .pc-stat-box .value { font-size: 1.3rem; font-weight: bold; }
  .pc-stat-box .label { font-size: 0.75rem; color: #9ca3af; margin-top: 0.2rem; }
  #pc-members-table { width: 100%; border-collapse: collapse; background: #17171c; border-radius: 12px; overflow: hidden; }
  #pc-members-table th, #pc-members-table td { padding: 0.6rem 0.9rem; text-align: left; border-bottom: 1px solid #26262e; font-size: 0.85rem; }
  #pc-members-table th { background: #1f1f27; font-size: 0.75rem; text-transform: uppercase; color: #9ca3af; }
  #pc-members-table tr:last-child td { border-bottom: none; }

  .mr-stats-row { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 1rem; }
  .mr-dual { display: flex; gap: 0.4rem; }
  .mr-dual input { width: 70px; background: #0f0f12; color: #e5e5e5; border: 1px solid #2a2a33; border-radius: 8px; padding: 0.4rem; }
  #mr-preview-btn { background: #26262e; color: #e5e5e5; border: none; padding: 0.55rem 1.1rem; border-radius: 8px; cursor: pointer; font-size: 0.9rem; margin-right: 0.5rem; }
  #mr-post-btn { background: #3730a3; color: #fff; border: none; padding: 0.55rem 1.1rem; border-radius: 8px; cursor: pointer; font-size: 0.9rem; }
  #mr-preview-wrap { margin-top: 1.5rem; max-width: 640px; }
  .mr-card { background: #111827; border-radius: 14px; padding: 1.5rem; color: #fff; font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; }
  .mr-card .mr-banner { text-align: center; margin-bottom: 1.25rem; }
  .mr-card .mr-vs { display: flex; align-items: center; justify-content: center; gap: 1.5rem; font-size: 2.2rem; font-weight: 800; margin: 0.5rem 0; }
  .mr-card .mr-team-name { font-size: 1rem; font-weight: 600; flex: 1; text-align: center; }
  .mr-card .mr-score { background: #1f2937; border-radius: 8px; padding: 0.3rem 1rem; }
  .mr-card .mr-stat-line { display: grid; grid-template-columns: 50px 1fr 50px; align-items: center; gap: 0.5rem; font-size: 0.8rem; margin-bottom: 0.5rem; }
  .mr-card .mr-stat-label { text-align: center; color: #9ca3af; font-size: 0.7rem; text-transform: uppercase; }
  .mr-card .mr-bar-wrap { display: flex; height: 6px; border-radius: 3px; overflow: hidden; background: #374151; }
  .mr-card .mr-bar-h { background: #e5e7eb; }
  .mr-card .mr-bar-a { background: #6b7280; }
  .mr-card .mr-players { display: flex; gap: 1rem; margin-top: 1.25rem; }
  .mr-card .mr-players > div { flex: 1; min-width: 0; }
  .mr-card .mr-players h4 { font-size: 0.8rem; margin: 0 0 0.4rem; color: #9ca3af; }
  .mr-card table { width: 100%; font-size: 0.7rem; border-collapse: collapse; }
  .mr-card table td { padding: 0.2rem 0.3rem; border-bottom: 1px solid #1f2937; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mr-card table td.mr-rating { background: #374151; border-radius: 4px; text-align: center; font-weight: 700; }
  .mr-card .mr-bottom { display: flex; gap: 1rem; margin-top: 1.25rem; }
  .mr-card .mr-box { flex: 1; background: #1f2937; border-radius: 10px; padding: 0.75rem; }
  .mr-card .mr-box h4 { margin: 0 0 0.5rem; font-size: 0.75rem; color: #9ca3af; text-transform: uppercase; }
  .mr-card .mr-motm-name { font-size: 1rem; font-weight: 700; }
  .mr-card .mr-goal-row { display: flex; justify-content: space-between; font-size: 0.75rem; padding: 0.15rem 0; }
  .ea-autoload { background: #1a1a22; border: 1px solid #312e81; border-radius: 10px; padding: 0.75rem 1rem; margin-bottom: 0.5rem; }
  #mr-ea-load-btn { background: #3730a3; color: #fff; border: none; padding: 0.55rem 1rem; border-radius: 8px; cursor: pointer; font-size: 0.85rem; }
  #mr-ea-load-btn:hover { background: #4338ca; }
  #mr-ea-status.error { color: #f87171; }
  #mr-ea-status.success { color: #4ade80; }
  .activity-sub { color: #9ca3af; font-size: 0.85rem; margin-bottom: 1rem; }
  #activity-table { width: 100%; border-collapse: collapse; background: #17171c; border-radius: 12px; overflow: hidden; }
  #activity-table th, #activity-table td { padding: 0.65rem 1rem; text-align: left; border-bottom: 1px solid #26262e; font-size: 0.9rem; }
  #activity-table th { background: #1f1f27; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.03em; color: #9ca3af; }
  #activity-table tr:last-child td { border-bottom: none; }
  #activity-table tr:hover { background: #1c1c23; }
  #activity-table tr[data-status="inaktiv"] { opacity: 0.6; }
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
  .side-box { background: #0f0f12; border: 1px solid #26262e; border-radius: 10px; padding: 0.75rem; }
  .declined-box { flex: 0 0 200px; }
  .accepted-box { margin-top: 0.75rem; }
  .side-box h4 { margin: 0 0 0.4rem; font-size: 0.85rem; color: #9ca3af; }
  .accepted-hint, .declined-hint { font-size: 0.75rem; color: #6b7280; margin: 0; }
  #accepted-list, #declined-list { list-style: none; margin: 0; padding: 0; font-size: 0.85rem; }
  #accepted-list li, #declined-list li { padding: 0.2rem 0; border-bottom: 1px solid #1f1f27; }
  #accepted-list li:last-child, #declined-list li:last-child { border-bottom: none; }
  .event-manage { margin-bottom: 1rem; background: #0f0f12; border: 1px solid #26262e; border-radius: 10px; padding: 0.6rem 0.9rem; }
  .event-manage summary { cursor: pointer; font-size: 0.85rem; color: #9ca3af; }
  .event-manage ul { list-style: none; margin: 0.6rem 0 0; padding: 0; }
  .event-manage li { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; padding: 0.4rem 0; border-bottom: 1px solid #1f1f27; font-size: 0.85rem; }
  .event-manage li:last-child { border-bottom: none; }
  .event-manage-empty { color: #6b7280; }
  .delete-event-btn { background: #7f1d1d; color: #fecaca; border: none; padding: 0.3rem 0.6rem; border-radius: 6px; font-size: 0.75rem; cursor: pointer; white-space: nowrap; }
  .delete-event-btn:hover { background: #991b1b; }
  .delete-event-btn:disabled { opacity: 0.5; cursor: not-allowed; }
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

  <nav class="tabs">
    <button class="tab-btn active" data-tab="tab-members">👥 Mitglieder</button>
    <button class="tab-btn" data-tab="tab-activity">📊 Aktivität</button>
    <button class="tab-btn" data-tab="tab-event">📅 Event erstellen</button>
    <button class="tab-btn" data-tab="tab-aufstellung">⚽ Aufstellung erstellen</button>
    <button class="tab-btn" data-tab="tab-proclubs">🎮 Pro Clubs Stats</button>
    <button class="tab-btn" data-tab="tab-matchreport">📈 Spielbericht</button>
  </nav>

  <div class="tab-panel active" id="tab-members">
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
  </div>

  <div class="tab-panel" id="tab-activity">
    <div class="activity-wrap">
      <p class="activity-sub">Letzte Nachricht aus den letzten 100 Nachrichten in bis zu 10 Kanälen ermittelt. "Aktiv" = Nachricht oder Abstimmung in den letzten 14 Tagen.</p>
      <table id="activity-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Letzte Nachricht</th>
            <th>Abstimmungen</th>
            <th>Letzte Abstimmung</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${activityRowsHtml}
        </tbody>
      </table>
    </div>
  </div>

  <div class="tab-panel" id="tab-event">
      <section class="lineup-builder">
        <h2>Event erstellen (/event)</h2>
        <div class="lineup-top-row">
          <label class="top-field">
            <span>Titel *</span>

            <input type="text" id="ev-titel" placeholder="z.B. Ligaspiel Samstag" />
          </label>
          <label class="top-field">
            <span>Mannschaft</span>
            <input type="text" id="ev-mannschaft" value="1 Mannschaft" list="team-suggestions" />
          </label>
        </div>
        <div class="lineup-top-row">
          <label class="top-field">
            <span>Datum * (TT.MM.JJJJ)</span>
            <input type="text" id="ev-datum" placeholder="20.09.2026" />
          </label>
          <label class="top-field">
            <span>Uhrzeit * (HH:MM)</span>
            <input type="text" id="ev-uhrzeit" placeholder="15:00" />
          </label>
          <label class="top-field">
            <span>Limit</span>
            <input type="number" id="ev-limit" value="20" min="1" />
          </label>
        </div>
        <div class="lineup-top-row">
          <label class="top-field">
            <span>Info (z.B. Ort)</span>
            <input type="text" id="ev-info" placeholder="z.B. Sportplatz Nord" />
          </label>
          <label class="top-field">
            <span>Kanal *</span>
            <select id="ev-channel">${channelOptions}</select>
          </label>
        </div>
        <label class="top-field full-width">
          <span>Beschreibung (optional)</span>
          <textarea id="ev-beschreibung" rows="2" placeholder="Weitere Details zum Event"></textarea>
        </label>
        <label class="top-field full-width">
          <span>Bild (optional)</span>
          <input type="file" id="ev-bild" accept="image/*" />
        </label>

        <button id="ev-post-btn">Event in Discord posten</button>
        <p id="ev-post-status"></p>
      </section>
  </div>

  <div class="tab-panel" id="tab-aufstellung">
      <section class="lineup-builder">
        <h2>Aufstellung erstellen (3-5-2)</h2>

        <label class="top-field full-width">
          <span>Von Abstimmung übernehmen (nur Zugesagte anzeigen)</span>
          <select id="event-select">${eventOptions}</select>
        </label>

        <details class="event-manage">
          <summary>Events verwalten / löschen (${votingEvents.length})</summary>
          <ul id="event-manage-list">
            ${eventManageRows || '<li class="event-manage-empty">Keine gespeicherten Events gefunden.</li>'}
          </ul>
        </details>

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
          <div class="side-box declined-box">
            <h4>❌ Abgesagt</h4>
            <p class="declined-hint">Wähle oben ein Event, um die Nein-Stimmen zu sehen.</p>
            <ul id="declined-list"></ul>
          </div>
          <div class="builder-fields">
            ${positionGroupsHtml}
          </div>
          <div class="pitch-preview">
            <div class="pitch">
              ${pitchLinesHtml}
              ${pitchMarkersHtml}
            </div>
            <div class="side-box accepted-box" id="accepted-box">
              <h4>✅ Zugesagt</h4>
              <p class="accepted-hint">Wähle oben ein Event, um die Ja-Stimmen zu sehen.</p>
              <ul id="accepted-list"></ul>
            </div>
          </div>
        </div>

        <button id="post-btn">In Discord posten</button>
        <p id="post-status"></p>
      </section>

  </div>

  <div class="tab-panel" id="tab-proclubs">
    <section class="lineup-builder">
      <h2>EA Pro Clubs Stats</h2>
      <p class="activity-sub">
        Inoffizielle EA-Daten — such deinen Club über den Namen oder trag direkt die Club-ID ein
        (findest du in der URL auf proclubs.ea.com, z.B. ".../overview?clubId=834").
      </p>

      <div class="lineup-top-row">
        <label class="top-field">
          <span>Club-Name suchen</span>
          <input type="text" id="pc-search-name" placeholder="z.B. FC Hababam" />
        </label>
        <label class="top-field">
          <span>Plattform</span>
          <select id="pc-platform">
            <option value="common-gen5">PS5 / Xbox Series / PC</option>
            <option value="common-gen4">PS4 / Xbox One</option>
            <option value="nx">Nintendo Switch</option>
          </select>
        </label>
        <label class="top-field" style="flex: 0 0 auto; align-self: flex-end;">
          <button id="pc-search-btn" type="button">🔍 Suchen</button>
        </label>
      </div>

      <div id="pc-search-results"></div>

      <div class="lineup-top-row" style="margin-top: 1rem;">
        <label class="top-field">
          <span>Oder direkt Club-ID</span>
          <input type="text" id="pc-clubid" placeholder="z.B. 834" />
        </label>
        <label class="top-field" style="flex: 0 0 auto; align-self: flex-end;">
          <button id="pc-load-btn" type="button">Statistiken laden</button>
        </label>
      </div>

      <p id="pc-status"></p>
      <div id="pc-results"></div>
    </section>
  </div>

  <div class="tab-panel" id="tab-matchreport">
    <section class="lineup-builder">
      <h2>Spielbericht erstellen</h2>
      <p class="activity-sub">
        Automatisch von EA laden, oder unten manuell eintragen/korrigieren. Format pro Spielerzeile:
        <code>Position|Name|Tore|Assists|Rating</code>. Torschützen und Vorlagengeber werden automatisch ermittelt.
      </p>

      <div class="lineup-top-row ea-autoload">
        <label class="top-field">
          <span>EA Club-ID</span>
          <input type="text" id="mr-ea-clubid" placeholder="z.B. 834" />
        </label>
        <label class="top-field" style="flex: 0 0 auto; align-self: flex-end;">
          <button id="mr-ea-load-btn" type="button">⬇️ Letztes Spiel laden</button>
        </label>
      </div>
      <p id="mr-ea-status" class="activity-sub"></p>

      <div class="lineup-top-row">
        <label class="top-field">
          <span>Heimteam</span>
          <input type="text" id="mr-home-name" value="Calcio Strada" />
        </label>
        <label class="top-field">
          <span>Gegner</span>
          <input type="text" id="mr-away-name" placeholder="z.B. Wolf Assassins" />
        </label>
        <label class="top-field">
          <span>Kanal</span>
          <select id="mr-channel">${channelOptions}</select>
        </label>
      </div>

      <div class="lineup-top-row">
        <label class="top-field">
          <span>Tore Heim</span>
          <input type="number" id="mr-home-goals" value="0" min="0" />
        </label>
        <label class="top-field">
          <span>Tore Gegner</span>
          <input type="number" id="mr-away-goals" value="0" min="0" />
        </label>
      </div>

      <div class="mr-stats-row">
        <label class="top-field"><span>Schüsse (Heim/Gegner)</span><div class="mr-dual"><input type="number" id="mr-shots-h" value="0" /><input type="number" id="mr-shots-a" value="0" /></div></label>
        <label class="top-field"><span>Pässe (Heim/Gegner)</span><div class="mr-dual"><input type="number" id="mr-passes-h" value="0" /><input type="number" id="mr-passes-a" value="0" /></div></label>
        <label class="top-field"><span>Passquote % (Heim/Gegner)</span><div class="mr-dual"><input type="number" id="mr-passacc-h" value="0" /><input type="number" id="mr-passacc-a" value="0" /></div></label>
        <label class="top-field"><span>Zweikämpfe (Heim/Gegner)</span><div class="mr-dual"><input type="number" id="mr-duels-h" value="0" /><input type="number" id="mr-duels-a" value="0" /></div></label>
        <label class="top-field"><span>Paraden (Heim/Gegner)</span><div class="mr-dual"><input type="number" id="mr-saves-h" value="0" /><input type="number" id="mr-saves-a" value="0" /></div></label>
      </div>

      <div class="lineup-top-row">
        <label class="top-field full-width">
          <span>Spieler Heim</span>
          <textarea id="mr-players-home" rows="5" placeholder="TW|Max Mustermann|0|0|6.5&#10;ST|Musti|2|1|8.3"></textarea>
        </label>
      </div>
      <div class="lineup-top-row">
        <label class="top-field full-width">
          <span>Spieler Gegner</span>
          <textarea id="mr-players-away" rows="5" placeholder="TW|Gegner Name|0|0|5.0"></textarea>
        </label>
      </div>

      <button id="mr-preview-btn" type="button">Vorschau aktualisieren</button>
      <button id="mr-post-btn" type="button">In Discord posten</button>
      <p id="mr-status"></p>

      <div id="mr-preview-wrap">
        <div id="mr-card" class="mr-card"></div>
      </div>
    </section>
  </div>

  <script>
    (function () {
      const tabButtons = document.querySelectorAll('.tab-btn');
      const tabPanels = document.querySelectorAll('.tab-panel');
      tabButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
          tabButtons.forEach((b) => b.classList.remove('active'));
          tabPanels.forEach((p) => p.classList.remove('active'));
          btn.classList.add('active');
          document.getElementById(btn.dataset.tab).classList.add('active');
        });
      });
    })();
  </script>
  <script>
    (function () {
      const searchBtn = document.getElementById('pc-search-btn');
      const searchInput = document.getElementById('pc-search-name');
      const searchResults = document.getElementById('pc-search-results');
      const platformSelect = document.getElementById('pc-platform');
      const clubIdInput = document.getElementById('pc-clubid');
      const loadBtn = document.getElementById('pc-load-btn');
      const statusEl = document.getElementById('pc-status');
      const resultsEl = document.getElementById('pc-results');

      function escapeHtmlClient(s) {
        const div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
      }

      // Hier die eigene Cloudflare-Worker-URL eintragen, sobald deployed (z.B. "https://proclubs-proxy.deinname.workers.dev")
      window.CLOUDFLARE_WORKER_URL = '';

      window.fetchEaDirectOrProxy = async function fetchEaDirectOrProxy(path, query) {
        const CLOUDFLARE_WORKER_URL = window.CLOUDFLARE_WORKER_URL;
        // Versuch 1: Cloudflare Worker (andere IP-Range als Netlify — EA blockt evtl. nur AWS/Netlify)
        if (CLOUDFLARE_WORKER_URL) {
          try {
            const cfRes = await fetch(CLOUDFLARE_WORKER_URL + '?' + query);
            const cfData = await cfRes.json();
            if (cfRes.ok) return { ok: true, data: cfData, via: 'cloudflare' };
          } catch (e) {
            // weiter zu Versuch 2
          }
        }
        // Versuch 2: über unseren Netlify-Server-Proxy
        const proxyRes = await fetch('/.netlify/functions/proclubs-stats?' + query);
        const data = await proxyRes.json();
        return { ok: proxyRes.ok, data, via: 'netlify-proxy' };
      }

      searchBtn.addEventListener('click', async () => {
        const name = searchInput.value.trim();
        if (!name) return;
        searchResults.innerHTML = 'Suche …';
        try {
          const result = await fetchEaDirectOrProxy('/allTimeLeaderboard/search', 'type=search&platform=' + platformSelect.value + '&clubName=' + encodeURIComponent(name));
          const res = { ok: result.ok };
          const data = result.data;
          if (!res.ok) {
            searchResults.innerHTML = '<p style="color:#f87171;">Fehler (' + result.via + '): ' + escapeHtmlClient(data.error || JSON.stringify(data).slice(0, 150)) + '</p>';
            return;
          }
          const clubs = Array.isArray(data) ? data : data.clubs || [];
          if (clubs.length === 0) {
            searchResults.innerHTML = '<p>Keine Clubs gefunden.</p>';
            return;
          }
          searchResults.innerHTML = clubs
            .slice(0, 8)
            .map((c) => {
              const cid = c.clubId || c.clubInfo?.clubId || '';
              const cname = c.name || c.clubInfo?.name || 'Unbenannt';
              return (
                '<div class="pc-club-card"><span>' +
                escapeHtmlClient(cname) +
                ' <small style="color:#6b7280;">(ID: ' +
                escapeHtmlClient(String(cid)) +
                ')</small></span><button data-clubid="' +
                escapeHtmlClient(String(cid)) +
                '">Laden</button></div>'
              );
            })
            .join('');
          searchResults.querySelectorAll('button[data-clubid]').forEach((btn) => {
            btn.addEventListener('click', () => {
              clubIdInput.value = btn.dataset.clubid;
              loadBtn.click();
            });
          });
        } catch (e) {
          searchResults.innerHTML = '<p style="color:#f87171;">Fehler: ' + escapeHtmlClient(e.message) + '</p>';
        }
      });

      loadBtn.addEventListener('click', async () => {
        const clubId = clubIdInput.value.trim();
        if (!clubId) {
          statusEl.textContent = '❌ Bitte eine Club-ID angeben.';
          return;
        }
        const platform = platformSelect.value;
        statusEl.textContent = 'Lade Statistiken …';
        resultsEl.innerHTML = '';

        try {
          const [infoResult, overallResult, membersResult] = await Promise.all([
            fetchEaDirectOrProxy('/clubs/info', 'type=info&clubId=' + clubId + '&platform=' + platform),
            fetchEaDirectOrProxy('/clubs/overallStats', 'type=overallStats&clubId=' + clubId + '&platform=' + platform),
            fetchEaDirectOrProxy('/members/stats', 'type=members&clubId=' + clubId + '&platform=' + platform),
          ]);

          const infoData = infoResult.data;
          const overallData = overallResult.data;
          const membersData = membersResult.data;

          if (!infoResult.ok || !overallResult.ok || !membersResult.ok) {
            const err = infoData.error || overallData.error || membersData.error || 'Unbekannter Fehler';
            statusEl.textContent = '❌ (' + (infoResult.via || overallResult.via || membersResult.via) + ') ' + err;
            return;
          }

          statusEl.textContent = '';

          const club = infoData[clubId] || Object.values(infoData)[0] || {};
          const overall = overallData[0] || overallData[clubId] || {};
          const members = Array.isArray(membersData) ? membersData : membersData.members || [];

          const clubName = club.name || club.clubName || 'Unbekannter Club';
          const crestUrl = club.clubInfo?.customKit?.crestAssetId
            ? null
            : null; // EA liefert keine direkte Bild-URL, nur eine Asset-ID — kein Crest-Bild anzeigbar

          let html = '<h3 style="margin-bottom:0.75rem;">' + escapeHtmlClient(clubName) + '</h3>';

          html += '<div class="pc-stat-grid">';
          const statDefs = [
            ['Siege', overall.wins],
            ['Niederlagen', overall.losses],
            ['Unentschieden', overall.ties],
            ['Tore', overall.goals],
            ['Gegentore', overall.goalsAgainst],
            ['Spiele', overall.gamesPlayed],
          ];
          statDefs.forEach(([label, value]) => {
            html +=
              '<div class="pc-stat-box"><div class="value">' +
              escapeHtmlClient(value !== undefined ? String(value) : '—') +
              '</div><div class="label">' +
              escapeHtmlClient(label) +
              '</div></div>';
          });
          html += '</div>';

          if (members.length > 0) {
            html +=
              '<table id="pc-members-table"><thead><tr><th>Name</th><th>Position</th><th>Spiele</th><th>Tore</th><th>Assists</th><th>Rating</th></tr></thead><tbody>';
            members.forEach((m) => {
              html +=
                '<tr><td>' +
                escapeHtmlClient(m.name || '—') +
                '</td><td>' +
                escapeHtmlClient(m.proPos || m.favoritePosition || '—') +
                '</td><td>' +
                escapeHtmlClient(String(m.gamesPlayed ?? '—')) +
                '</td><td>' +
                escapeHtmlClient(String(m.goals ?? '—')) +
                '</td><td>' +
                escapeHtmlClient(String(m.assists ?? '—')) +
                '</td><td>' +
                escapeHtmlClient(String(m.ratingAve ?? '—')) +
                '</td></tr>';
            });
            html += '</tbody></table>';
          } else {
            html += '<p>Keine Spielerdaten gefunden.</p>';
          }

          resultsEl.innerHTML = html;
        } catch (e) {
          statusEl.textContent = '❌ Fehler: ' + (e && e.message ? e.message : String(e));
        }
      });
    })();
  </script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
  <script>
    (function () {
      function escHtml(s) {
        const div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
      }

      function parsePlayers(text) {
        return text
          .split('\\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const parts = line.split('|').map((p) => p.trim());
            return {
              pos: parts[0] || '',
              name: parts[1] || '',
              goals: Number(parts[2]) || 0,
              assists: Number(parts[3]) || 0,
              rating: parts[4] || '—',
            };
          });
      }

      function playerRowsHtml(players) {
        return players
          .map(
            (p) =>
              '<tr><td>' + escHtml(p.pos) + '</td><td>' + escHtml(p.name) + '</td><td>' + p.goals + '</td><td>' + p.assists + '</td><td class="mr-rating">' + escHtml(p.rating) + '</td></tr>'
          )
          .join('');
      }

      function buildCard() {
        const homeName = document.getElementById('mr-home-name').value.trim() || 'Heim';
        const awayName = document.getElementById('mr-away-name').value.trim() || 'Gegner';
        const homeGoals = document.getElementById('mr-home-goals').value || '0';
        const awayGoals = document.getElementById('mr-away-goals').value || '0';

        const statRows = [
          ['Schüsse', 'mr-shots-h', 'mr-shots-a'],
          ['Pässe', 'mr-passes-h', 'mr-passes-a'],
          ['Passquote %', 'mr-passacc-h', 'mr-passacc-a'],
          ['Zweikämpfe', 'mr-duels-h', 'mr-duels-a'],
          ['Paraden', 'mr-saves-h', 'mr-saves-a'],
        ];

        let statsHtml = '';
        statRows.forEach(([label, hId, aId]) => {
          const hVal = Number(document.getElementById(hId).value) || 0;
          const aVal = Number(document.getElementById(aId).value) || 0;
          const total = hVal + aVal || 1;
          const hPct = (hVal / total) * 100;
          statsHtml +=
            '<div class="mr-stat-line"><div style="text-align:right;">' +
            hVal +
            '</div><div><div class="mr-stat-label">' +
            escHtml(label) +
            '</div><div class="mr-bar-wrap"><div class="mr-bar-h" style="width:' +
            hPct +
            '%"></div><div class="mr-bar-a" style="width:' +
            (100 - hPct) +
            '%"></div></div></div><div>' +
            aVal +
            '</div></div>';
        });

        const homePlayers = parsePlayers(document.getElementById('mr-players-home').value);
        const awayPlayers = parsePlayers(document.getElementById('mr-players-away').value);
        const allPlayers = homePlayers.concat(awayPlayers);

        const scorers = allPlayers
          .filter((p) => p.goals > 0)
          .sort((a, b) => b.goals - a.goals)
          .slice(0, 6);
        const assisters = allPlayers
          .filter((p) => p.assists > 0)
          .sort((a, b) => b.assists - a.assists)
          .slice(0, 6);

        let motm = null;
        allPlayers.forEach((p) => {
          const r = parseFloat(p.rating);
          if (!isNaN(r) && (!motm || r > motm.ratingNum)) motm = Object.assign({}, p, { ratingNum: r });
        });

        const html =
          '<div class="mr-banner"><div class="mr-vs">' +
          '<div class="mr-team-name">' +
          escHtml(homeName) +
          '</div><div class="mr-score">' +
          escHtml(String(homeGoals)) +
          ' : ' +
          escHtml(String(awayGoals)) +
          '</div><div class="mr-team-name">' +
          escHtml(awayName) +
          '</div></div></div>' +
          statsHtml +
          '<div class="mr-players">' +
          '<div><h4>' +
          escHtml(homeName) +
          '</h4><table>' +
          playerRowsHtml(homePlayers) +
          '</table></div>' +
          '<div><h4>' +
          escHtml(awayName) +
          '</h4><table>' +
          playerRowsHtml(awayPlayers) +
          '</table></div>' +
          '</div>' +
          '<div class="mr-bottom">' +
          '<div class="mr-box"><h4>Man of the Match</h4>' +
          (motm
            ? '<div class="mr-motm-name">' + escHtml(motm.name) + '</div><div style="color:#9ca3af;font-size:0.8rem;">' + motm.goals + ' Tore · Rating ' + escHtml(motm.rating) + '</div>'
            : '<div style="color:#9ca3af;">—</div>') +
          '</div>' +
          '<div class="mr-box"><h4>Torbeteiligungen</h4>' +
          (scorers.length === 0 && assisters.length === 0
            ? '<div style="color:#9ca3af;">—</div>'
            : scorers.map((p) => '<div class="mr-goal-row"><span>⚽ ' + escHtml(p.name) + '</span><span>' + p.goals + '</span></div>').join('') +
              assisters.map((p) => '<div class="mr-goal-row"><span>🎯 ' + escHtml(p.name) + '</span><span>' + p.assists + '</span></div>').join('')) +
          '</div>' +
          '</div>';

        document.getElementById('mr-card').innerHTML = html;
      }

      function fmtPlayersBlock(playerList) {
        return playerList
          .map((p) => [p.pos || '', p.name || 'Unbekannt', p.goals || 0, p.assists || 0, p.rating || '—'].join('|'))
          .join('\\n');
      }

      document.getElementById('mr-ea-load-btn').addEventListener('click', async () => {
        const statusEl = document.getElementById('mr-ea-status');
        const clubId = document.getElementById('mr-ea-clubid').value.trim();
        if (!clubId) {
          statusEl.textContent = '❌ Bitte eine Club-ID angeben.';
          statusEl.className = 'activity-sub error';
          return;
        }

        statusEl.textContent = 'Lade letztes Spiel …';
        statusEl.className = 'activity-sub';

        try {
          const res = await fetch('/.netlify/functions/proclubs-br?clubId=' + encodeURIComponent(clubId));
          const data = await res.json();
          if (!res.ok) {
            statusEl.textContent = '❌ Fehler: ' + (data.error || 'Unbekannt');
            statusEl.className = 'activity-sub error';
            return;
          }

          const match = Array.isArray(data) ? data[0] : null;
          if (!match || !match.teams) {
            statusEl.textContent = '❌ Keine Spieldaten gefunden.';
            statusEl.className = 'activity-sub error';
            return;
          }

          const teamIds = Object.keys(match.teams);
          const homeId = teamIds.includes(String(clubId)) ? String(clubId) : teamIds[0];
          const awayId = teamIds.find((id) => id !== homeId) || teamIds[1] || teamIds[0];

          const homeTeam = match.teams[homeId] || {};
          const awayTeam = match.teams[awayId] || {};

          function sumPlayerStat(playersObj, key) {
            let total = 0;
            Object.values(playersObj || {}).forEach((p) => { total += Number(p[key]) || 0; });
            return total;
          }

          function extractPlayers(playersObj) {
            return Object.values(playersObj || {}).map((p) => ({
              pos: p.pos || '',
              name: p.playername || 'Unbekannt',
              goals: Number(p.goals) || 0,
              assists: Number(p.assists) || 0,
              rating: p.rating || '—',
            }));
          }

          const homePlayersObj = (match.players && match.players[homeId]) || {};
          const awayPlayersObj = (match.players && match.players[awayId]) || {};

          document.getElementById('mr-home-name').value = homeTeam.name || 'Heim';
          document.getElementById('mr-away-name').value = awayTeam.name || 'Gegner';
          document.getElementById('mr-home-goals').value = homeTeam.goals || '0';
          document.getElementById('mr-away-goals').value = awayTeam.goals || '0';

          document.getElementById('mr-shots-h').value = sumPlayerStat(homePlayersObj, 'shots');
          document.getElementById('mr-shots-a').value = sumPlayerStat(awayPlayersObj, 'shots');
          document.getElementById('mr-passes-h').value = sumPlayerStat(homePlayersObj, 'passesmade');
          document.getElementById('mr-passes-a').value = sumPlayerStat(awayPlayersObj, 'passesmade');
          document.getElementById('mr-duels-h').value = sumPlayerStat(homePlayersObj, 'tacklesmade');
          document.getElementById('mr-duels-a').value = sumPlayerStat(awayPlayersObj, 'tacklesmade');
          document.getElementById('mr-saves-h').value = sumPlayerStat(homePlayersObj, 'saves');
          document.getElementById('mr-saves-a').value = sumPlayerStat(awayPlayersObj, 'saves');

          const homeAttempts = sumPlayerStat(homePlayersObj, 'passattempts');
          const awayAttempts = sumPlayerStat(awayPlayersObj, 'passattempts');
          const homeMade = sumPlayerStat(homePlayersObj, 'passesmade');
          const awayMade = sumPlayerStat(awayPlayersObj, 'passesmade');
          document.getElementById('mr-passacc-h').value = homeAttempts > 0 ? Math.round((homeMade / homeAttempts) * 100) : 0;
          document.getElementById('mr-passacc-a').value = awayAttempts > 0 ? Math.round((awayMade / awayAttempts) * 100) : 0;

          document.getElementById('mr-players-home').value = fmtPlayersBlock(extractPlayers(homePlayersObj));
          document.getElementById('mr-players-away').value = fmtPlayersBlock(extractPlayers(awayPlayersObj));

          buildCard();

          statusEl.textContent = '✅ Geladen — bitte kurz prüfen, EA-Felder sind nicht offiziell dokumentiert und können abweichen.';
          statusEl.className = 'activity-sub success';
        } catch (e) {
          statusEl.textContent = '❌ Fehler: ' + (e && e.message ? e.message : String(e));
          statusEl.className = 'activity-sub error';
        }
      });

      document.getElementById('mr-preview-btn').addEventListener('click', buildCard);
      buildCard();

      document.getElementById('mr-post-btn').addEventListener('click', async () => {
        const statusEl = document.getElementById('mr-status');
        const channelId = document.getElementById('mr-channel').value;
        if (!channelId) {
          statusEl.textContent = '❌ Bitte einen Kanal auswählen.';
          return;
        }

        buildCard();
        statusEl.textContent = 'Erstelle Bild …';

        try {
          const canvas = await html2canvas(document.getElementById('mr-card'), { backgroundColor: '#111827', scale: 2 });
          const image = canvas.toDataURL('image/png');

          statusEl.textContent = 'Wird gepostet …';

          const homeName = document.getElementById('mr-home-name').value.trim() || 'Heim';
          const awayName = document.getElementById('mr-away-name').value.trim() || 'Gegner';
          const homeGoals = document.getElementById('mr-home-goals').value || '0';
          const awayGoals = document.getElementById('mr-away-goals').value || '0';

          const res = await fetch('/.netlify/functions/post-matchreport', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              channelId,
              image,
              caption: homeName + ' ' + homeGoals + ':' + awayGoals + ' ' + awayName,
            }),
          });
          const data = await res.json();
          if (res.ok) {
            statusEl.textContent = '✅ Spielbericht wurde gepostet!';
          } else {
            statusEl.textContent = '❌ Fehler: ' + (data.error || 'Unbekannt');
          }
        } catch (e) {
          statusEl.textContent = '❌ Fehler: ' + (e && e.message ? e.message : String(e));
        }
      });
    })();
  </script>
  <script>
    (function () {
      const btn = document.getElementById('ev-post-btn');
      const statusEl = document.getElementById('ev-post-status');

      function readImageAsDataUrl(fileInput) {
        return new Promise((resolve) => {
          const file = fileInput.files?.[0];
          if (!file) return resolve(null);
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(file);
        });
      }

      btn.addEventListener('click', async () => {
        const titel = document.getElementById('ev-titel').value.trim();
        const datum = document.getElementById('ev-datum').value.trim();
        const uhrzeit = document.getElementById('ev-uhrzeit').value.trim();
        const limit = document.getElementById('ev-limit').value;
        const info = document.getElementById('ev-info').value.trim();
        const beschreibung = document.getElementById('ev-beschreibung').value.trim();
        const mannschaft = document.getElementById('ev-mannschaft').value.trim();
        const channelId = document.getElementById('ev-channel').value;

        if (!titel || !datum || !uhrzeit || !channelId) {
          statusEl.textContent = '❌ Bitte Titel, Datum, Uhrzeit und Kanal ausfüllen.';
          statusEl.className = 'error';
          return;
        }

        btn.disabled = true;
        statusEl.textContent = 'Wird gepostet …';
        statusEl.className = '';

        try {
          const image = await readImageAsDataUrl(document.getElementById('ev-bild'));

          const res = await fetch('/.netlify/functions/post-event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ titel, datum, uhrzeit, limit, info, beschreibung, mannschaft, channelId, image }),
          });
          const data = await res.json();
          if (res.ok) {
            statusEl.textContent = '✅ Event wurde gepostet!';
            statusEl.className = 'success';
          } else {
            statusEl.textContent = '❌ Fehler: ' + (data.error || 'Unbekannt');
            statusEl.className = 'error';
          }
        } catch (e) {
          statusEl.textContent = '❌ Fehler: ' + (e && e.message ? e.message : String(e));
          statusEl.className = 'error';
        } finally {
          btn.disabled = false;
        }
      });
    })();
  </script>
  <script>
    window.__EVENT_ACCEPTED__ = ${eventAcceptedJson};
    window.__EVENT_DECLINED__ = ${eventDeclinedJson};
  </script>
  <script>
    (function () {
      document.querySelectorAll('.delete-event-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const eventId = btn.dataset.eventId;
          if (!confirm('Dieses Event wirklich löschen? Die Buttons in Discord funktionieren danach nicht mehr.')) return;

          btn.disabled = true;
          btn.textContent = '…';

          try {
            const res = await fetch('/.netlify/functions/delete-event', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ eventId }),
            });
            const data = await res.json();
            if (res.ok) {
              const li = btn.closest('li');
              if (li) li.remove();
              const option = document.querySelector('#event-select option[value="' + CSS.escape(eventId) + '"]');
              if (option) option.remove();
            } else {
              alert('Fehler beim Löschen: ' + (data.error || 'Unbekannt'));
              btn.disabled = false;
              btn.textContent = '🗑️ Löschen';
            }
          } catch (e) {
            alert('Fehler beim Löschen: ' + (e && e.message ? e.message : String(e)));
            btn.disabled = false;
            btn.textContent = '🗑️ Löschen';
          }
        });
      });
    })();
  </script>
  <script>
    (function () {
      const postBtn = document.getElementById('post-btn');
      const statusEl = document.getElementById('post-status');
      const showAllToggle = document.getElementById('show-all-toggle');
      const eventSelect = document.getElementById('event-select');
      const acceptedList = document.getElementById('accepted-list');
      const acceptedHint = document.querySelector('.accepted-hint');
      const declinedList = document.getElementById('declined-list');
      const declinedHint = document.querySelector('.declined-hint');

      // Original-Optionen jedes Positions-Dropdowns merken, um sie wiederherstellen zu können
      const originalOptionsHtml = new Map();
      document.querySelectorAll('select[data-pos]').forEach((sel) => {
        originalOptionsHtml.set(sel.dataset.pos, sel.innerHTML);
      });

      function setSelectOptions(sel, players) {
        const current = sel.value;
        let html = '<option value="">—</option>';
        players.forEach((p) => {
          const opt = document.createElement('option');
          opt.value = p.name;
          opt.textContent = p.role ? p.name + ' (' + p.role + ')' : p.name;
          html += opt.outerHTML;
        });
        sel.innerHTML = html;
        sel.classList.remove('filtered'); // Andere-Spieler-Ausblendung ist hier irrelevant, da eh schon gefiltert
        if (players.some((p) => p.name === current)) sel.value = current;
      }

      function applyEventFilter() {
        const eventId = eventSelect.value;
        const accepted = eventId ? window.__EVENT_ACCEPTED__[eventId] || [] : null;
        const declined = eventId ? window.__EVENT_DECLINED__[eventId] || [] : null;

        document.querySelectorAll('select[data-pos]').forEach((sel) => {
          if (accepted) {
            setSelectOptions(sel, accepted);
          } else {
            sel.innerHTML = originalOptionsHtml.get(sel.dataset.pos);
            sel.classList.toggle('filtered', !showAllToggle.checked);
          }
        });

        if (accepted) {
          acceptedHint.style.display = 'none';
          acceptedList.innerHTML = '';
          accepted.forEach((p) => {
            const li = document.createElement('li');
            li.textContent = p.role ? p.name + ' (' + p.role + ')' : p.name;
            acceptedList.appendChild(li);
          });
        } else {
          acceptedHint.style.display = 'block';
          acceptedList.innerHTML = '';
        }

        if (declined) {
          declinedHint.style.display = 'none';
          declinedList.innerHTML = '';
          declined.forEach((p) => {
            const li = document.createElement('li');
            li.textContent = p.role ? p.name + ' (' + p.role + ')' : p.name;
            declinedList.appendChild(li);
          });
        } else {
          declinedHint.style.display = 'block';
          declinedList.innerHTML = '';
        }
      }

      eventSelect.addEventListener('change', applyEventFilter);

      showAllToggle.addEventListener('change', () => {
        if (eventSelect.value) return; // bei aktivem Event-Filter irrelevant
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
          statusEl.textContent = '❌ Fehler: ' + (e && e.message ? e.message : String(e));
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
