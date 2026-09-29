// Nimmt eine über die Webseite (members-page.js) gebaute Aufstellung entgegen
// und postet NUR das generierte Spielfeld-Bild in den gewählten Discord-Kanal.

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

  const { team, channelId, description, image } = data;

  if (!channelId) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Kein Kanal angegeben' }) };
  }
  if (!image || !image.startsWith('data:image/png;base64,')) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Kein Bild vorhanden' }) };
  }

  const base64Data = image.split(',')[1];
  const buffer = Buffer.from(base64Data, 'base64');

  const captionParts = [team, description].filter(Boolean);
  const content = captionParts.length > 0 ? captionParts.join(' — ') : undefined;

  const form = new FormData();
  form.append('payload_json', JSON.stringify({ content }));
  form.append('files[0]', new Blob([buffer], { type: 'image/png' }), 'aufstellung.png');

  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` },
    body: form,
  });

  if (!res.ok) {
    const errText = await res.text();
    return { statusCode: 502, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Discord-Fehler: ' + errText }) };
  }

  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
};
