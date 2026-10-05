// Wird alle 15 Minuten von einem GitHub-Actions-Workflow aufgerufen (siehe
// .github/workflows/check-matches.yml). Prüft für jeden Club, ob ein neues Spiel
// (Liga oder Freundschaft/Cup) gespielt wurde, und postet dann automatisch die
// Spielbericht-Bilder in den Kanal "match-history" — nur Bilder, kein Text.
// Während einer /session übernimmt zusätzlich session-check.js (alle 2 Minuten);
// der gemeinsame Duplikat-Schutz verhindert doppelte Posts.

const {
  CLUBS,
  TARGET_CHANNEL_NAME,
  blobStore,
  getRecentMatches,
  matchIdOf,
  buildReportData,
  renderReportImages,
  findStatsRoleId,
  findChannelId,
  postImagesToDiscord,
  isPosted,
  markPosted,
} = require('./lib/match-core');

exports.handler = async (event) => {
  // Schutz: nur mit korrektem Geheimwert aufrufbar
  const providedSecret = event.queryStringParameters?.secret;
  if (!process.env.CRON_SECRET || providedSecret !== process.env.CRON_SECRET) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Nicht autorisiert' }) };
  }

  const store = blobStore('proclubs-last-seen');
  const force = event.queryStringParameters?.force === '1'; // Test: Duplikat-Prüfung überspringen
  const results = [];

  for (const club of CLUBS) {
    try {
      const [match] = await getRecentMatches(club.clubId, 5);
      if (!match) {
        results.push({ club: club.label, status: 'kein Spiel gefunden' });
        continue;
      }

      const matchId = matchIdOf(match, club.clubId);
      if (!force && (await isPosted(store, club.clubId, matchId))) {
        results.push({ club: club.label, status: 'kein neues Spiel' });
        continue;
      }

      const channelId = await findChannelId();
      if (!channelId) {
        results.push({ club: club.label, status: `Kanal "${TARGET_CHANNEL_NAME}" nicht gefunden` });
        continue;
      }

      const reportData = await buildReportData(match, club);
      const statsRoleId = await findStatsRoleId();
      await postImagesToDiscord(channelId, await renderReportImages(reportData), {
        roleId: statsRoleId,
        text: `📊 Neues Spiel von **${club.label}**`,
      });
      await markPosted(store, club.clubId, matchId);

      results.push({ club: club.label, status: 'gepostet', matchId });
    } catch (err) {
      results.push({ club: club.label, status: 'Fehler: ' + err.message });
    }
  }

  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, results }) };
};
