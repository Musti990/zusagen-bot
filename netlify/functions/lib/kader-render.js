// Kader-Bild rendern und die Kader-Nachricht in Discord aktualisieren (nutzt sharp).
// Wird von kader-worker.js (sofort) und session-check.js (Absicherung alle 2 Min.) verwendet.

const { setupFonts } = require('./fonts');
setupFonts();
const sharp = require('sharp');
const { buildKaderSvg } = require('./matchreport-svg');
const { KADER_TEAMS, kaderStore, api, getKaderPlayers, buildKaderEmbed, kaderComponents } = require('./kader-core');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function buildKaderMessage(guildId, team) {
  const { role, players } = await getKaderPlayers(guildId, team);
  const imageName = `kader-team${team}.png`;
  const svg = buildKaderSvg({
    teamName: KADER_TEAMS[team].label,
    players: players.map((p) => ({ number: p.number, name: p.name, group: p.group })),
  });
  const png = await sharp(Buffer.from(svg)).png().toBuffer();

  const form = new FormData();
  form.append(
    'payload_json',
    JSON.stringify({
      embeds: [buildKaderEmbed(team, players, role?.name, imageName)],
      components: kaderComponents(team),
      attachments: [{ id: 0, filename: imageName }],
    })
  );
  form.append('files[0]', new Blob([png], { type: 'image/png' }), imageName);
  return form;
}

// Erste Antwort auf /kader um das Bild ergänzen und die Nachricht für spätere Updates merken
async function finishKaderPost({ team, guildId, appId, token }) {
  const store = kaderStore();
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(1500); // die Antwort auf /kader muss erst bei Discord angekommen sein
    const res = await api(`/webhooks/${appId}/${token}/messages/@original`, {
      method: 'PATCH',
      body: await buildKaderMessage(guildId, team),
    });
    if (res.ok) {
      const msg = await res.json();
      await store.setJSON(`message-${team}`, { channelId: msg.channel_id, messageId: msg.id });
      await store.delete(`pending-${team}`);
      await store.delete(`dirty-${team}`);
      return true;
    }
    if (res.status !== 404) throw new Error(`Kader-Post fehlgeschlagen: ${res.status} ${await res.text()}`);
  }
  return false;
}

// Bestehende Kader-Nachricht mit neuem Bild + Liste überschreiben
async function refreshKader({ team, guildId }) {
  const store = kaderStore();
  const ref = await store.get(`message-${team}`, { type: 'json' });
  if (!ref) {
    await store.delete(`dirty-${team}`);
    return false; // noch kein /kader gepostet
  }
  const res = await api(`/channels/${ref.channelId}/messages/${ref.messageId}`, {
    method: 'PATCH',
    body: await buildKaderMessage(guildId, team),
  });
  if (res.status === 404) await store.delete(`message-${team}`); // Nachricht wurde gelöscht
  else if (!res.ok) throw new Error(`Kader-Update fehlgeschlagen: ${res.status} ${await res.text()}`);
  await store.delete(`dirty-${team}`);
  return true;
}

// Absicherung: offene Posts/Updates erledigen, falls der Worker nicht durchgelaufen ist
async function processPendingKader(guildId) {
  const store = kaderStore();
  const done = [];
  for (const team of Object.keys(KADER_TEAMS)) {
    const pending = await store.get(`pending-${team}`, { type: 'json' });
    if (pending) {
      if (Date.now() - pending.createdAt < 14 * 60 * 1000) await finishKaderPost(pending);
      else await store.delete(`pending-${team}`); // Discord-Token nach 15 Min. abgelaufen
      done.push(`post-${team}`);
    } else if (await store.get(`dirty-${team}`, { type: 'text' })) {
      await refreshKader({ team, guildId });
      done.push(`refresh-${team}`);
    }
  }
  return done;
}

module.exports = { finishKaderPost, refreshKader, processPendingKader };
