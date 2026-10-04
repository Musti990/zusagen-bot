// Aufstellungs-Bild rendern und die ephemere Aufstellungs-Nachricht aktualisieren (nutzt sharp).

const { setupFonts } = require('./fonts');
setupFonts();
const sharp = require('sharp');
const { buildLineupSvg } = require('./matchreport-svg');
const { lineupStore, getLineup, lineupEmbed, lineupComponents, KADER_TEAMS } = require('./lineup-core');
const { findKaderRole, getGuildRoles } = require('./kader-core');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function buildLineupMessage(lineup) {
  const imageName = `aufstellung-team${lineup.team}.png`;
  const svg = buildLineupSvg({
    teamName: KADER_TEAMS[lineup.team].label,
    title: lineup.title,
    formation: lineup.formation,
    players: lineup.players,
  });
  const png = await sharp(Buffer.from(svg)).png().toBuffer();

  let roleName;
  try {
    roleName = findKaderRole(await getGuildRoles(lineup.guildId), lineup.team)?.name;
  } catch {
    roleName = undefined;
  }

  const form = new FormData();
  form.append(
    'payload_json',
    JSON.stringify({
      embeds: [lineupEmbed(lineup, roleName, imageName)],
      components: lineupComponents(lineup),
      attachments: [{ id: 0, filename: imageName }],
    })
  );
  form.append('files[0]', new Blob([png], { type: 'image/png' }), imageName);
  return form;
}

function webhook(appId, token, path = '') {
  return `https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original${path}`;
}

// Die (ephemere) /aufstellung-Antwort um das Bild ergänzen
async function finishLineupPost({ key, appId, token }) {
  const store = lineupStore();
  const lineup = await getLineup(store, key);
  if (!lineup) return false;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(1500);
    const res = await fetch(webhook(appId, token), { method: 'PATCH', body: await buildLineupMessage(lineup) });
    if (res.ok) {
      await store.setJSON(`token-${key}`, { appId, token });
      await store.delete(`pending-${key}`);
      await store.delete(`dirty-${key}`);
      return true;
    }
    if (res.status !== 404) throw new Error(`Aufstellung-Post fehlgeschlagen: ${res.status} ${await res.text()}`);
  }
  return false;
}

// Bestehende Aufstellungs-Nachricht neu rendern (über den gemerkten Interaktions-Token)
async function refreshLineup({ key }) {
  const store = lineupStore();
  const lineup = await getLineup(store, key);
  const tok = await store.get(`token-${key}`, { type: 'json' });
  await store.delete(`dirty-${key}`);
  if (!lineup || !tok) return false;
  const res = await fetch(webhook(tok.appId, tok.token), { method: 'PATCH', body: await buildLineupMessage(lineup) });
  if (!res.ok && res.status !== 404) throw new Error(`Aufstellung-Update fehlgeschlagen: ${res.status} ${await res.text()}`);
  return true;
}

async function processPendingLineups() {
  const store = lineupStore();
  const done = [];
  const { blobs } = await store.list({ prefix: 'pending-' }).catch(() => ({ blobs: [] }));
  for (const b of blobs || []) {
    const pending = await store.get(b.key, { type: 'json' });
    if (pending && Date.now() - pending.createdAt < 14 * 60 * 1000) {
      await finishLineupPost(pending);
      done.push(b.key);
    } else {
      await store.delete(b.key);
    }
  }
  const { blobs: dirty } = await store.list({ prefix: 'dirty-' }).catch(() => ({ blobs: [] }));
  for (const b of dirty || []) {
    await refreshLineup({ key: b.key.replace('dirty-', '') });
    done.push(b.key);
  }
  return done;
}

module.exports = { finishLineupPost, refreshLineup, processPendingLineups };
