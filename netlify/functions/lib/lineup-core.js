// Aufstellungs-Verwaltung (/aufstellung): Formation wählen, Positionen per Klick besetzen,
// Aushilfen eintippen. Nur Admins. Ergebnis als Bild (das baut lineup-worker über lineup-render).
// Bewusst ohne sharp, damit die Button-Antworten schnell bleiben.

const { blobStore } = require('./clubs');
const { FORMATIONS } = require('./matchreport-svg');
const { KADER_TEAMS, api, getGuildRoles, isKaderAdmin, getKaderPlayers } = require('./kader-core');

const FORMATION_NAMES = Object.keys(FORMATIONS); // ['4-3-3','4-4-2','3-5-2','4-2-3-1','3-4-3','5-3-2']
const DEFAULT_FORMATION = '3-5-2';
const WORKER_URL = `${process.env.URL || 'https://zusagen.netlify.app'}/.netlify/functions/lineup-worker`;

function lineupStore() {
  return blobStore('lineups');
}

// Eindeutiger Schlüssel pro laufender Aufstellung (eine pro Ersteller, damit mehrere parallel gehen)
function lineupKey(interaction) {
  return `lu-${interaction.guild_id}-${interaction.member.user.id}`;
}

function emptyLineup(team, title, userId) {
  return { team: String(team), title: title || 'Aufstellung', formation: DEFAULT_FORMATION, players: {}, startedBy: userId };
}

async function getLineup(store, key) {
  return store.get(key, { type: 'json' });
}

async function saveLineup(store, key, lineup) {
  await store.setJSON(key, lineup);
}

// Beim Formationswechsel: Namen behalten, deren Slot-Key es in der neuen Formation auch gibt
function switchFormation(lineup, formation) {
  if (!FORMATIONS[formation]) return lineup;
  const validKeys = new Set(FORMATIONS[formation].map((s) => s.key));
  const kept = {};
  for (const [k, v] of Object.entries(lineup.players)) if (validKeys.has(k)) kept[k] = v;
  return { ...lineup, formation, players: kept };
}

// HP-Tag im Nickname -> grobe Positionsgruppe, damit Auto-Fill die Leute sinnvoll verteilt
const HP_TO_GROUP = {
  TW: 'TW', TH: 'TW',
  IV: 'DEF', LIV: 'DEF', ZIV: 'DEF', RIV: 'DEF', LV: 'DEF', RV: 'DEF', AV: 'DEF',
  ZDM: 'MID', DM: 'MID', ZM: 'MID', ZOM: 'MID', OM: 'MID', LM: 'MID', RM: 'MID',
  ST: 'ATT', LS: 'ATT', RS: 'ATT', MS: 'ATT', LF: 'ATT', RF: 'ATT', LW: 'ATT', RW: 'ATT',
};
const SLOT_GROUP = (label) => HP_TO_GROUP[label] || (label === 'TW' ? 'TW' : 'MID');

// Startelf automatisch aus den Rollen-Mitgliedern füllen (nach HP-Tag auf passende Positionen)
async function autoFill(guildId, lineup) {
  const { players: pool } = await getKaderPlayers(guildId, lineup.team); // nutzt die Rolle 1/2 Mannschaft
  const slots = FORMATIONS[lineup.formation];
  const used = new Set();
  const result = {};
  // bereits von Hand gesetzte Spieler behalten und nicht erneut vergeben
  for (const s of slots) {
    const name = lineup.players[s.key];
    if (name) {
      result[s.key] = name;
      const p = pool.find((x) => x.name === name);
      if (p) used.add(p.id);
    }
  }

  // 1. Runde: exakte Position (HP == Slot-Label), 2. Runde: gleiche Gruppe, 3. Runde: Rest auffüllen
  const take = (pred) => (slot) => {
    if (result[slot.key]) return;
    const p = pool.find((x) => !used.has(x.id) && pred(x, slot));
    if (p) {
      result[slot.key] = p.name;
      used.add(p.id);
    }
  };
  slots.forEach(take((x, slot) => x.pos && x.pos.toUpperCase() === slot.label));
  slots.forEach(take((x, slot) => SLOT_GROUP((x.pos || '').toUpperCase()) === SLOT_GROUP(slot.label)));
  slots.forEach(take(() => true));

  return { ...lineup, players: result };
}

// ---------- Discord-UI ----------
function lineupEmbed(lineup, roleName, imageName) {
  const t = KADER_TEAMS[lineup.team];
  const slots = FORMATIONS[lineup.formation];
  const filled = slots.filter((s) => lineup.players[s.key]).length;
  const lines = slots
    .map((s) => `**${s.label}:** ${lineup.players[s.key] || '—'}`)
    .join('   ');
  return {
    title: `${t.label.toUpperCase()} | ${String(lineup.title).toUpperCase()}`,
    description: `Formation **${lineup.formation}** · ${filled}/11 besetzt`,
    color: t.color,
    fields: [{ name: 'Positionen', value: lines.slice(0, 1024) }],
    image: imageName ? { url: `attachment://${imageName}` } : undefined,
    footer: { text: 'Wir sind eine große Familie 🇮🇹' },
  };
}

function formationRow(lineup) {
  return {
    type: 1,
    components: [{
      type: 3,
      custom_id: `lineup:form:${lineup.team}`,
      placeholder: `Formation: ${lineup.formation}`,
      options: FORMATION_NAMES.map((f) => ({ label: f, value: f, default: f === lineup.formation })),
    }],
  };
}

function positionRow(lineup) {
  const slots = FORMATIONS[lineup.formation];
  return {
    type: 1,
    components: [{
      type: 3,
      custom_id: `lineup:slot:${lineup.team}`,
      placeholder: 'Position besetzen…',
      options: slots.slice(0, 25).map((s) => ({
        label: `${s.label}${lineup.players[s.key] ? ' · ' + lineup.players[s.key] : ''}`.slice(0, 100),
        value: s.key,
      })),
    }],
  };
}

function actionRow(lineup) {
  return {
    type: 1,
    components: [
      { type: 2, style: 1, label: 'Automatisch füllen', emoji: { name: '✨' }, custom_id: `lineup:auto:${lineup.team}` },
      { type: 2, style: 2, label: 'Alle leeren', emoji: { name: '🧹' }, custom_id: `lineup:clear:${lineup.team}` },
    ],
  };
}

function lineupComponents(lineup) {
  return [formationRow(lineup), positionRow(lineup), actionRow(lineup)];
}

async function requestLineupRefresh(payload) {
  const store = lineupStore();
  if (payload.action === 'post') await store.setJSON(`pending-${payload.key}`, { ...payload, createdAt: Date.now() });
  else await store.set(`dirty-${payload.key}`, String(Date.now()));
  try {
    await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-worker-secret': process.env.CRON_SECRET || '' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(1200),
    });
  } catch {
    // Timeout gewollt: der Worker rendert im Hintergrund weiter
  }
}

module.exports = {
  FORMATION_NAMES,
  DEFAULT_FORMATION,
  lineupStore,
  lineupKey,
  emptyLineup,
  getLineup,
  saveLineup,
  switchFormation,
  autoFill,
  lineupEmbed,
  lineupComponents,
  requestLineupRefresh,
  isKaderAdmin,
  api,
  getGuildRoles,
  KADER_TEAMS,
};
