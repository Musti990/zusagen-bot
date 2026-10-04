// Rendert das Aufstellungs-Bild und aktualisiert die /aufstellung-Nachricht.
// Von interactions.js angestoßen (dort max. 3 s Zeit, Rendern dauert länger).

const { finishLineupPost, refreshLineup } = require('./lib/lineup-render');

exports.handler = async (event) => {
  if (!process.env.CRON_SECRET || event.headers['x-worker-secret'] !== process.env.CRON_SECRET) {
    return { statusCode: 401, body: 'Nicht autorisiert' };
  }
  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Ungültige Anfrage' };
  }
  try {
    if (payload.action === 'post') await finishLineupPost(payload);
    else await refreshLineup(payload);
    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('lineup-worker:', err);
    return { statusCode: 500, body: err.message };
  }
};
