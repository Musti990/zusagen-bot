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

// ---------- Discord-Embed & Buttons bauen ----------
function buildEmbed(ev) {
  const fmtList = (arr) =>
    arr.length === 0
      ? '—'
      : arr.map((u, i) => `${i + 1}. **${u.name}**${u.role ? ` — ${u.role}` : ''}`).join('\n');

  const overflow = ev.accepted.length > ev.limit ? ev.accepted.length - ev.limit : 0;
  const acceptedHeader =
    overflow > 0 ? `✅ Accepted (${ev.limit} +${overflow})` : `✅ Accepted (${ev.accepted.length})`;

  return {
    title: ev.title,
    color: 0x8b5cf6,
    description: [
      ev.flag ? `🚩 ${ev.flag}` : null,
      `📅 <t:${ev.timestamp}:D>  ⏰ <t:${ev.timestamp}:t>  ⏳ <t:${ev.timestamp}:R>`,
    ]
      .filter(Boolean)
      .join('\n'),
    fields: [
      { name: acceptedHeader, value: fmtList(ev.accepted), inline: true },
      { name: `❓ Maybe (${ev.maybe.length})`, value: fmtList(ev.maybe), inline: true },
      { name: `❌ Declined (${ev.declined.length})`, value: fmtList(ev.declined), inline: true },
    ],
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
    accepted: [],
    maybe: [],
    declined: [],
  };

  await store.setJSON(eventId, ev);

  return json(200, {
    type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
    data: { embeds: [buildEmbed(ev)], components: buildComponents(eventId) },
  });
}

// ---------- Button-Klick ----------
async function handleButton(interaction, store) {
  const [prefix, action,
