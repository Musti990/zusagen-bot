// Nimmt den auf der Webseite als Bild erzeugten Spielbericht entgegen und postet
// ihn als Datei-Anhang mit kurzer Bildunterschrift in den gewählten Kanal.

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

  const { channelId, image, caption } = data;

  if (!channelId) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Kein Kanal angegeben' }) };
  }
  if (!image || !image.startsWith('data:image/png;base64,')) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Kein Bild vorhanden' }) };
  }

  const base64Data = image.split(',')[1];
  const buffer = Buffer.from(base64Data, 'base64');

  const form = new FormData();
  form.append('payload_json', JSON.stringify({ content: caption || undefined }));
  form.append('files[0]', new Blob([buffer], { type: 'image/png' }), 'spielbericht.png');

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
