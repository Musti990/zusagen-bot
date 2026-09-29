// Nimmt ein über die Webseite (members-page.js) erstelltes Event entgegen,
// postet es genau wie /event mit Accepted/Maybe/Declined-Buttons in den gewählten
// Kanal, und speichert es in derselben Blobs-Datenbank wie interactions.js,
// damit die Buttons danach ganz normal weiterfunktionieren.

const { getStore } = require('@netlify/blobs');
const { berlinToUtcTimestamp, buildEmbed, buildComponents } = require('./lib/event-core');

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

  const { titel, datum, uhrzeit, limit, info, beschreibung, mannschaft, channelId, creator, image } = data;

  if (!channelId) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Kein Kanal angegeben' }) };
  }
  if (!titel || !datum || !uhrzeit) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Titel, Datum und Uhrzeit sind Pflichtfelder' }) };
  }

  const [day, month, year] = datum.split('.').map(Number);
  const [hour, minute] = uhrzeit.split(':').map(Number);
  const validityCheck = new Date(year, (month || 1) - 1, day, hour, minute);
  if (isNaN(validityCheck.getTime())) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Datum oder Uhrzeit ungültig. Format: TT.MM.JJJJ / HH:MM' }) };
  }

  const guildId = process.env.GUILD_ID;
  const eventId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const ev = {
    title: titel,
    flag: info || '',
    beschreibung: beschreibung || '',
    limit: Number(limit) || 0,
    timestamp: berlinToUtcTimestamp(year, month, day, hour, minute),
    creator: creator || 'Website',
    guildId,
    channelId,
    imageUrl: null,
    team: mannschaft || null,
    accepted: [],
    maybe: [],
    declined: [],
  };

  const store = getStore({
    name: 'rsvp-events',
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_BLOBS_TOKEN,
  });

  let res;

  if (image && image.startsWith('data:image/png;base64,')) {
    // Bild zuerst hochladen, um die persistente Discord-CDN-URL zu bekommen
    // (attachment:// funktioniert nur innerhalb derselben Anfrage, nicht für spätere Button-Updates).
    const base64Data = image.split(',')[1];
    const buffer = Buffer.from(base64Data, 'base64');

    const embedWithPlaceholder = await buildEmbed(ev);
    embedWithPlaceholder.image = { url: 'attachment://event.png' };

    const form = new FormData();
    form.append('payload_json', JSON.stringify({ embeds: [embedWithPlaceholder], components: buildComponents(eventId) }));
    form.append('files[0]', new Blob([buffer], { type: 'image/png' }), 'event.png');

    res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` },
      body: form,
    });

    if (res.ok) {
      const posted = await res.json();
      ev.imageUrl = posted.attachments?.[0]?.url || null;
      ev.messageId = posted.id || null;
      await store.setJSON(eventId, ev);
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
    }
  } else {
    res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ embeds: [await buildEmbed(ev)], components: buildComponents(eventId) }),
    });

    if (res.ok) {
      const posted = await res.json();
      ev.messageId = posted.id || null;
      await store.setJSON(eventId, ev);
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
    }
  }

  const errText = await res.text();
  return { statusCode: 502, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Discord-Fehler: ' + errText }) };
};
