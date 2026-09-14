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

// ---------- Discord-Embed & Buttons bauen ----------
function buildEmbed(ev) {
  const fmtList = (arr) =>
    arr.length === 0 ? '—' : arr.map((u, i) => `${i + 1}. **${u.name}**`).join('\n');

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
  const user = {
    id: member?.user?.id || interaction.user?.id,
    name: member?.nick || member?.user?.username || interaction.user?.username || 'Unbekannt',
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
    data: { embeds: [buildEmbed(ev)], components: buildComponents(eventId) },
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

  if (interaction.type === 3) {
    return handleButton(interaction, store);
  }

  return json(400, { error: 'unhandled interaction type' });
};
