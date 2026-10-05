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
      ? 'Niemand'
      : arr
          .map((u) => {
            const roleStr = u.role ? ` (${escapeMd(u.role)})` : '';
            const timeStr = u.votedAt ? ` — <t:${Math.floor(u.votedAt / 1000)}:R>` : '';
            // Namen als Text statt <@ID>-Erwähnung: Discord zeigt Erwähnungen in Embeds nur dann als
            // Namen an, wenn der Nutzer im eigenen Client gerade geladen ist – sonst erscheint die rohe ID.
            // voller Nickname inkl. Positionen (z. B. "luca | HP:TW"), ältere Einträge ohne vollen Nick: Basisname
            const name = u.displayName || u.name;
            return `${name ? `**${escapeMd(name)}**` : `<@${u.id}>`}${roleStr}${timeStr}`;
          })
          .join('\n');

  const overflow = ev.accepted.length > ev.limit ? ev.accepted.length - ev.limit : 0;
  const acceptedHeader =
    overflow > 0 ? `✅ Kann spielen (${ev.limit} +${overflow})` : `✅ Kann spielen (${ev.accepted.length})`;

  const fields = [
    { name: '🗓️ Datum & Uhrzeit', value: `<t:${ev.timestamp}:F>  (<t:${ev.timestamp}:R>)` },
  ];

  if (ev.team) fields.push({ name: 'Mannschaft', value: escapeMd(ev.team) });
  if (ev.flag) fields.push({ name: 'ℹ️ Info', value: escapeMd(ev.flag) });

  if (ev.beschreibung) fields.push({ name: '📝 Beschreibung', value: '```\n' + escapeMd(ev.beschreibung) + '\n```' });

  fields.push({ name: acceptedHeader, value: fmtMentions(ev.accepted) });
  fields.push({ name: `❌ Kann nicht (${ev.declined.length})`, value: fmtMentions(ev.declined) });

  const description = ev.creatorId
    ? `<@${ev.creatorId}> hat eine Session angesetzt. Bitte gib unten deine Rückmeldung ab.`
    : `**${escapeMd(ev.creator)}** hat eine Session angesetzt. Bitte gib unten deine Rückmeldung ab.`;

  return {
    title: `${ev.title} · Session`,
    description,
    color: 0x000000,
    thumbnail: ev.imageUrl ? { url: ev.imageUrl } : undefined,
    fields,
    footer: { text: `Erstellt von ${ev.creator}` },
  };
}

function buildComponents(eventId) {
  // Discord zeigt Buttons immer unterhalb der Nachricht, nie seitlich neben Text —
  // daher eine kompakte Reihe statt mehrerer einzelner Zeilen.
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 3, label: 'Ja', custom_id: `rsvp:accept:${eventId}` },
        { type: 2, style: 4, label: 'Nein', custom_id: `rsvp:decline:${eventId}` },
        { type: 2, style: 2, label: 'Erinnerung senden', emoji: { name: '⏰' }, custom_id: `rsvp:remind:${eventId}` },
        { type: 2, style: 2, label: 'Wer fehlt noch?', emoji: { name: '❔' }, custom_id: `rsvp:missing:${eventId}` },
      ],
    },
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
