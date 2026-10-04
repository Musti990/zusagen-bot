// Rendert das Kader-Bild und aktualisiert die Kader-Nachricht in Discord.
// Wird von interactions.js angestoßen (dort darf eine Antwort max. 3 Sekunden dauern,
// das Rendern braucht länger). Nur mit dem Geheimwert CRON_SECRET aufrufbar.

const { finishKaderPost, refreshKader } = require('./lib/kader-render');

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
    if (payload.action === 'post') await finishKaderPost(payload);
    else await refreshKader(payload);
    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('kader-worker:', err);
    return { statusCode: 500, body: err.message };
  }
};
