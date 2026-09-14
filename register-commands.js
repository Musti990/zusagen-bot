require('dotenv').config();
const fetch = require('node-fetch');

const commands = [
  {
    name: 'event',
    description: 'Erstellt ein RSVP-Event mit Zusage/Vielleicht/Absage-Buttons',
    options: [
      { name: 'titel', description: 'Titel des Events, z.B. "LOCO NIGHT CUP"', type: 3, required: true },
      { name: 'datum', description: 'Datum im Format TT.MM.JJJJ, z.B. 14.09.2026', type: 3, required: true },
      { name: 'uhrzeit', description: 'Uhrzeit im Format HH:MM, z.B. 22:50', type: 3, required: true },
      { name: 'limit', description: 'Maximale Anzahl an Zusagen, z.B. 20', type: 4, required: true },
      { name: 'info', description: 'Zusatzinfo, z.B. Server/Map/Ort', type: 3, required: false },
    ],
  },
];

async function main() {
  const appId = process.env.APPLICATION_ID;
  const token = process.env.DISCORD_TOKEN;
  const guildId = process.env.GUILD_ID;

  if (!appId || !token) {
    console.error('APPLICATION_ID und DISCORD_TOKEN müssen in .env gesetzt sein.');
    process.exit(1);
  }

  const url = guildId
    ? `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`
    : `https://discord.com/api/v10/applications/${appId}/commands`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });

  if (!res.ok) {
    console.error('Fehler:', res.status, await res.text());
    process.exit(1);
  }

  console.log('Slash-Command /event erfolgreich registriert.');
}

main();
