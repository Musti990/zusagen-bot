// Läuft alle 2 Minuten automatisch (Zeitplan steht in netlify.toml).
// Ohne aktive Session passiert nichts. Während einer /session:
//  - neue Spiele seit Session-Start erkennen, Spielbericht-Bilder posten, für die Bilanz speichern
//  - nach /sessionend (oder spätestens nach 6 Stunden) die Session-Bilanz posten und beenden

const {
  CLUBS,
  blobStore,
  getRecentMatches,
  matchIdOf,
  buildReportData,
  renderReportImages,
  renderSessionSummary,
  findChannelId,
  postImagesToDiscord,
  isPosted,
  markPosted,
} = require('./lib/match-core');
const {
  MAX_SESSION_MS,
  END_DELAY_MS,
  sessionStore,
  getSession,
  saveSession,
  deleteSession,
  toSessionMatch,
  buildSummaryData,
} = require('./lib/session-core');

// Netlify beendet zeitgesteuerte Funktionen nach 30 s -> pro Lauf höchstens so viele Spiele
// verarbeiten; der Rest kommt automatisch beim nächsten Lauf 2 Minuten später.
const MAX_MATCHES_PER_RUN = 2;

exports.handler = async () => {
  const sessions = sessionStore();
  const posted = blobStore('proclubs-last-seen');
  const results = [];
  let budget = MAX_MATCHES_PER_RUN;

  for (const club of CLUBS) {
    const session = await getSession(sessions, club.clubId);
    if (!session) continue; // keine Session -> nichts zu tun

    const now = Date.now();
    let pending = false;

    try {
      const recent = await getRecentMatches(club.clubId, 5);
      const known = new Set(session.matches.map((m) => m.matchId));
      const fresh = recent
        .filter((m) => Number(m.timestamp) * 1000 >= session.startedAt - 2 * 60 * 1000) // nur Spiele ab Session-Start
        .filter((m) => !known.has(matchIdOf(m, club.clubId)))
        .sort((a, b) => Number(a.timestamp) - Number(b.timestamp)); // älteste zuerst posten

      for (const match of fresh) {
        if (budget <= 0) {
          pending = true;
          break;
        }
        budget--;
        const matchId = matchIdOf(match, club.clubId);
        // In der Session sind Freundschaftsspiele eure Cups -> "CUP MATCH"
        const reportData = await buildReportData(match, club, {
          matchType: match._matchType === 'friendlyMatch' ? 'cupMatch' : match._matchType,
        });

        if (!(await isPosted(posted, club.clubId, matchId))) {
          const channelId = await findChannelId();
          if (channelId) {
            await postImagesToDiscord(channelId, await renderReportImages(reportData));
            await markPosted(posted, club.clubId, matchId);
          }
        }

        session.matches.push(toSessionMatch(matchId, match.timestamp, reportData));
        await saveSession(sessions, session);
        results.push({ club: club.label, status: 'Spiel erfasst', matchId });
      }
    } catch (err) {
      results.push({ club: club.label, status: 'Fehler: ' + err.message });
    }

    // Session abschließen?
    const endDue = session.endRequestedAt && now >= session.endRequestedAt + END_DELAY_MS;
    const expired = now - session.startedAt > MAX_SESSION_MS;
    if ((endDue || expired) && !pending && budget > 0) {
      try {
        if (session.matches.length > 0) {
          const channelId = await findChannelId();
          if (channelId) await postImagesToDiscord(channelId, await renderSessionSummary(buildSummaryData(session)));
        }
        await deleteSession(sessions, club.clubId);
        results.push({ club: club.label, status: `Session beendet (${session.matches.length} Spiele)` });
      } catch (err) {
        results.push({ club: club.label, status: 'Fehler beim Beenden: ' + err.message });
      }
    }
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, results }) };
};
