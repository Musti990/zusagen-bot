const nacl = require('tweetnacl');
const { getStore } = require('@netlify/blobs');
const {
  berlinToUtcTimestamp,
  getTopRoleName,
  buildEmbed,
  buildComponents,
} = require('./lib/event-core');
const { sessionStore, clubsForTeam, getSession, saveSession, newSession } = require('./lib/session-core');

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

// Wandelt Jahr/Monat/Tag/Stunde/Minute, gedacht als deutsche Ortszeit (Europe/Berlin,
// inkl. automatischer Sommer-/Winterzeit-Erkennung), in einen korrekten UTC-Unix-Timestamp um.
// -> jetzt in ./lib/event-core.js, hier nur noch importiert (siehe oben)

// Rollen, die in Bot-Anzeigen nie als "Top-Rolle" berücksichtigt werden sollen
// -> jetzt in ./lib/event-core.js, hier nur noch importiert (siehe oben)

// Wer eine dieser Rollen hat, wird in der "Wer fehlt"-Liste komplett übersprungen (kann aber weiterhin abstimmen)
// -> jetzt in ./lib/event-core.js

// ---------- Quiz-Fragen (hier selbst bearbeiten) ----------
// "correct" ist der Index (0-3) der richtigen Antwort in "choices"
const QUIZ_QUESTIONS = [
  { question: 'Wie viele Spieler stehen bei einer Fußballmannschaft auf dem Feld?', choices: ['9', '10', '11', '12'], correct: 2 },
  { question: 'Wie lange dauert eine reguläre Fußball-Halbzeit?', choices: ['40 Minuten', '45 Minuten', '50 Minuten', '35 Minuten'], correct: 1 },
  { question: 'Welche Farbe zeigt der Schiedsrichter bei einem Platzverweis?', choices: ['Gelb', 'Grün', 'Rot', 'Blau'], correct: 2 },
  { question: 'Wie viele Weltmeisterschaften hat Deutschland gewonnen (Stand 2014)?', choices: ['3', '4', '5', '2'], correct: 1 },
  { question: 'Was passiert bei zwei gelben Karten für denselben Spieler?', choices: ['Nichts', 'Freistoß', 'Gelb-Rot (Platzverweis)', 'Elfmeter'], correct: 2 },
  { question: 'Wie nennt man ein Tor aus der eigenen Hälfte direkt ins gegnerische Tor?', choices: ['Elfmeter', 'Abseitstor', 'Fernschuss-Tor', 'Traumtor'], correct: 3 },
  { question: 'Wie viele Auswechslungen sind in einem regulären Spiel meist erlaubt?', choices: ['3', '5', '7', 'Unbegrenzt'], correct: 1 },
  { question: 'Was zeigt die Abseitsregel an?', choices: ['Zu viele Spieler auf dem Feld', 'Foulspiel', 'Position eines Angreifers ohne genug Verteidiger vor sich', 'Zeitüberschreitung'], correct: 2 },
];

// ---------- /quiz ----------
function buildQuizAnswerComponents(quizId, qIndex, choices) {
  const answerRow = {
    type: 1,
    components: choices.map((c, i) => ({
      type: 2,
      style: 1,
      label: c,
      custom_id: `quiz:answer:${quizId}:${i}`,
    })),
  };
  const nextRow = {
    type: 1,
    components: [{ type: 2, style: 2, label: '➡️ Nächste Frage', custom_id: `quiz:next:${quizId}` }],
  };
  return [answerRow, nextRow];
}

function buildQuizQuestionEmbed(qIndex) {
  const q = QUIZ_QUESTIONS[qIndex];
  return {
    title: `Quiz — Frage ${qIndex + 1}/${QUIZ_QUESTIONS.length}`,
    description: q.question,
    color: 0x000000,
  };
}

function buildQuizResultEmbed(scores) {
  const ranked = Object.values(scores).sort((a, b) => b.points - a.points);
  const value =
    ranked.length === 0
      ? 'Niemand hat mitgemacht.'
      : ranked.map((s, i) => `${i + 1}. **${s.name}** — ${s.points} Punkt${s.points === 1 ? '' : 'e'}`).join('\n');

  return {
    title: '🏆 Quiz beendet — Rangliste',
    description: value,
    color: 0x000000,
  };
}

async function handleQuizStart(interaction, quizStore) {
  const quizId = interaction.id;
  const session = { qIndex: 0, scores: {}, answered: {} };
  await quizStore.setJSON(quizId, session);

  return json(200, {
    type: 4,
    data: {
      embeds: [buildQuizQuestionEmbed(0)],
      components: buildQuizAnswerComponents(quizId, 0, QUIZ_QUESTIONS[0].choices),
    },
  });
}

async function handleQuizAnswer(interaction, quizStore) {
  const [, , quizId, choiceIndexStr] = interaction.data.custom_id.split(':');
  const choiceIndex = Number(choiceIndexStr);

  const session = await quizStore.get(quizId, { type: 'json' });
  if (!session) {
    return json(200, { type: 4, data: { content: 'Dieses Quiz ist nicht mehr aktiv.', flags: 64 } });
  }

  const userId = interaction.member?.user?.id || interaction.user?.id;
  const name =
    interaction.member?.nick || interaction.member?.user?.username || interaction.user?.username || 'Unbekannt';

  if (session.answered[userId]) {
    return json(200, { type: 4, data: { content: 'Du hast diese Frage schon beantwortet.', flags: 64 } });
  }

  const q = QUIZ_QUESTIONS[session.qIndex];
  const isCorrect = choiceIndex === q.correct;

  session.answered[userId] = true;
  if (!session.scores[userId]) session.scores[userId] = { name, points: 0 };
  if (isCorrect) session.scores[userId].points += 1;

  await quizStore.setJSON(quizId, session);

  return json(200, {
    type: 4,
    data: {
      content: isCorrect ? '✅ Richtig!' : `❌ Falsch! Richtige Antwort: **${q.choices[q.correct]}**`,
      flags: 64,
    },
  });
}

async function handleQuizNext(interaction, quizStore) {
  const [, , quizId] = interaction.data.custom_id.split(':');

  const session = await quizStore.get(quizId, { type: 'json' });
  if (!session) {
    return json(200, { type: 4, data: { content: 'Dieses Quiz ist nicht mehr aktiv.', flags: 64 } });
  }

  session.qIndex += 1;
  session.answered = {};

  if (session.qIndex >= QUIZ_QUESTIONS.length) {
    await quizStore.setJSON(quizId, session);
    return json(200, {
      type: 7,
      data: { embeds: [buildQuizResultEmbed(session.scores)], components: [] },
    });
  }

  await quizStore.setJSON(quizId, session);

  return json(200, {
    type: 7,
    data: {
      embeds: [buildQuizQuestionEmbed(session.qIndex)],
      components: buildQuizAnswerComponents(quizId, session.qIndex, QUIZ_QUESTIONS[session.qIndex].choices),
    },
  });
}

// ---------- /rentner ----------
async function handleRentnerCommand(interaction) {
  const guildId = interaction.guild_id;
  const authHeader = { Authorization: `Bot ${process.env.DISCORD_TOKEN}` };

  const membersRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members?limit=1000`, {
    headers: authHeader,
  });
  if (!membersRes.ok) {
    return json(200, { type: 4, data: { content: 'Konnte Mitgliederliste nicht laden.', flags: 64 } });
  }
  const members = await membersRes.json();

  const target = members.find((m) => {
    const username = (m.user?.username || '').toLowerCase();
    const nick = (m.nick || '').toLowerCase();
    return username.includes('montelione') || nick.includes('montelione');
  });

  if (!target) {
    return json(200, {
      type: 4,
      data: { content: 'Konnte niemanden namens "montelione" auf diesem Server finden.', flags: 64 },
    });
  }

  return json(200, {
    type: 4,
    data: { content: `<@${target.user.id}> du Rentner 👴` },
  });
}

// ---------- /aufstellung (3-5-2, als Text) ----------
const POSITION_CODES = ['TW', 'LIV', 'ZIV', 'RIV', 'LM', 'RM', 'ZDM', 'ZOM', 'LS', 'RS'];

function parseAufstellungInput(input) {
  const codes = POSITION_CODES.slice().sort((a, b) => b.length - a.length);
  const codePattern = codes.join('|');
  const regex = new RegExp(`(${codePattern})\\s*:\\s*([^:]*?)(?=\\s+(?:${codePattern})\\s*:|$)`, 'g');

  const occurrences = {};
  let match;
  while ((match = regex.exec(input)) !== null) {
    const code = match[1];
    const name = match[2].trim();
    if (!name) continue;
    if (!occurrences[code]) occurrences[code] = [];
    occurrences[code].push(name);
  }

  const result = {};
  for (const [code, names] of Object.entries(occurrences)) {
    if (code === 'ZDM') {
      if (names[0]) result.ZDM = names[0];
      if (names[1]) result.ZDM2 = names[1];
    } else {
      result[code] = names[0];
    }
  }
  return result;
}

function fmtLine(players, codes) {
  const labelFor = (c) => (c === 'ZDM2' ? 'ZDM' : c);
  return codes.map((c) => `**${labelFor(c)}:** ${players[c] || '—'}`).join('   ');
}

async function handleAufstellungCommand(interaction) {
  const opts = {};
  for (const o of interaction.data.options || []) opts[o.name] = o.value;

  const players = parseAufstellungInput(opts.spieler || '');
  const creator =
    interaction.member?.nick || interaction.member?.user?.username || interaction.user?.username || 'Unbekannt';

  return json(200, {
    type: 4,
    data: {
      embeds: [
        {
          title: opts.titel || 'Aufstellung (3-5-2)',
          color: 0x000000,
          fields: [
            { name: '🔺 Sturm', value: fmtLine(players, ['LS', 'RS']) },
            { name: '↔️ Flügel', value: fmtLine(players, ['LM', 'RM']) },
            {
              name: '🔸 Mittelfeld',
              value: `**ZDM:** ${players.ZDM || '—'}   **ZOM:** ${players.ZOM || '—'}   **ZDM:** ${players.ZDM2 || '—'}`,
            },
            { name: '🔹 Abwehr', value: fmtLine(players, ['LIV', 'ZIV', 'RIV']) },
            { name: '🥅 Tor', value: fmtLine(players, ['TW']) },
          ],
          footer: { text: `Erstellt von ${creator}` },
        },
      ],
    },
  });
}

// ---------- /aufstellungvorschlag (automatisch anhand HP-Tags im Nickname) ----------
async function handleAufstellungVorschlagCommand(interaction) {
  const guildId = interaction.guild_id;
  const authHeader = { Authorization: `Bot ${process.env.DISCORD_TOKEN}` };

  const membersRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members?limit=1000`, {
    headers: authHeader,
  });
  if (!membersRes.ok) {
    return json(200, { type: 4, data: { content: 'Konnte Mitgliederliste nicht laden.', flags: 64 } });
  }
  const members = await membersRes.json();

  let pool = members
    .filter((m) => !m.user?.bot)
    .map((m) => {
      const nick = m.nick || m.user?.username || 'Unbekannt';
      const baseName = nick.split('|')[0].trim();
      const hpMatch = nick.match(/HP:\s*([A-ZÄÖÜ,0-9]+)/);
      const hp = hpMatch ? hpMatch[1].split(',').filter(Boolean) : [];
      return { id: m.user.id, name: baseName, hp };
    })
    .filter((p) => p.hp.length > 0);

  const slots = ['TW', 'LIV', 'ZIV', 'RIV', 'ZDM', 'ZDM', 'ZOM', 'LM', 'RM', 'LS', 'RS'];
  const assigned = {};
  let zdmCount = 0;

  for (const code of slots) {
    const idx = pool.findIndex((p) => p.hp.includes(code));
    let name = '—';
    if (idx !== -1) {
      name = pool[idx].name;
      pool.splice(idx, 1);
    }
    if (code === 'ZDM') {
      zdmCount += 1;
      assigned[zdmCount === 1 ? 'ZDM' : 'ZDM2'] = name;
    } else {
      assigned[code] = name;
    }
  }

  return json(200, {
    type: 4,
    data: {
      embeds: [
        {
          title: 'Aufstellungsvorschlag (3-5-2)',
          color: 0x000000,
          fields: [
            { name: '🔺 Sturm', value: fmtLine(assigned, ['LS', 'RS']) },
            { name: '↔️ Flügel', value: fmtLine(assigned, ['LM', 'RM']) },
            {
              name: '🔸 Mittelfeld',
              value: `**ZDM:** ${assigned.ZDM || '—'}   **ZOM:** ${assigned.ZOM || '—'}   **ZDM:** ${assigned.ZDM2 || '—'}`,
            },
            { name: '🔹 Abwehr', value: fmtLine(assigned, ['LIV', 'ZIV', 'RIV']) },
            { name: '🥅 Tor', value: fmtLine(assigned, ['TW']) },
          ],
          footer: { text: 'Automatisch vorgeschlagen anhand der HP-Positionen (/position hp)' },
        },
      ],
    },
  });
}

// ---------- Höchste Rolle, "Wer fehlt", buildEmbed/buildComponents ----------
// -> jetzt alle in ./lib/event-core.js, hier oben importiert

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
    timestamp: berlinToUtcTimestamp(year, month, day, hour, minute),
    creator,
    creatorId: interaction.member?.user?.id || interaction.user?.id || null,
    guildId: interaction.guild_id,
    channelId: interaction.channel_id,
    imageUrl,
    team: opts.mannschaft || null,
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
  const rawNick = member?.nick || member?.user?.username || interaction.user?.username || 'Unbekannt';
  const hpMatch = rawNick.match(/HP:\s*([A-ZÄÖÜ,0-9]+)/);
  const position = hpMatch ? hpMatch[1].split(',')[0] : null;
  const roleName = await getTopRoleName(interaction.guild_id, member?.roles);
  const combinedRole = [roleName, position].filter(Boolean).join(', ');
  const user = {
    id: member?.user?.id || interaction.user?.id,
    name: rawNick.split('|')[0].trim(),
    displayName: rawNick.trim(), // voller Nickname für die Anzeige im Embed
    role: combinedRole || null,
    votedAt: Date.now(),
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

  const tags = { HP: [], NP: [] };
  const tagRegex = /(HP|NP):\s*([A-ZÄÖÜ,]+)/g;
  let match;
  while ((match = tagRegex.exec(currentNick)) !== null) {
    tags[match[1]] = match[2].split(',').filter(Boolean);
  }

  const list = tags[prefix];
  const idx = list.indexOf(position);
  if (idx === -1) {
    list.push(position);
  } else {
    list.splice(idx, 1);
  }

  const parts = [baseName];
  if (tags.HP.length > 0) parts.push(`HP:${tags.HP.join(',')}`);
  if (tags.NP.length > 0) parts.push(`NP: ${tags.NP.join(',')}`);
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
      components: chunk.map((p) => ({ type: 2, style: 1, label: p, custom_id: `genrole:${p}` })),
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

// ---------- /session und /sessionend ----------
// Antworten sind nur für den Auslöser sichtbar (flags: 64), damit im Kanal nur die Bilder stehen.
function teamOption(interaction) {
  const opt = (interaction.data.options || []).find((o) => o.name === 'team');
  return opt ? String(opt.value) : 'beide';
}

async function handleSessionStart(interaction) {
  const store = sessionStore();
  const clubs = clubsForTeam(teamOption(interaction));
  const userName = interaction.member?.user?.global_name || interaction.member?.user?.username || '';
  const started = [];
  const already = [];
  for (const club of clubs) {
    if (await getSession(store, club.clubId)) {
      already.push(club.label);
      continue;
    }
    await saveSession(store, newSession(club, userName));
    started.push(club.label);
  }
  const lines = [];
  if (started.length) lines.push(`✅ Session gestartet für **${started.join(' & ')}**. Ich prüfe alle 2 Minuten auf neue Spiele und poste die Statistiken in #match-history.`);
  if (already.length) lines.push(`ℹ️ Läuft schon: ${already.join(' & ')}`);
  lines.push('Beenden mit **/sessionend** – dann kommt die Session-Bilanz.');
  return json(200, { type: 4, data: { content: lines.join('\n'), flags: 64 } });
}

async function handleSessionEnd(interaction) {
  const store = sessionStore();
  const clubs = clubsForTeam(teamOption(interaction));
  const ending = [];
  for (const club of clubs) {
    const session = await getSession(store, club.clubId);
    if (!session) continue;
    session.endRequestedAt = Date.now();
    await saveSession(store, session);
    ending.push(`${club.label} (${session.matches.length} ${session.matches.length === 1 ? 'Spiel' : 'Spiele'} bisher)`);
  }
  const content = ending.length
    ? `🏁 Session wird beendet: ${ending.join(', ')}.\nDie Bilanz kommt in ca. 2–4 Minuten in #match-history (letzte Spiele werden noch mitgenommen).`
    : 'Es läuft gerade keine Session.';
  return json(200, { type: 4, data: { content, flags: 64 } });
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

  if (interaction.type === 2 && interaction.data?.name === 'quiz') {
    const quizStore = getStore({
      name: 'quiz-sessions',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN,
    });
    return handleQuizStart(interaction, quizStore);
  }

  if (interaction.type === 2 && interaction.data?.name === 'rentner') {
    return handleRentnerCommand(interaction);
  }

  if (interaction.type === 2 && interaction.data?.name === 'session') {
    return handleSessionStart(interaction);
  }

  if (interaction.type === 2 && interaction.data?.name === 'sessionend') {
    return handleSessionEnd(interaction);
  }

  if (interaction.type === 2 && interaction.data?.name === 'aufstellung') {
    return handleAufstellungCommand(interaction);
  }

  if (interaction.type === 2 && interaction.data?.name === 'aufstellungvorschlag') {
    return handleAufstellungVorschlagCommand(interaction);
  }

  if (interaction.type === 3) {
    if (interaction.data.custom_id.startsWith('posnick:')) {
      return handlePositionNickButton(interaction);
    }
    if (interaction.data.custom_id.startsWith('genrole:')) {
      return handleRoleButton(interaction);
    }
    if (interaction.data.custom_id.startsWith('quiz:')) {
      const quizStore = getStore({
        name: 'quiz-sessions',
        siteID: process.env.NETLIFY_SITE_ID,
        token: process.env.NETLIFY_BLOBS_TOKEN,
      });
      if (interaction.data.custom_id.startsWith('quiz:answer:')) {
        return handleQuizAnswer(interaction, quizStore);
      }
      if (interaction.data.custom_id.startsWith('quiz:next:')) {
        return handleQuizNext(interaction, quizStore);
      }
    }
    return handleButton(interaction, store);
  }

  return json(400, { error: 'unhandled interaction type' });
};
