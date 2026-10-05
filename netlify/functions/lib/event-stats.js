// Zwei Dinge:
// 1) processEventMaintenance: schließt Events 1,5 h nach dem Treffpunkt — löscht die Abstimmungs-
//    Nachricht und hält fest, wer (aus der Event-Mannschaft) nicht abgestimmt hat. Räumt alte Events weg.
// 2) buildActivity: wertet die letzten 20 Tage aus — wer wie oft nicht abgestimmt hat (nur Admin, per Befehl).
// Läuft im 2-Minuten-Takt über session-check.

const { blobStore } = require('./clubs');
const { targetRoleIds, loadMembers, missingVoters, api, norm } = require('./reminder-core');

const CLOSE_AFTER_MS = 90 * 60 * 1000;      // 1,5 h nach dem Treffpunkt wird die Abstimmung gelöscht
const KEEP_DAYS = 25;                         // Events so lange für die Statistik behalten (etwas mehr als 20)
const ACTIVITY_DAYS = 20;                     // Auswertungsfenster
const TEAM_ROLE = { '1': '1 Mannschaft', '2': '2 Mannschaft' };

function eventStore() {
  return blobStore('rsvp-events');
}

// Nach 1,5 h: Nachricht löschen, Nicht-Abstimmer festhalten, Event als geschlossen markieren.
// Dazu alte Events (> KEEP_DAYS) entfernen, damit der Speicher nicht unbegrenzt wächst.
async function processEventMaintenance(guildId) {
  const store = eventStore();
  const results = [];
  const now = Date.now();

  let listing;
  try {
    listing = await store.list();
  } catch {
    return results;
  }
  for (const b of listing.blobs || []) {
    const ev = await store.get(b.key, { type: 'json' });
    if (!ev) continue;
    const eventMs = Number(ev.timestamp) * 1000;
    if (!eventMs) continue;

    // Ganz alte Events wegräumen
    if (now > eventMs + KEEP_DAYS * 24 * 60 * 60 * 1000) {
      await store.delete(b.key);
      results.push({ event: ev.title, status: 'archiviert/gelöscht' });
      continue;
    }

    // Fällig zum Schließen?
    if (ev.closed || now < eventMs + CLOSE_AFTER_MS) continue;

    // Nicht-Abstimmer der Event-Mannschaft festhalten (für die Aktivitäts-Statistik)
    try {
      const roleIds = await targetRoleIds(guildId, ev);
      const members = roleIds.length ? await loadMembers(guildId) : [];
      ev.missers = roleIds.length ? missingVoters(members, roleIds, ev).map((m) => m.user.id) : [];
      ev.eligibleCount = roleIds.length
        ? members.filter((m) => !m.user?.bot && (m.roles || []).some((r) => roleIds.includes(r))).length
        : 0;
    } catch {
      ev.missers = ev.missers || [];
    }

    // Abstimmungs-Nachricht löschen
    if (ev.channelId && ev.messageId) {
      try {
        await api(`/channels/${ev.channelId}/messages/${ev.messageId}`, { method: 'DELETE' });
      } catch {
        // schon weg o. Ä. – nicht schlimm
      }
    }
    ev.closed = true;
    await store.setJSON(b.key, ev);
    results.push({ event: ev.title, status: 'geschlossen', fehlend: (ev.missers || []).length });
  }
  return results;
}

// Aktivitäts-Auswertung der letzten 20 Tage für eine Mannschaft.
async function buildActivity(guildId, team) {
  const store = eventStore();
  const roleName = TEAM_ROLE[team];
  const wanted = norm(roleName);
  const since = Date.now() - ACTIVITY_DAYS * 24 * 60 * 60 * 1000;

  let listing;
  try {
    listing = await store.list();
  } catch {
    return { error: 'Keine Events gefunden.' };
  }

  // Relevante, bereits geschlossene Events im Zeitfenster: die der Mannschaft + mannschaftsneutrale
  const events = [];
  for (const b of listing.blobs || []) {
    const ev = await store.get(b.key, { type: 'json' });
    if (!ev || !ev.closed) continue;
    const eventMs = Number(ev.timestamp) * 1000;
    if (!eventMs || eventMs < since) continue;
    if (ev.team && norm(ev.team) !== wanted) continue; // andere Mannschaft
    events.push(ev);
  }
  if (events.length === 0) return { empty: true, days: ACTIVITY_DAYS };

  // Aktuelle Kader-Mitglieder der Mannschaft
  const rolesRes = await api(`/guilds/${guildId}/roles`);
  const roles = rolesRes.ok ? await rolesRes.json() : [];
  const roleId = roles.find((r) => norm(r.name) === wanted)?.id;
  if (!roleId) return { error: `Die Rolle „${roleName}“ gibt es nicht.` };
  const members = await loadMembers(guildId);
  const squad = members.filter((m) => !m.user?.bot && (m.roles || []).includes(roleId));

  const rows = squad
    .map((m) => {
      const name = (m.nick || m.user?.global_name || m.user?.username || 'Unbekannt').split('|')[0].trim();
      const missed = events.filter((ev) => (ev.missers || []).includes(m.user.id)).length;
      return { name, missed, total: events.length };
    })
    .sort((a, b) => b.missed - a.missed || a.name.localeCompare(b.name));

  return { roleName, days: ACTIVITY_DAYS, total: events.length, rows };
}

module.exports = { processEventMaintenance, buildActivity };
