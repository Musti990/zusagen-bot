// Session-Verwaltung für /session und /sessionend.
// Pro Club liegt in Netlify Blobs ein Eintrag "session-<clubId>" mit allen Spielen der Session.

const { CLUBS, blobStore } = require('./clubs');

const MAX_SESSION_MS = 6 * 60 * 60 * 1000; // vergessene Sessions enden nach 6 Stunden automatisch
const END_DELAY_MS = 90 * 1000; // nach /sessionend noch kurz warten, falls EA das letzte Spiel spät liefert

function sessionStore() {
  return blobStore('proclubs-sessions');
}

// "1", "2" oder leer/"beide" -> passende Clubs
function clubsForTeam(team) {
  if (team === '1' || team === '2') return CLUBS.filter((c) => c.team === team);
  return CLUBS;
}

async function getSession(store, clubId) {
  return store.get(`session-${clubId}`, { type: 'json' });
}

async function saveSession(store, session) {
  await store.setJSON(`session-${session.clubId}`, session);
}

async function deleteSession(store, clubId) {
  await store.delete(`session-${clubId}`);
}

function newSession(club, userName) {
  return {
    clubId: club.clubId,
    label: club.label,
    startedAt: Date.now(),
    startedBy: userName || '',
    endRequestedAt: null,
    matches: [],
  };
}

// Nur das Nötigste pro Spiel speichern (für die Bilanz)
function toSessionMatch(matchId, timestamp, reportData) {
  return {
    matchId,
    timestamp: Number(timestamp) || 0,
    oppName: reportData.awayName,
    homeGoals: Number(reportData.homeGoals) || 0,
    awayGoals: Number(reportData.awayGoals) || 0,
    matchType: reportData.matchType,
    players: reportData.homePlayers.map((p) => ({
      name: p.name,
      pos: p.pos,
      rating: p.rating,
      goals: p.goals,
      assists: p.assists,
      passesmade: p.passesmade,
      passattempts: p.passattempts,
    })),
  };
}

// Session -> Daten für die Bilanz-Grafik (Spieler über alle Spiele zusammengefasst)
function buildSummaryData(session) {
  const matches = session.matches.slice().sort((a, b) => a.timestamp - b.timestamp);
  const byName = new Map();
  matches.forEach((m) => {
    m.players.forEach((p) => {
      const e = byName.get(p.name) || { name: p.name, posCount: {}, ratings: [], goals: 0, assists: 0, passesmade: 0, passattempts: 0 };
      e.posCount[p.pos] = (e.posCount[p.pos] || 0) + 1;
      const r = parseFloat(p.rating);
      if (!isNaN(r)) e.ratings.push(r);
      e.goals += p.goals || 0;
      e.assists += p.assists || 0;
      e.passesmade += p.passesmade || 0;
      e.passattempts += p.passattempts || 0;
      byName.set(p.name, e);
    });
  });
  const players = [...byName.values()].map((e) => ({
    ...e,
    pos: Object.entries(e.posCount).sort((a, b) => b[1] - a[1])[0]?.[0] || '', // häufigste Position
  }));

  const dateText = new Date(session.startedAt)
    .toLocaleDateString('de-AT', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Vienna' })
    .toUpperCase();

  return { teamName: session.label, dateText, matches, players };
}

module.exports = {
  MAX_SESSION_MS,
  END_DELAY_MS,
  sessionStore,
  clubsForTeam,
  getSession,
  saveSession,
  deleteSession,
  newSession,
  toSessionMatch,
  buildSummaryData,
};
