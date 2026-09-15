exports.handler = async () => {
  const appId = process.env.APPLICATION_ID;
  const guildId = process.env.GUILD_ID;
  const token = process.env.DISCORD_TOKEN;

  if (!appId || !token) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'APPLICATION_ID oder DISCORD_TOKEN fehlt als Umgebungsvariable in Netlify.' }),
    };
  }

  const commands = [
    {
      name: 'event',
      description: 'Erstellt ein RSVP-Event mit Zusage/Vielleicht/Absage-Buttons',
      options: [
        { name: 'titel', description: 'Titel des Events', type: 3, required: true },
        { name: 'datum', description: 'Datum TT.MM.JJJJ', type: 3, required: true },
        { name: 'uhrzeit', description: 'Uhrzeit HH:MM', type: 3, required: true },
        { name: 'limit', description: 'Maximale Anzahl Zusagen', type: 4, required: true },
        { name: 'info', description: 'Zusatzinfo', type: 3, required: false },
        { name: 'beschreibung', description: 'Ausführlichere Beschreibung des Events', type: 3, required: false },
        { name: 'bild', description: 'Bild für das Event', type: 11, required: false },
        {
          name: 'mannschaft',
          description: 'Für welche Mannschaft?',
          type: 3,
          required: false,
          choices: [
            { name: '1. Mannschaft', value: '1 Mannschaft' },
            { name: '2. Mannschaft', value: '2 Mannschaft' },
          ],
        },
      ],
    },
    {
      name: 'mitglieder',
      description: 'Zeigt alle Servermitglieder gruppiert nach Rolle',
    },
    {
      name: 'position',
      description: 'Positionsauswahl (schreibt sie in deinen Nickname)',
      options: [
        { name: 'hp', description: 'Hauptposition festlegen', type: 1 },
        { name: 'np', description: 'Nebenposition festlegen', type: 1 },
      ],
    },
    {
      name: 'rolle',
      description: 'Postet ein dauerhaftes Panel zur Rollenwahl (Tester, Aushilfe)',
    },
  ];

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

  const data = await res.json();

  return {
    statusCode: res.status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data, null, 2),
  };
};
