// Gemeinsam genutzte Event-/Embed-Logik für den Slash-Command /event UND für
// das Erstellen von Events über die Website (post-event.js). Beide greifen auf
// exakt dieselben Funktionen zu, damit ein per Website erstelltes Event genauso
// aussieht und funktioniert wie eines per /event.

// Rollen, die in Bot-Anzeigen nie als "Top-Rolle" berücksichtigt werden sollen
const EXCLUDED_ROLES = ['Head VM', 'Owner', 'Admin', 'ZDM', 'ZIV', 'LIV', 'RIV', 'LM', 'RM', 'ZOM', 'ST', 'TW', '@everyone'];

// Wer eine dieser Rollen hat, wird in der "Wer fehlt"-Liste komplett übersprungen (kann aber weiterhin abstimmen)
const FULLY_HIDDEN_FROM_MISSING = ['Head VM', 'Owner', 'Admin'];

// Wandelt Jahr/Monat/Tag/Stunde/Minute, gedacht als deutsche Ortszeit (Europe/Berlin,
// inkl. automatischer Sommer-/Winterzeit-Erkennung), in einen korrekten UTC-Unix-Timestamp um.
function berlinToUtcTimestamp(year, month, day, hour, minute) {
  const guessUtcMs = Date.UTC(year, month - 1, day, hour, minute);

  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = fmt.formatToParts(new Date(guessUtcMs));
  const map = {};
  parts.forEach((p) => {
    if (p.type !== 'literal') map[p.type] = p.value;
  });
  const hourNum = Number(map.hour) === 24 ? 0 : Number(map.hour);
  const berlinGuessMs = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), hourNum, Number(map.minute));

  const correctedUtcMs = 2 * guessUtcMs - berlinGuessMs;
  return Math.floor(correctedUtcMs / 1000);
}

// ---------- Höchste Rolle einer Person ermitteln ----------
async function getTopRoleName(guildId, roleIds) {
  if (!guildId || !roleIds || roleIds.length === 0) return null;
  try {
    const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, {
      headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` },
    });
    if (!res.ok) return null;
    const roles = await res.json();
    const memberRoles = roles
      .filter((r) => roleIds.includes(r.id) && !EXCLUDED_ROLES.includes(r.name))
      .sort((a, b) => b.position - a.position);
    return memberRoles.length > 0 ? memberRoles[0].name : null;
  } catch {
    return null;
  }
}

// Verhindert, dass Sonderzeichen in Namen (z.B. Unterstriche) von Discord als Formatierung interpretiert werden
function escapeMd(s) {
  return String(s).replace(/([_*~`|])/g, '\\$1');
}

// ---------- Wer hat noch nicht abgestimmt? (EIN kompaktes Feld statt vieler) ----------
async function getMissingField(guildId, respondedIds, allowedRoleNames) {
  const authHeader = { Authorization: `Bot ${process.env.DISCORD_TOKEN}` };

  try {
    const rolesRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, { headers: authHeader });
    if (!rolesRes.ok) return null;
    const roles = await rolesRes.json();
    const roleById = {};
    roles.forEach((r) => (roleById[r.id] = r));

    const membersRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members?limit=1000`, {
      headers: authHeader,
    });
    if (!membersRes.ok) return null;
    const members = await membersRes.json();

    const groups = {};
    let total = 0;
    for (const m of members) {
      if (m.user?.bot) continue;
      if (respondedIds.has(m.user.id)) continue;

      const memberRoleNames = (m.roles || []).map((id) => roleById[id]?.name).filter(Boolean);
      if (allowedRoleNames && !memberRoleNames.some((n) => allowedRoleNames.includes(n))) continue;
      if (memberRoleNames.some((n) => FULLY_HIDDEN_FROM_MISSING.includes(n))) continue;

      const memberRoles = (m.roles || [])
        .map((id) => roleById[id])
        .filter((r) => r && !EXCLUDED_ROLES.includes(r.name))
        .sort((a, b) => b.position - a.position);
      const topRole = memberRoles.length > 0 ? memberRoles[0].name : 'Ohne Rolle';
      const rawNick = m.nick || m.user?.username || 'Unbekannt';
      const name = escapeMd(rawNick.split('|')[0].trim());
      if (!groups[topRole]) groups[topRole] = [];
      groups[topRole].push(name);
      total++;
    }

    if (total === 0) return { name: '❔ Wer fehlt?', value: 'Alle haben abgestimmt! 🎉', inline: false };

    const rolePosition = (roleName) => roles.find((r) => r.name === roleName)?.position ?? -1;
    const sortedGroupNames = Object.keys(groups).sort((a, b) => rolePosition(b) - rolePosition(a));

    let value = sortedGroupNames
      .map((roleName) => `**${roleName}:** ${groups[roleName].join(', ')}`)
      .join('\n');
    if (value.length > 1000) value = value.slice(0, 1000) + '…';

    return { name: `❔ Noch nicht abgestimmt (${total})`, value, inline: false };
  } catch {
    return null;
  }
}

// ---------- Discord-Embed bauen (im "Scheduled Session"-Stil) ----------
async function buildEmbed(ev) {
  const fmtMentions = (arr) =>
    arr.length === 0
      ? 'None'
      : arr.map((u) => `<@${u.id}>${u.role ? ` (${escapeMd(u.role)})` : ''}`).join('\n');

  const overflow = ev.accepted.length > ev.limit ? ev.accepted.length - ev.limit : 0;
  const acceptedHeader =
    overflow > 0 ? `✅ Can Play (${ev.limit} +${overflow})` : `✅ Can Play (${ev.accepted.length})`;

  const fields = [
    { name: 'Time & Date', value: `<t:${ev.timestamp}:F>  (<t:${ev.timestamp}:R>)` },
  ];

  if (ev.team) fields.push({ name: 'Team', value: escapeMd(ev.team) });
  if (ev.flag) fields.push({ name: 'Info', value: escapeMd(ev.flag) });

  fields.push({ name: 'Notes', value: '```\n' + (ev.beschreibung ? escapeMd(ev.beschreibung) : 'No notes added.') + '\n```' });

  fields.push({ name: acceptedHeader, value: fmtMentions(ev.accepted) });
  fields.push({ name: `❌ Cannot Play (${ev.declined.length})`, value: fmtMentions(ev.declined) });
  fields.push({ name: `❓ Tentative (${ev.maybe.length})`, value: fmtMentions(ev.maybe) });

  if (ev.guildId) {
    const respondedIds = new Set([...ev.accepted, ...ev.maybe, ...ev.declined].map((u) => u.id));
    const allowedRoleNames =
      ev.team === '2 Mannschaft' ? ['2 Mannschaft', 'Tester'] : ev.team === '1 Mannschaft' ? ['1 Mannschaft'] : null;
    const missingField = await getMissingField(ev.guildId, respondedIds, allowedRoleNames);
    if (missingField) fields.push(missingField);
  }

  const description = ev.creatorId
    ? `<@${ev.creatorId}> has scheduled a Clubs session. Use the buttons below to show your availability.`
    : `**${escapeMd(ev.creator)}** has scheduled a Clubs session. Use the buttons below to show your availability.`;

  return {
    title: `${ev.title} Scheduled Session`,
    description,
    color: 0x000000,
    thumbnail: ev.imageUrl ? { url: ev.imageUrl } : undefined,
    fields,
    footer: { text: `Erstellt von ${ev.creator}` },
  };
}

function buildComponents(eventId) {
  // Drei separate Reihen mit je einem Button, damit sie wie beim Original einzeln
  // untereinander erscheinen statt nebeneinander in einer Reihe.
  return [
    { type: 1, components: [{ type: 2, style: 3, emoji: { name: '✅' }, custom_id: `rsvp:accept:${eventId}` }] },
    { type: 1, components: [{ type: 2, style: 4, emoji: { name: '❌' }, custom_id: `rsvp:decline:${eventId}` }] },
    { type: 1, components: [{ type: 2, style: 2, emoji: { name: '❓' }, custom_id: `rsvp:maybe:${eventId}` }] },
  ];
}

module.exports = {
  EXCLUDED_ROLES,
  FULLY_HIDDEN_FROM_MISSING,
  berlinToUtcTimestamp,
  getTopRoleName,
  getMissingField,
  buildEmbed,
  buildComponents,
};
