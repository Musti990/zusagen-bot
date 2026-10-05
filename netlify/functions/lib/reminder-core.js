// Automatische Erinnerung: 2 Stunden vor dem Event-Termin bekommen alle mit Rolle
// "1 Mannschaft" oder "2 Mannschaft", die noch nicht abgestimmt haben, eine DM.
// Wer keine DMs annimmt, wird einmal per @-Erwähnung im Event-Kanal erinnert.
// Läuft als Teil der 2-Minuten-Prüfung (session-check).

const { blobStore } = require('./clubs');

const REMINDER_LEAD_MS = 2 * 60 * 60 * 1000; // 2 Stunden vor Termin
const KADER_ROLE_NAMES = ['1mannschaft', '2mannschaft']; // bereits normalisiert (norm entfernt Leerzeichen)
const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9äöüß]/g, '');

function eventStore() {
  return blobStore('rsvp-events');
}

function api(path, opts = {}) {
  return fetch(`https://discord.com/api/v10${path}`, {
    ...opts,
    headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}`, ...(opts.headers || {}) },
  });
}

// DM an einen Nutzer schicken; gibt true/false zurück (false z. B. wenn DMs zu sind)
async function sendDM(userId, content) {
  try {
    const dmRes = await api('/users/@me/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_id: userId }),
    });
    if (!dmRes.ok) return false;
    const channel = await dmRes.json();
    const msg = await api(`/channels/${channel.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    return msg.ok;
  } catch {
    return false;
  }
}

function formatWhen(ts) {
  return `<t:${ts}:F>`; // Discord zeigt das in der lokalen Zeit des Lesers
}

// Verschickt die Erinnerung für EIN Event an alle Kader-Mitglieder ohne Stimme.
// markAsSent=true setzt reminderSent (für die Automatik); beim Button bleibt es false,
// damit die automatische 2h-Erinnerung später trotzdem noch kommt.
async function remindEvent(guildId, ev, { markAsSent = false } = {}) {
  const rolesRes = await api(`/guilds/${guildId}/roles`);
  const roles = rolesRes.ok ? await rolesRes.json() : [];
  const kaderRoleIds = roles.filter((r) => KADER_ROLE_NAMES.includes(norm(r.name))).map((r) => r.id);
  if (kaderRoleIds.length === 0) return { error: 'Es gibt keine Rollen „1 Mannschaft“ oder „2 Mannschaft“.' };

  const memRes = await api(`/guilds/${guildId}/members?limit=1000`);
  const members = memRes.ok ? await memRes.json() : [];
  const voted = new Set([...(ev.accepted || []), ...(ev.declined || [])].map((u) => u.id));
  const targets = members.filter(
    (m) => !m.user?.bot && (m.roles || []).some((r) => kaderRoleIds.includes(r)) && !voted.has(m.user.id)
  );

  const text =
    `Hey! Du hast noch nicht für **${ev.title}** am ${formatWhen(ev.timestamp)} abgestimmt.\n` +
    `Bitte stimme im Server ab: ✅ Zusage / ❌ Absage`;

  const noDm = [];
  for (const m of targets) {
    const ok = await sendDM(m.user.id, text);
    if (!ok) noDm.push(m.user.id);
  }
  if (noDm.length && ev.channelId) {
    const mentions = noDm.map((id) => `<@${id}>`).join(' ');
    await api(`/channels/${ev.channelId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `⏰ Erinnerung für **${ev.title}**: ${mentions} – bitte noch abstimmen (✅/❌).`,
        allowed_mentions: { users: noDm },
      }),
    });
  }
  if (markAsSent) ev.reminderSent = true;
  return { total: targets.length, noDm: noDm.length };
}

// Prüft alle offenen Events und verschickt fällige Erinnerungen. Gibt eine kurze Protokoll-Liste zurück.
async function processEventReminders(guildId) {
  const store = eventStore();
  const results = [];
  const now = Date.now();

  let listing;
  try {
    listing = await store.list();
  } catch {
    return results; // Store noch leer
  }
  const keys = (listing.blobs || []).map((b) => b.key);
  if (keys.length === 0) return results;

  // Kader-Rollen-IDs und Mitglieder nur einmal laden, falls überhaupt eine Erinnerung ansteht
  let rolesLoaded = false;
  let kaderRoleIds = [];
  let members = [];
  const loadGuild = async () => {
    if (rolesLoaded) return;
    rolesLoaded = true;
    const rolesRes = await api(`/guilds/${guildId}/roles`);
    if (rolesRes.ok) {
      const roles = await rolesRes.json();
      kaderRoleIds = roles.filter((r) => KADER_ROLE_NAMES.includes(norm(r.name))).map((r) => r.id);
    }
    const memRes = await api(`/guilds/${guildId}/members?limit=1000`);
    if (memRes.ok) members = await memRes.json();
  };

  for (const key of keys) {
    const ev = await store.get(key, { type: 'json' });
    if (!ev || ev.reminderSent) continue;
    const eventMs = Number(ev.timestamp) * 1000;
    if (!eventMs) continue;

    // Fällig, wenn wir im Fenster [Termin-2h, Termin] sind. Termin vorbei -> nur als erledigt markieren.
    if (now >= eventMs) {
      ev.reminderSent = true;
      await store.setJSON(key, ev);
      continue;
    }
    if (now < eventMs - REMINDER_LEAD_MS) continue; // noch zu früh

    await loadGuild();
    if (kaderRoleIds.length === 0) {
      results.push({ event: ev.title, status: 'keine Kader-Rollen gefunden' });
      ev.reminderSent = true; // nicht in Dauerschleife weiterversuchen
      await store.setJSON(key, ev);
      continue;
    }

    const r = await remindEvent(guildId, ev, { markAsSent: true });
    await store.setJSON(key, ev);
    results.push({ event: ev.title, erinnert: r.total || 0, keineDM: r.noDm || 0 });
  }

  return results;
}

module.exports = { processEventReminders, remindEvent };
