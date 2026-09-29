// Nimmt eine über die Webseite (members-page.js) gebaute Aufstellung entgegen
// und postet sie als Embed in den gewählten Discord-Kanal.

function fmtLine(positions, codes) {
  return codes
    .map((c) => `**${c === 'ZDM2' ? 'ZDM' : c}:** ${positions[c] || '—'}`)
    .join('   ');
}

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

  const { team, channelId, positions, description, image } = data;

  if (!channelId) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Kein Kanal angegeben' }) };
  }

  const embed = {
    title: `Aufstellung (3-5-2)${team ? ' — ' + team : ''}`,
    description: description || undefined,
    color: 0x000000,
    fields: [
      { name: '🔺 Sturm', value: fmtLine(positions, ['LS', 'RS']) },
      { name: '↔️ Flügel', value: fmtLine(positions, ['LM', 'RM']) },
      {
        name: '🔸 Mittelfeld',
        value: `**ZDM:** ${positions.ZDM || '—'}   **ZOM:** ${positions.ZOM || '—'}   **ZDM:** ${positions.ZDM2 || '—'}`,
      },
      { name: '🔹 Abwehr', value: fmtLine(positions, ['LIV', 'ZIV', 'RIV']) },
      { name: '🥅 Tor', value: fmtLine(positions, ['TW']) },
    ],
    footer: { text: 'Erstellt über die Mitgliederübersicht-Webseite' },
  };

  let res;

  if (image && image.startsWith('data:image/png;base64,')) {
    const base64Data = image.split(',')[1];
    const buffer = Buffer.from(base64Data, 'base64');

    embed.image = { url: 'attachment://aufstellung.png' };

    const form = new FormData();
    form.append('payload_json', JSON.stringify({ embeds: [embed] }));
    form.append('files[0]', new Blob([buffer], { type: 'image/png' }), 'aufstellung.png');

    res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` },
      body: form,
    });
  } else {
    res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ embeds: [embed] }),
    });
  }

  if (!res.ok) {
    const errText = await res.text();
    return { statusCode: 502, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Discord-Fehler: ' + errText }) };
  }

  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
};
