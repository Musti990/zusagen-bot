// Gemeinsame Logik für automatische Spielberichte und Sessions:
// EA-Abruf, Daten aufbereiten, Bilder rendern, in Discord posten, Duplikat-Schutz.

const { Impit } = require('impit');
const { CLUBS, blobStore } = require('./clubs');
const { setupFonts } = require('./fonts');
setupFonts(); // Schrift bereitstellen, BEVOR sharp zum ersten Mal rendert (Netlify hat keine Systemschriften)
const sharp = require('sharp');
const { buildMatchReportSvg, buildPlayerStatsSvg, buildSessionSummarySvg } = require('./matchreport-svg');

const impit = new Impit({ browser: 'chrome' });
const EA_BASE = 'https://proclubs.ea.com/api/fc';
const TARGET_CHANNEL_NAME = 'match-history';

async function eaFetch(path) {
  const res = await impit.fetch(`${EA_BASE}${path}`, {
    headers: { Accept: 'application/json', Referer: 'https://www.ea.com/' },
  });
  if (!res.ok) throw new Error(`EA Status ${res.status}`);
  return res.json();
}

// Letzte Liga- und Freundschaftsspiele (Cups laufen als Freundschaftsspiele), neueste zuerst
async function getRecentMatches(clubId, count = 5) {
  const [league, friendly] = await Promise.all([
    eaFetch(`/clubs/matches?platform=common-gen5&clubIds=${clubId}&matchType=leagueMatch&maxResultCount=${count}`).catch(() => []),
    eaFetch(`/clubs/matches?platform=common-gen5&clubIds=${clubId}&matchType=friendlyMatch&maxResultCount=${count}`).catch(() => []),
  ]);
  const tag = (list, type) => (Array.isArray(list) ? list : []).map((m) => Object.assign(m, { _matchType: type }));
  return []
    .concat(tag(league, 'leagueMatch'), tag(friendly, 'friendlyMatch'))
    .filter((m) => m && m.clubs)
    .sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0));
}

function matchIdOf(match, clubId) {
  return String(match.match_id || `${match.timestamp}-${clubId}`);
}

function sumPlayerStat(playersObj, key) {
  let total = 0;
  Object.values(playersObj || {}).forEach((p) => {
    total += Number(p[key]) || 0;
  });
  return total;
}

function extractPlayers(playersObj) {
  return Object.values(playersObj || {}).map((p) => ({
    pos: p.pos || '',
    name: p.playername || 'Unbekannt',
    goals: Number(p.goals) || 0,
    assists: Number(p.assists) || 0,
    rating: p.rating || '—',
    shots: Number(p.shots) || 0,
    passesmade: Number(p.passesmade) || 0,
    passattempts: Number(p.passattempts) || 0,
    tacklesmade: Number(p.tacklesmade) || 0,
    tackleattempts: Number(p.tackleattempts) || 0,
    saves: Number(p.saves) || 0,
    redcards: Number(p.redcards) || 0,
    // nur übernehmen, falls EA Abfangaktionen überhaupt liefert
    ...(p.interceptions != null ? { interceptions: Number(p.interceptions) || 0 } : {}),
  }));
}

// Wappen eines Clubs vom EA-CDN laden und als data:-URI zurückgeben (oder null).
const CREST_BASES = [
  'https://eafc26.content.easports.com/fifa/fltOnlineAssets/26E4D4D6-8DBB-4A9A-BD99-9C47D3AA341D/2026/fcweb/crests/256x256/l',
  'https://eafc25.content.easports.com/fifa/fltOnlineAssets/25E4CDAE-799B-45BE-B257-667FDCDE8044/2025/fcweb/crests/256x256/l',
  'https://eafc24.content.easports.com/fifa/fltOnlineAssets/24B23FDE-7835-41C2-87A2-F453DFDB2E82/2024/fcweb/crests/256x256/l',
];

async function fetchCrestDataUri(clubData) {
  const details = clubData?.details || {};
  const crestId = details.customKit?.crestAssetId || details.crestAssetId;
  if (!crestId) return null;
  for (const base of CREST_BASES) {
    try {
      const res = await fetch(`${base}${crestId}.png`, { signal: AbortSignal.timeout(4000) });
      const type = res.headers.get('content-type') || '';
      if (!res.ok || !type.startsWith('image/')) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      return `data:${type.split(';')[0]};base64,${buf.toString('base64')}`;
    } catch (_) {
      // nächsten Pfad probieren
    }
  }
  return null; // kein Wappen gefunden -> Grafik nutzt Ersatz-Wappen mit Initialen
}

// EA-Matchdaten -> Daten für die Grafiken (aus Sicht des eigenen Clubs)
async function buildReportData(match, club, { matchType } = {}) {
  const teamIds = Object.keys(match.clubs);
  const homeId = teamIds.includes(String(club.clubId)) ? String(club.clubId) : teamIds[0];
  const awayId = teamIds.find((id) => id !== homeId) || teamIds[1] || teamIds[0];

  const homePlayersObj = (match.players && match.players[homeId]) || {};
  const awayPlayersObj = (match.players && match.players[awayId]) || {};
  const homeAttempts = sumPlayerStat(homePlayersObj, 'passattempts');
  const awayAttempts = sumPlayerStat(awayPlayersObj, 'passattempts');
  const homeMade = sumPlayerStat(homePlayersObj, 'passesmade');
  const awayMade = sumPlayerStat(awayPlayersObj, 'passesmade');
  const both = (key) => ({ h: sumPlayerStat(homePlayersObj, key), a: sumPlayerStat(awayPlayersObj, key) });
  const hasInterceptions = Object.values(homePlayersObj).concat(Object.values(awayPlayersObj)).some((p) => p.interceptions != null);

  return {
    homeName: match.clubs[homeId]?.details?.name || match.clubs[homeId]?.name || club.label,
    awayName: match.clubs[awayId]?.details?.name || match.clubs[awayId]?.name || 'Gegner',
    homeGoals: match.clubs[homeId]?.score ?? match.clubs[homeId]?.goals ?? '0',
    awayGoals: match.clubs[awayId]?.score ?? match.clubs[awayId]?.goals ?? '0',
    awayCrest: await fetchCrestDataUri(match.clubs[awayId]),
    matchType: matchType || match._matchType,
    dateText: match.timestamp
      ? new Date(Number(match.timestamp) * 1000).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })
      : '',
    stats: {
      shots: both('shots'),
      passes: { h: homeMade, a: awayMade },
      passesLost: { h: Math.max(0, homeAttempts - homeMade), a: Math.max(0, awayAttempts - awayMade) },
      passacc: {
        h: homeAttempts > 0 ? Math.round((homeMade / homeAttempts) * 100) : 0,
        a: awayAttempts > 0 ? Math.round((awayMade / awayAttempts) * 100) : 0,
      },
      duels: both('tacklesmade'),
      tackleAttempts: both('tackleattempts'),
      redcards: both('redcards'),
      ...(hasInterceptions ? { interceptions: both('interceptions') } : {}),
      saves: both('saves'),
    },
    homePlayers: extractPlayers(homePlayersObj),
    awayPlayers: extractPlayers(awayPlayersObj),
  };
}

async function renderToPng(svg) {
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function renderReportImages(reportData) {
  return [
    { name: 'spielbericht.png', buffer: await renderToPng(buildMatchReportSvg(reportData)) },
    { name: 'spielerstatistik.png', buffer: await renderToPng(buildPlayerStatsSvg(reportData)) },
  ];
}

async function renderSessionSummary(summaryData) {
  return [{ name: 'session-bilanz.png', buffer: await renderToPng(buildSessionSummarySvg(summaryData)) }];
}

let cachedChannelId = null;
async function findChannelId() {
  if (cachedChannelId) return cachedChannelId;
  const res = await fetch(`https://discord.com/api/v10/guilds/${process.env.GUILD_ID}/channels`, {
    headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` },
  });
  if (!res.ok) return null;
  const channels = await res.json();
  const match = channels.find((c) => c.type === 0 && c.name === TARGET_CHANNEL_NAME);
  cachedChannelId = match ? match.id : null;
  return cachedChannelId;
}

const STATS_ROLE_NAME = 'statistiken';
let cachedStatsRoleId; // undefined = noch nicht gesucht, null = nicht vorhanden

// Rollen-ID der @Statistiken-Rolle finden (einmal cachen)
async function findStatsRoleId() {
  if (cachedStatsRoleId !== undefined) return cachedStatsRoleId;
  const res = await fetch(`https://discord.com/api/v10/guilds/${process.env.GUILD_ID}/roles`, {
    headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` },
  });
  cachedStatsRoleId = null;
  if (res.ok) {
    const roles = await res.json();
    const r = roles.find((x) => String(x.name).toLowerCase() === STATS_ROLE_NAME);
    if (r) cachedStatsRoleId = r.id;
  }
  return cachedStatsRoleId;
}

// Postet nur die Bilder (ohne Text) in einer Nachricht
async function postImagesToDiscord(channelId, images, content) {
  const form = new FormData();
  const payload = { attachments: images.map((img, i) => ({ id: i, filename: img.name })) };
  if (content && content.roleId) {
    payload.content = `<@&${content.roleId}>${content.text ? ' ' + content.text : ''}`;
    payload.allowed_mentions = { roles: [content.roleId] }; // gezielt nur diese Rolle pingen
  } else if (content && content.text) {
    payload.content = content.text;
  }
  form.append('payload_json', JSON.stringify(payload));
  images.forEach((img, i) => form.append(`files[${i}]`, new Blob([img.buffer], { type: 'image/png' }), img.name));

  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord-Post fehlgeschlagen: ${res.status} ${text}`);
  }
}

// ---------- Duplikat-Schutz: welche Spiele wurden schon gepostet? ----------
// Gemeinsam für den 15-Minuten-Check und die Session, damit nichts doppelt kommt.
async function isPosted(store, clubId, matchId) {
  const list = (await store.get(`posted-${clubId}`, { type: 'json' })) || [];
  if (list.includes(String(matchId))) return true;
  const legacy = await store.get(`club-${clubId}`, { type: 'text' }); // altes Format (nur letztes Spiel)
  return legacy === String(matchId);
}

async function markPosted(store, clubId, matchId) {
  const list = (await store.get(`posted-${clubId}`, { type: 'json' })) || [];
  if (!list.includes(String(matchId))) list.push(String(matchId));
  await store.setJSON(`posted-${clubId}`, list.slice(-50));
  await store.set(`club-${clubId}`, String(matchId));
}

module.exports = {
  CLUBS,
  TARGET_CHANNEL_NAME,
  blobStore,
  getRecentMatches,
  matchIdOf,
  buildReportData,
  renderReportImages,
  renderSessionSummary,
  findChannelId,
  findStatsRoleId,
  postImagesToDiscord,
  isPosted,
  markPosted,
};
