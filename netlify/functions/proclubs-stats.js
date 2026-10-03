// Proxy für die inoffizielle EA Pro Clubs API (dieselben Endpunkte, die proclubs.ea.com
// selbst im Browser aufruft). EA bietet keine offizielle öffentliche API an, aber diese
// Endpunkte sind ohne Login erreichbar und werden von diversen Community-Tools genutzt.
// Läuft serverseitig, damit kein CORS-Problem im Browser entsteht und der Club-Lookup
// bei Bedarf wechselbar bleibt (nicht fest einprogrammiert).

const EA_BASE = 'https://proclubs.ea.com/api/fc';

const TYPE_TO_PATH = {
  info: (clubId, platform) => `/clubs/info?platform=${platform}&clubIds=${clubId}`,
  overallStats: (clubId, platform) => `/clubs/overallStats?platform=${platform}&clubIds=${clubId}`,
  members: (clubId, platform) => `/members/stats?platform=${platform}&clubId=${clubId}`,
  career: (clubId, platform) => `/members/career/stats?platform=${platform}&clubId=${clubId}`,
  matches: (clubId, platform) =>
    `/clubs/matches?platform=${platform}&clubIds=${clubId}&matchType=leagueMatch&maxResultCount=5`,
  search: (clubName, platform) => `/allTimeLeaderboard/search?platform=${platform}&clubName=${encodeURIComponent(clubName)}`,
};

exports.handler = async (event) => {
  const { type, clubId, clubName, platform } = event.queryStringParameters || {};
  const plat = platform || 'common-gen5'; // common-gen5 = PS5/Xbox Series/PC, common-gen4 = PS4/Xbox One, nx = Switch

  if (!type || !TYPE_TO_PATH[type]) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Ungültiger oder fehlender "type"-Parameter (info, overallStats, members, career, matches, search)' }),
    };
  }
  if (type === 'search' && !clubName) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'clubName fehlt' }) };
  }
  if (type !== 'search' && !clubId) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'clubId fehlt' }) };
  }

  const path = type === 'search' ? TYPE_TO_PATH.search(clubName, plat) : TYPE_TO_PATH[type](clubId, plat);
  const url = `${EA_BASE}${path}`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json',
        Referer: 'https://www.ea.com/',
      },
    });

    const text = await res.text();

    if (!res.ok) {
      return {
        statusCode: res.status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `EA hat mit Status ${res.status} geantwortet (evtl. Bot-Schutz oder ungültige Club-ID).`, raw: text.slice(0, 300) }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: text,
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Anfrage an EA fehlgeschlagen: ' + err.message }),
    };
  }
};
