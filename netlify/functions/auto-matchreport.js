// Wird alle 15 Minuten von einem GitHub-Actions-Workflow aufgerufen (siehe
// .github/workflows/check-matches.yml). Prüft für jeden konfigurierten Club, ob seit dem
// letzten Aufruf ein neues Spiel (Liga oder Freundschaft) gespielt wurde, und postet in
// diesem Fall automatisch die Spielbericht-Grafik in den Kanal "match-history" — komplett
// ohne manuelles Zutun.

const { Impit } = require('impit');
const { getStore } = require('@netlify/blobs');
const { setupFonts } = require('./lib/fonts');
setupFonts(); // Schrift bereitstellen, BEVOR sharp zum ersten Mal rendert (Netlify hat keine Systemschriften)
const sharp = require('sharp');
const { buildMatchReportSvg } = require('./lib/matchreport-svg');

const impit = new Impit({ browser: 'chrome' });
const EA_BASE = 'https://proclubs.ea.com/api/fc';

// Die beiden zu überwachenden Clubs
const CLUBS_TO_WATCH = [
  { clubId: '22829', label: 'Calcio Strada 1' },
  { clubId: '20998', label: 'Calcio Strada 2' },
];

const TARGET_CHANNEL_NAME = 'match-history';

async function eaFetch(path) {
  const res = await impit.fetch(`${EA_BASE}${path}`, {
    headers: { Accept: 'application/json', Referer: 'https://www.ea.com/' },
  });
  if (!res.ok) throw new Error(`EA Status ${res.status}`);
  return res.json();
}

async function getLatestMatch(clubId) {
  const [league, friendly] = await Promise.all([
    eaFetch(`/clubs/matches?platform=common-gen5&clubIds=${clubId}&matchType=leagueMatch&maxResultCount=5`).catch(() => []),
    eaFetch(`/clubs/matches?platform=common-gen5&clubIds=${clubId}&matchType=friendlyMatch&maxResultCount=5`).catch(() => []),
  ]);
  // Spieltyp merken, damit die Grafik "LEAGUE MATCH" / "FRIENDLY MATCH" anzeigen kann
  const tag = (list, type) => (Array.isArray(list) ? list : []).map((m) => Object.assign(m, { _matchType: type }));
  const all = [].concat(tag(league, 'leagueMatch'), tag(friendly, 'friendlyMatch'));
  if (all.length === 0) return null;
  all.sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0));
  return all[0];
}

// Wappen eines Clubs vom EA-CDN laden und als data:-URI zurückgeben (oder null).
// EA liefert in den Matchdaten nur die crestAssetId; das Bild liegt auf dem Content-CDN.
// Mehrere Jahrgänge durchprobieren, da nicht jedes Wappen auf jedem Pfad liegt.
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
  }));
}

async function findChannelId(guildId) {
  const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
    headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` },
  });
  if (!res.ok) return null;
  const channels = await res.json();
  const match = channels.find((c) => c.type === 0 && c.name === TARGET_CHANNEL_NAME);
  return match ? match.id : null;
}

async function renderToPng(svg) {
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function postImageToDiscord(channelId, buffer, caption) {
  const form = new FormData();
  form.append('payload_json', JSON.stringify({ content: caption }));
  form.append('files[0]', new Blob([buffer], { type: 'image/png' }), 'spielbericht.png');

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

exports.handler = async (event) => {
  // Schutz: nur mit korrektem Geheimwert aufrufbar, damit niemand sonst diesen Endpunkt auslöst
  const providedSecret = event.queryStringParameters?.secret;
  if (!process.env.CRON_SECRET || providedSecret !== process.env.CRON_SECRET) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Nicht autorisiert' }) };
  }

  const store = getStore({
    name: 'proclubs-last-seen',
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_BLOBS_TOKEN,
  });

  const guildId = process.env.GUILD_ID;
  const force = event.queryStringParameters?.force === '1'; // Test: Duplikat-Prüfung überspringen
  const results = [];

  for (const club of CLUBS_TO_WATCH) {
    try {
      const match = await getLatestMatch(club.clubId);
      if (!match || !match.clubs) {
        results.push({ club: club.label, status: 'kein Spiel gefunden' });
        continue;
      }

      const matchId = match.match_id || `${match.timestamp}-${club.clubId}`;
      const lastSeen = await store.get(`club-${club.clubId}`, { type: 'text' });

      if (!force && lastSeen === String(matchId)) {
        results.push({ club: club.label, status: 'kein neues Spiel' });
        continue;
      }

      const teamIds = Object.keys(match.clubs);
      const homeId = teamIds.includes(String(club.clubId)) ? String(club.clubId) : teamIds[0];
      const awayId = teamIds.find((id) => id !== homeId) || teamIds[1] || teamIds[0];

      const homeName = match.clubs[homeId]?.details?.name || match.clubs[homeId]?.name || club.label;
      const awayName = match.clubs[awayId]?.details?.name || match.clubs[awayId]?.name || 'Gegner';
      const homeGoals = match.clubs[homeId]?.score ?? match.clubs[homeId]?.goals ?? '0';
      const awayGoals = match.clubs[awayId]?.score ?? match.clubs[awayId]?.goals ?? '0';

      const homePlayersObj = (match.players && match.players[homeId]) || {};
      const awayPlayersObj = (match.players && match.players[awayId]) || {};

      const homeAttempts = sumPlayerStat(homePlayersObj, 'passattempts');
      const awayAttempts = sumPlayerStat(awayPlayersObj, 'passattempts');
      const homeMade = sumPlayerStat(homePlayersObj, 'passesmade');
      const awayMade = sumPlayerStat(awayPlayersObj, 'passesmade');

      const awayCrest = await fetchCrestDataUri(match.clubs[awayId]);

      const svg = buildMatchReportSvg({
        homeName,
        awayName,
        homeGoals,
        awayGoals,
        awayCrest,
        matchType: match._matchType,
        dateText: match.timestamp
          ? new Date(Number(match.timestamp) * 1000).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })
          : '',
        stats: {
          shots: { h: sumPlayerStat(homePlayersObj, 'shots'), a: sumPlayerStat(awayPlayersObj, 'shots') },
          passes: { h: homeMade, a: awayMade },
          passacc: {
            h: homeAttempts > 0 ? Math.round((homeMade / homeAttempts) * 100) : 0,
            a: awayAttempts > 0 ? Math.round((awayMade / awayAttempts) * 100) : 0,
          },
          duels: { h: sumPlayerStat(homePlayersObj, 'tacklesmade'), a: sumPlayerStat(awayPlayersObj, 'tacklesmade') },
          saves: { h: sumPlayerStat(homePlayersObj, 'saves'), a: sumPlayerStat(awayPlayersObj, 'saves') },
        },
        homePlayers: extractPlayers(homePlayersObj),
        awayPlayers: extractPlayers(awayPlayersObj),
      });

      const png = await renderToPng(svg);

      const channelId = await findChannelId(guildId);
      if (!channelId) {
        results.push({ club: club.label, status: `Kanal "${TARGET_CHANNEL_NAME}" nicht gefunden` });
        continue;
      }

      await postImageToDiscord(channelId, png, `${homeName} ${homeGoals}:${awayGoals} ${awayName}`);
      await store.set(`club-${club.clubId}`, String(matchId));

      results.push({ club: club.label, status: 'gepostet', matchId });
    } catch (err) {
      results.push({ club: club.label, status: 'Fehler: ' + err.message });
    }
  }

  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, results }) };
};
