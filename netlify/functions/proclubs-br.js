// Proxy für den bezahlten Drittanbieter-Dienst proclubs-api.com.br.
// Der API-Key bleibt serverseitig (Umgebungsvariable PROCLUBS_API_KEY) und wird
// nie an den Browser weitergegeben.

exports.handler = async (event) => {
  const { clubId, matchId } = event.queryStringParameters || {};
  const apiKey = process.env.PROCLUBS_API_KEY;

  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'PROCLUBS_API_KEY ist nicht gesetzt. Erst einen API-Key bei proclubs-api.com.br besorgen und in Netlify eintragen.' }),
    };
  }
  if (!clubId) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'clubId fehlt' }) };
  }

  let url = `https://proclubs-api.com.br/api?api_key=${encodeURIComponent(apiKey)}&club_id=${encodeURIComponent(clubId)}`;
  if (matchId) url += `&match_id=${encodeURIComponent(matchId)}`;

  try {
    const res = await fetch(url);
    const text = await res.text();

    if (!res.ok) {
      return {
        statusCode: res.status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Dienst hat mit Status ${res.status} geantwortet.`, raw: text.slice(0, 300) }),
      };
    }

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: text };
  } catch (err) {
    return { statusCode: 502, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Anfrage fehlgeschlagen: ' + err.message }) };
  }
};
