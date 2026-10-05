// Kader-Verwaltung (/kader): Wer die Rolle "1 Mannschaft" bzw. "2 Mannschaft" hat, steht im Kader.
// Position kommt aus dem HP-Tag im Nickname, Rückennummern vergeben Admins per Button.
// Bewusst ohne sharp, damit Button-Antworten schnell bleiben. Das Bild baut kader-worker.js.

const { blobStore } = require('./clubs');

const KADER_TEAMS = {
  '1': { label: 'Calcio Strada 1', roleName: '1 Mannschaft', color: 0x1fbf63 },
  '2': { label: 'Calcio Strada 2', roleName: '2 Mannschaft', color: 0xe8434f },
};

// Wer den Kader bearbeiten darf: Discord-Rechte "Administrator", "Server verwalten" oder "Rollen verwalten"
// ODER eine Rolle mit einem dieser Namen (Groß-/Kleinschreibung egal) -> hier bei Bedarf anpassen
const ADMIN_ROLE_NAMES = ['admin', 'owner', 'kapitän', 'kapitan', 'captain', 'vorstand', 'moderator'];
const PERM_ADMIN = 1n << 3n;
const PERM_MANAGE_GUILD = 1n << 5n;
const PERM_MANAGE_ROLES = 1n << 28n;

// HP-Code -> Spalte im Kader
const POS_GROUP = {
  TW: 'TW', TH: 'TW',
  IV: 'ABW', LIV: 'ABW', ZIV: 'ABW', RIV: 'ABW', LV: 'ABW', RV: 'ABW', AV: 'ABW', LAV: 'ABW', RAV: 'ABW', ABW: 'ABW',
  ZDM: 'MF', DM: 'MF', ZM: 'MF', ZOM: 'MF', OM: 'MF', LM: 'MF', RM: 'MF', MF: 'MF',
  ST: 'OFF', LS: 'OFF', RS: 'OFF', MS: 'OFF', LF: 'OFF', RF: 'OFF', LA: 'OFF', RA: 'OFF', LW: 'OFF', RW: 'OFF', OFF: 'OFF',
};
const GROUP_TITLES = { TW: '🧤 TORWART', ABW: '🛡️ ABWEHR', MF: '🎯 MITTELFELD', OFF: '⚽ OFFENSIVE' };

const WORKER_URL = `${process.env.URL || 'https://zusagen.netlify.app'}/.netlify/functions/kader-worker`;

function kaderStore() {
  return blobStore('kader');
}

function api(path, opts = {}) {
  return fetch(`https://discord.com/api/v10${path}`, {
    ...opts,
    headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}`, ...(opts.headers || {}) },
  });
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9äöüß]/g, '');

async function getGuildRoles(guildId) {
  const res = await api(`/guilds/${guildId}/roles`);
  if (!res.ok) throw new Error(`Rollen konnten nicht geladen werden (${res.status})`);
  return res.json();
}

// "1 Mannschaft", "1. Mannschaft", "1-mannschaft" … werden gleich behandelt
function findKaderRole(roles, team) {
  const wanted = norm(KADER_TEAMS[team].roleName);
  return roles.find((r) => norm(r.name) === wanted) || null;
}

async function isKaderAdmin(interaction) {
  const perms = BigInt(interaction.member?.permissions || '0');
  if (perms & (PERM_ADMIN | PERM_MANAGE_GUILD | PERM_MANAGE_ROLES)) return true;
  const memberRoles = interaction.member?.roles || [];
  if (memberRoles.length === 0) return false;
  try {
    const roles = await getGuildRoles(interaction.guild_id);
    return roles.some((r) => memberRoles.includes(r.id) && ADMIN_ROLE_NAMES.includes(norm(r.name)));
  } catch {
    return false;
  }
}

// Nickname -> Anzeigename ohne Positions-Tags + HP-Code
function parseNick(raw) {
  const nick = String(raw || '').trim();
  const hp = (nick.match(/HP:\s*([A-ZÄÖÜ]+)/i) || [])[1]?.toUpperCase() || null;
  const np = (nick.match(/NP:\s*([A-ZÄÖÜ]+)/i) || [])[1]?.toUpperCase() || null;
  let name = nick.split('|')[0];
  const tag = name.search(/\b(HP|NP)\s*:/i);
  if (tag >= 0) name = name.slice(0, tag);
  name = name.replace(/[\s/\-–—,]+$/, '').trim() || nick;
  return { name, hp, np };
}

async function getNumbers(team) {
  return (await kaderStore().get(`numbers-${team}`, { type: 'json' })) || {};
}

async function setNumbers(team, numbers) {
  await kaderStore().setJSON(`numbers-${team}`, numbers);
}

// Alle Kader-Spieler eines Teams mit Name, Position, Spalte und Nummer
async function getKaderPlayers(guildId, team) {
  const roles = await getGuildRoles(guildId);
  const role = findKaderRole(roles, team);
  if (!role) return { role: null, players: [] };

  const res = await api(`/guilds/${guildId}/members?limit=1000`);
  if (!res.ok) throw new Error(`Mitglieder konnten nicht geladen werden (${res.status})`);
  const members = await res.json();
  const numbers = await getNumbers(team);

  const players = members
    .filter((m) => (m.roles || []).includes(role.id) && !m.user?.bot)
    .map((m) => {
      const { name, hp, np } = parseNick(m.nick || m.user?.global_name || m.user?.username);
      const pos = hp || np || null;
      return {
        id: m.user.id,
        name,
        pos,
        group: POS_GROUP[pos] || 'MF', // ohne Positions-Tag -> Mittelfeld
        number: numbers[m.user.id] ?? null,
      };
    })
    .sort((a, b) => (a.number ?? 999) - (b.number ?? 999) || a.name.localeCompare(b.name));

  return { role, players };
}

function buildKaderEmbed(team, players, roleName, imageName) {
  const t = KADER_TEAMS[team];
  // Nur das Bild zeigen – keine Textliste. Die Positionen stehen im Bild selbst.
  return {
    title: `${t.label.toUpperCase()} | KADER`,
    color: t.color,
    image: imageName ? { url: `attachment://${imageName}` } : undefined,
    footer: { text: 'Wir sind eine große Familie 🇮🇹' },
  };
}

function kaderComponents(team) {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 3, label: 'Spieler hinzufügen', emoji: { name: '➕' }, custom_id: `kader:add:${team}` },
        { type: 2, style: 4, label: 'Spieler entfernen', emoji: { name: '➖' }, custom_id: `kader:rem:${team}` },
        { type: 2, style: 2, label: 'Nummer vergeben', emoji: { name: '🔢' }, custom_id: `kader:num:${team}` },
        { type: 2, style: 2, label: 'Aktualisieren', emoji: { name: '🔄' }, custom_id: `kader:refresh:${team}` },
      ],
    },
  ];
}

// Bild-Aktualisierung anstoßen: Merker setzen (Absicherung über session-check alle 2 Min.)
// und kader-worker direkt anstoßen (läuft weiter, auch wenn wir nicht auf das Ende warten).
async function requestKaderRefresh(payload) {
  const store = kaderStore();
  if (payload.action === 'post') {
    await store.setJSON(`pending-${payload.team}`, { ...payload, createdAt: Date.now() });
  } else {
    await store.set(`dirty-${payload.team}`, String(Date.now()));
  }
  try {
    await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-worker-secret': process.env.CRON_SECRET || '' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(1200),
    });
  } catch {
    // Timeout ist gewollt: der Worker rendert im Hintergrund weiter
  }
}

module.exports = {
  KADER_TEAMS,
  kaderStore,
  api,
  getGuildRoles,
  findKaderRole,
  isKaderAdmin,
  getNumbers,
  setNumbers,
  getKaderPlayers,
  buildKaderEmbed,
  kaderComponents,
  requestKaderRefresh,
};
