// Löscht ein Event aus der Blobs-Datenbank (macht die RSVP-Buttons ungültig und
// entfernt es aus der Aufstellungs-Auswahl). Falls Kanal- und Nachrichten-ID bekannt
// sind (bei über die Website erstellten Events der Fall), wird zusätzlich versucht,
// die ursprüngliche Discord-Nachricht mit zu löschen.

const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Ungültige Anfrage' }) };
  }

  const { eventId } = data;
  if (!eventId) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Keine eventId angegeben' }) };
  }

  const store = getStore({
    name: 'rsvp-events',
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_BLOBS_TOKEN,
  });

  const ev = await store.get(eventId, { type: 'json' });

  let messageDeleted = false;
  if (ev?.channelId && ev?.messageId) {
    try {
      const res = await fetch(`https://discord.com/api/v10/channels/${ev.channelId}/messages/${ev.messageId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` },
      });
      messageDeleted = res.ok;
    } catch {
      messageDeleted = false;
    }
  }

  await store.delete(eventId);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, messageDeleted }),
  };
};
