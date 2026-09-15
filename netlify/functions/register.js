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
    color: 0x000000,
    description: [
      ev.flag ? `🚩 ${ev.flag}` : null,
      ev.beschreibung ? ev.beschreibung : null,
      `📅 <t:${ev.timestamp}:D>  ⏰ <t:${ev.timestamp}:t>  ⏳ <t:${ev.timestamp}:R>`,
    ]
      .filter(Boolean)
      .join('\n'),
    fields,
    image: ev.imageUrl ? { url: ev.imageUrl } : undefined,
    footer: { text: `Erstellt von ${ev.creator}` },
  };
}

function buildComponents(eventId) {
  return [
    {
      type: 1, // Action Row
      components: [
        { type: 2, style: 2, emoji: { name: '✅' }, custom_id: `rsvp:accept:${eventId}` },
        { type: 2, style: 2, emoji: { name: '❓' }, custom_id: `rsvp:maybe:${eventId}` },
        { type: 2, style: 2, emoji: { name: '❌' }, custom_id: `rsvp:decline:${eventId}` },
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

  const imageUrl = opts.bild ? interaction.data.resolved?.attachments?.[opts.bild]?.url || null : null;

  const eventId = interaction.id;
  const ev = {
    title: opts.titel,
    flag: opts.info || '',
    beschreibung: opts.beschreibung || '',
    limit: opts.limit,
    timestamp: Math.floor(date.getTime() / 1000),
    creator,
    guildId: interaction.guild_id,
    imageUrl,
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
          color: 0x000000,
          fields,
        },
      ],
    },
  });
}

// ---------- Positions-Auswahl im Nickname (/position hp / /position np) ----------
const POSITIONS = ['ZDM', 'ZIV', 'LIV', 'RIV', 'LM', 'RM', 'ZOM', 'ST', 'TW'];

function buildPositionButtons(prefix) {
  const rows = [];
  for (let i = 0; i < POSITIONS.length; i += 5) {
    const chunk = POSITIONS.slice(i, i + 5);
    rows.push({
      type: 1,
      components: chunk.map((p) => ({ type: 2, style: 1, label: p, custom_id: `posnick:${prefix}:${p}` })),
    });
  }
  return rows;
}

async function handlePositionCommand(interaction) {
  const sub = interaction.data.options?.[0]?.name; // 'hp' oder 'np'
  const prefix = sub === 'np' ? 'NP' : 'HP';
  const label = sub === 'np' ? 'Nebenposition' : 'Hauptposition';

  return json(200, {
    type: 4,
    data: {
      content: `Wähle deine ${label}:`,
      flags: 64,
      components: buildPositionButtons(prefix),
    },
  });
}

async function handlePositionNickButton(interaction) {
  const [, prefix, position] = interaction.data.custom_id.split(':'); // posnick:HP:ZDM
  const guildId = interaction.guild_id;
  const userId = interaction.member?.user?.id;
  const authHeader = { Authorization: `Bot ${process.env.DISCORD_TOKEN}`, 'Content-Type': 'application/json' };

  const currentNick = interaction.member?.nick || interaction.member?.user?.username || 'Unbekannt';
  const baseName = currentNick.split('|')[0].trim();

  const tags = {};
  const tagRegex = /(HP|NP):\s*([A-ZÄÖÜ]+)/g;
  let match;
  while ((match = tagRegex.exec(currentNick)) !== null) {
    tags[match[1]] = match[2];
  }
  tags[prefix] = position;

  const parts = [baseName];
  if (tags.HP) parts.push(`HP:${tags.HP}`);
  if (tags.NP) parts.push(`NP: ${tags.NP}`);
  let newNick = parts.join(' | ');
  if (newNick.length > 32) newNick = newNick.slice(0, 32);

  const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`, {
    method: 'PATCH',
    headers: authHeader,
    body: JSON.stringify({ nick: newNick }),
  });

  if (!res.ok) {
    return json(200, {
      type: 4,
      data: {
        content: `Konnte Nickname nicht ändern. Prüfe, ob der Bot "Nicknamen verwalten" darf und über dir in der Rollen-Reihenfolge steht. Server-Owner können per Bot generell nicht umbenannt werden (Discord-Beschränkung).`,
        flags: 64,
      },
    });
  }

  return json(200, {
    type: 4,
    data: { content: `✅ Nickname aktualisiert: **${newNick}**`, flags: 64 },
  });
}

// ---------- Rollen-Auswahl (/rolle) ----------
const GENERAL_ROLES = ['Tester', 'Aushilfe'];

function buildRoleComponents() {
  const rows = [];
  for (let i = 0; i < GENERAL_ROLES.length; i += 5) {
    const chunk = GENERAL_ROLES.slice(i, i + 5);
    rows.push({
      type: 1,
      components: chunk.map((p) => ({ type: 2, style: 2, label: p, custom_id: `genrole:${p}` })),
    });
  }
  return rows;
}

async function handleRoleCommand() {
  return json(200, {
    type: 4,
    data: {
      embeds: [
        {
          title: 'Rollenwahl',
          description: 'Klick auf eine Rolle, um sie zu erhalten. Nochmal klicken entfernt sie wieder.',
          color: 0x000000,
        },
      ],
      components: buildRoleComponents(),
    },
  });
}

async function handleRoleButton(interaction) {
  const roleName = interaction.data.custom_id.split(':')[1];
  const guildId = interaction.guild_id;
  const userId = interaction.member?.user?.id;
  const authHeader = { Authorization: `Bot ${process.env.DISCORD_TOKEN}` };

  const rolesRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, { headers: authHeader });
  if (!rolesRes.ok) {
    return json(200, { type: 4, data: { content: 'Konnte Rollen nicht laden.', flags: 64 } });
  }
  const roles = await rolesRes.json();
  const role = roles.find((r) => r.name === roleName);

  if (!role) {
    return json(200, {
      type: 4,
      data: {
        content: `Es gibt noch keine Rolle namens "${roleName}" auf diesem Server. Bitte zuerst eine Rolle mit exakt diesem Namen anlegen.`,
        flags: 64,
      },
    });
  }

  const hasRole = (interaction.member?.roles || []).includes(role.id);
  const method = hasRole ? 'DELETE' : 'PUT';

  const res = await fetch(
    `https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${role.id}`,
    { method, headers: authHeader }
  );

  if (!res.ok) {
    return json(200, {
      type: 4,
      data: {
        content: `Konnte Rolle nicht ${hasRole ? 'entfernen' : 'vergeben'}. Prüfe, ob die Bot-Rolle über "${roleName}" in der Rollen-Reihenfolge steht und der Bot "Rollen verwalten" darf.`,
        flags: 64,
      },
    });
  }

  return json(200, {
    type: 4,
    data: {
      content: hasRole ? `❌ Rolle **${roleName}** entfernt.` : `✅ Rolle **${roleName}** zugewiesen.`,
      flags: 64,
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

  if (interaction.type === 2 && interaction.data?.name === 'position') {
    return handlePositionCommand(interaction);
  }

  if (interaction.type === 2 && interaction.data?.name === 'rolle') {
    return handleRoleCommand();
  }

  if (interaction.type === 3) {
    if (interaction.data.custom_id.startsWith('posnick:')) {
      return handlePositionNickButton(interaction);
    }
    if (interaction.data.custom_id.startsWith('genrole:')) {
      return handleRoleButton(interaction);
    }
    return handleButton(interaction, store);
  }

  return json(400, { error: 'unhandled interaction type' });
};
