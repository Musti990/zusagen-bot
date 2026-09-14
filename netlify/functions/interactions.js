const nacl = require('tweetnacl');
const { getStore } = require('@netlify/blobs');

// ---------- Signatur-Prüfung (Pflicht laut Discord) ----------
function verifySignature(event) {
  const signature = event.headers['x-signature-ed25519'];
  const timestamp = event.headers['x-signature-timestamp'];
  const rawBody = event.body || '';
  const publicKey = process.env.DISCORD_PUBLIC_KEY;

  if (!signature || !timestamp || !publicKey) return false;

  try {
    return nacl.sign.detached.verify(
      Buffer.from(timestamp + rawBody),
      Buffer.from(signature, 'hex'),
      Buffer.from(publicKey, 'hex')
    );
  } catch {
    return false;
  }
}

function json(statusCode, data) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  };
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
      .filter((r) => roleIds.includes(r.id) && r.name !== '@everyone')
      .sort((a, b) => b.position - a.position);
    return memberRoles.length > 0 ? memberRoles[0].name : null;
  } catch {
    return null;
  }
}

// ---------- Wer hat noch nicht abgestimmt? ----------
async function getMissingFields(guildId, respondedIds) {
  const authHeader = { Authorization: `Bot ${process.env.DISCORD_TOKEN}` };

  try {
    const rolesRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, { headers: authHeader });
    if (!rolesRes.ok) return [];
    const roles = await rolesRes.json();
    const roleById = {};
    roles.forEach((r) => (roleById[r.id] = r));

    const membersRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members?limit=1000`, {
      headers: authHeader,
    });
    if (!membersRes.ok) return [];
    const members = await membersRes.json();

    const groups = {};
    for (const m of members) {
      if (m.user?.bot) continue;
      if (respondedIds.has(m.user.id)) continue;

      const memberRoles = (m.roles || [])
        .map((id) => roleById[id])
        .filter((r) => r && r.name !== '@everyone')
        .sort((a, b) => b.position - a.position);
      const topRole = memberRoles.length > 0 ? memberRoles[0].name : 'Ohne Rolle';
      const name = m.nick || m.user?.username || 'Unbekannt';
      if (!groups[topRole]) groups[topRole] = [];
      groups[topRole].push(name);
    }

    const rolePosition = (roleName) => roles.find((r) => r.name === roleName)?.position ?? -1;
    const sortedGroupNames = Object.keys(groups).sort((a, b) => rolePosition(b) - rolePosition(a));

    return sortedGroupNames.slice(0, 20).map((roleName) => ({
      name: `❔ ${roleName} — fehlt (${groups[roleName].length})`,
      value: groups[roleName].map((n, i) => `${i + 1}. **${n}**`).join('\n') || '—',
      inline: true,
    }));
  } catch {
    return [];
  }
}

// ---------- Discord-Embed & Buttons bauen ----------
async function buildEmbed(ev) {
  const fmtList = (arr) =>
    arr.length === 0
      ? '—'
      : arr.map((u, i) => `${i + 1}. **${u.name}**${u.role ? ` — ${u.role}` : ''}`).join('\n');

  const overflow = ev.accepted.length > ev.limit ? ev.accepted.length - ev.limit : 0;
  const acceptedHeader =
    overflow > 0 ? `✅ Accepted (${ev.limit} +${overflow})` : `✅ Accepted (${ev.accepted.length})`;

  const fields = [
    { name: acceptedHeader, value: fmtList(ev.accepted), inline: true },
    { name: `❓ Maybe (${ev.maybe.length})`, value: fmtList(ev.maybe), inline: true },
    { name: `❌ Declined (${ev.declined.length})`, value: fmtList(ev.declined), inline: true },
  ];

  if (ev.guildId) {
    const respondedIds = new Set([...ev.accepted, ...ev.maybe, ...ev.declined].map((u) => u.id));
    const missingFields = await getMissingFields(ev.guildId, respondedIds);
    fields.push(...missingFields);
  }

  return {
    title: ev.title,
    color: 0x8b5cf6,
    description: [
      ev.flag ? `🚩 ${ev.flag}` : null,
      `📅 <t:${ev.timestamp}:D>  ⏰ <t:${ev.timestamp}:t>  ⏳ <t:${ev.timestamp}:R>`,
    ]
      .filter(Boolean)
      .join('\n'),
    fields,
    footer: { text: `Erstellt von ${ev.creator}` },
  };
}

function buildComponents(eventId) {
  return [
    {
      type: 1, // Action Row
      components: [
        { type: 2, style: 3, label: 'Accepted', emoji: { name: '✅' }, custom_id: `rsvp:accept:${eventId}` },
        { type: 2, style: 1, label: 'Maybe', emoji: { name: '❓' }, custom_id: `rsvp:maybe:${eventId}` },
        { type: 2, style: 4, label: 'Declined', emoji: { name: '❌' }, custom_id: `rsvp:decline:${eventId}` },
      ],
    },
  ];
}

// ---------- Slash-Command /event ----------
async function handleCreateEvent(interaction, store) {
  const opts = {};
  for (const o of interaction.data.options || []) opts[o.name] = o.value;

  const [day, month, year] = opts.datum.split('.').map(Number);
  const [hour, minute] = opts.uhrzeit.split(':').map(Number);
  const date = new Date(year, month - 1, day, hour, minute);

  if (isNaN(date.getTime())) {
    return json(200, {
      type: 4,
      data: { content: 'Datum oder Uhrzeit ungültig. Format: TT.MM.JJJJ und HH:MM', flags: 64 },
    });
  }

  const creator =
    interaction.member?.nick || interaction.member?.user?.username || interaction.user?.username || 'Unbekannt';

  const eventId = interaction.id;
  const ev = {
    title: opts.titel,
    flag: opts.info || '',
    limit: opts.limit,
    timestamp: Math.floor(date.getTime() / 1000),
    creator,
    guildId: interaction.guild_id,
    accepted: [],
    maybe: [],
    declined: [],
  };

  await store.setJSON(eventId, ev);

  return json(200, {
    type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
    data: { embeds: [await buildEmbed(ev)], components: buildComponents(eventId) },
  });
}

// ---------- Button-Klick ----------
async function handleButton(interaction, store) {
  const [prefix, action, eventId] = interaction.data.custom_id.split(':');
  if (prefix !== 'rsvp') return json(400, { error: 'unknown component' });

  const ev = await store.get(eventId, { type: 'json' });
  if (!ev) {
    return json(200, {
      type: 4,
      data: { content: 'Dieses Event ist nicht mehr verfügbar.', flags: 64 },
    });
  }

  const member = interaction.member;
  const roleName = await getTopRoleName(interaction.guild_id, member?.roles);
  const user = {
    id: member?.user?.id || interaction.user?.id,
    name: member?.nick || member?.user?.username || interaction.user?.username || 'Unbekannt',
    role: roleName,
  };

  const inAccepted = ev.accepted.some((u) => u.id === user.id);
  const inMaybe = ev.maybe.some((u) => u.id === user.id);
  const inDeclined = ev.declined.some((u) => u.id === user.id);

  ev.accepted = ev.accepted.filter((u) => u.id !== user.id);
  ev.maybe = ev.maybe.filter((u) => u.id !== user.id);
  ev.declined = ev.declined.filter((u) => u.id !== user.id);

  const wasAlreadySelected =
    (action === 'accept' && inAccepted) ||
    (action === 'maybe' && inMaybe) ||
    (action === 'decline' && inDeclined);

  if (!wasAlreadySelected) {
    const list = action === 'accept' ? ev.accepted : action === 'maybe' ? ev.maybe : ev.declined;
    list.push(user);
  }

  await store.setJSON(eventId, ev);

  return json(200, {
    type: 7, // UPDATE_MESSAGE
    data: { embeds: [await buildEmbed(ev)], components: buildComponents(eventId) },
  });
}

// ---------- Slash-Command /mitglieder ----------
async function handleMembersCommand(interaction) {
  const guildId = interaction.guild_id;
  const authHeader = { Authorization: `Bot ${process.env.DISCORD_TOKEN}` };

  const rolesRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, {
    headers: authHeader,
  });
  if (!rolesRes.ok) {
    return json(200, { type: 4, data: { content: 'Konnte Rollen nicht laden.', flags: 64 } });
  }
  const roles = await rolesRes.json();
  const roleById = {};
  roles.forEach((r) => (roleById[r.id] = r));

  const membersRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members?limit=1000`, {
    headers: authHeader,
  });
  if (!membersRes.ok) {
    return json(200, {
      type: 4,
      data: {
        content:
          'Konnte Mitgliederliste nicht laden. Stelle sicher, dass "Server Members Intent" im Developer Portal unter Bot aktiviert ist.',
        flags: 64,
      },
    });
  }
  const members = await membersRes.json();

  const groups = {};
  for (const m of members) {
    if (m.user?.bot) continue;
    const memberRoles = (m.roles || [])
      .map((id) => roleById[id])
      .filter((r) => r && r.name !== '@everyone')
      .sort((a, b) => b.position - a.position);
    const topRole = memberRoles.length > 0 ? memberRoles[0].name : 'Ohne Rolle';
    const name = m.nick || m.user?.username || 'Unbekannt';
    if (!groups[topRole]) groups[topRole] = [];
    groups[topRole].push(name);
  }

  const rolePosition = (roleName) => roles.find((r) => r.name === roleName)?.position ?? -1;
  const sortedGroupNames = Object.keys(groups).sort((a, b) => rolePosition(b) - rolePosition(a));

  const fields = sortedGroupNames.slice(0, 25).map((roleName) => ({
    name: `${roleName} (${groups[roleName].length})`,
    value: groups[roleName].map((n, i) => `${i + 1}. **${n}**`).join('\n') || '—',
    inline: true,
  }));

  return json(200, {
    type: 4,
    data: {
      embeds: [
        {
          title: 'Mitgliederübersicht',
          color: 0x8b5cf6,
          fields,
        },
      ],
    },
  });
}

// ---------- Handler ----------
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });
  if (!verifySignature(event)) return json(401, { error: 'invalid request signature' });

  const interaction = JSON.parse(event.body);

  if (interaction.type === 1) return json(200, { type: 1 }); // PING -> PONG

  const store = getStore({
    name: 'rsvp-events',
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_BLOBS_TOKEN,
  });

  if (interaction.type === 2 && interaction.data?.name === 'event') {
    return handleCreateEvent(interaction, store);
  }

  if (interaction.type === 2 && interaction.data?.name === 'mitglieder') {
    return handleMembersCommand(interaction);
  }

  if (interaction.type === 3) {
    return handleButton(interaction, store);
  }

  return json(400, { error: 'unhandled interaction type' });
};
