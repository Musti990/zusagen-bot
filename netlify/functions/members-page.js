// Proxy für die inoffizielle EA Pro Clubs API (dieselben Endpunkte, die proclubs.ea.com
// selbst im Browser aufruft). Nutzt "impit", um Anfragen auf TLS-Ebene wie einen echten
// Chrome-Browser aussehen zu lassen — normales fetch() hat einen technischen Fingerabdruck,
// der von EAs Bot-Schutz (Akamai) erkannt und blockiert wird, unabhängig von Headern.

const { Impit } = require('impit');
const impit = new Impit({ browser: 'chrome' });

const EA_BASE = 'https://proclubs.ea.com/api/fc';

const TYPE_TO_PATH = {
  info: (clubId, platform) => `/clubs/info?platform=${platform}&clubIds=${clubId}`,
  overallStats: (clubId, platform) => `/clubs/overallStats?platform=${platform}&clubIds=${clubId}`,
  members: (clubId, platform) => `/members/stats?platform=${platform}&clubId=${clubId}`,
  career: (clubId, platform) => `/members/career/stats?platform=${platform}&clubId=${clubId}`,
  matches: (clubId, platform, matchType) =>
    `/clubs/matches?platform=${platform}&clubIds=${clubId}&matchType=${matchType || 'leagueMatch'}&maxResultCount=5`,
  search: (clubName, platform) => `/allTimeLeaderboard/search?platform=${platform}&clubName=${encodeURIComponent(clubName)}`,
};

exports.handler = async (event) => {
  const { type, clubId, clubName, platform, matchType } = event.queryStringParameters || {};
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

  const path =
    type === 'search' ? TYPE_TO_PATH.search(clubName, plat) : type === 'matches' ? TYPE_TO_PATH.matches(clubId, plat, matchType) : TYPE_TO_PATH[type](clubId, plat);
  const url = `${EA_BASE}${path}`;

  try {
    const res = await impit.fetch(url, {
      headers: {
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
