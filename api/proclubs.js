// Vercel Serverless Function: Proxy für die inoffizielle EA Pro Clubs API.
// Grund für den Versuch: proclubstracker.com (ein funktionierender, bekannter Stats-Tracker)
// gibt in den eigenen Nutzungsbedingungen an, auf Vercel gehostet zu sein und direkt
// bei EA abzufragen — anders als Netlify/Cloudflare, die bei uns blockiert wurden.

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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { type, clubId, clubName, platform = 'common-gen5' } = req.query;

  if (!type || !TYPE_TO_PATH[type]) {
    res.status(400).json({ error: 'Ungültiger oder fehlender "type"-Parameter' });
    return;
  }
  if (type === 'search' && !clubName) {
    res.status(400).json({ error: 'clubName fehlt' });
    return;
  }
  if (type !== 'search' && !clubId) {
    res.status(400).json({ error: 'clubId fehlt' });
    return;
  }

  const path = type === 'search' ? TYPE_TO_PATH.search(clubName, platform) : TYPE_TO_PATH[type](clubId, platform);
  const url = `${EA_BASE}${path}`;

  try {
    const eaRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json',
        Referer: 'https://www.ea.com/',
      },
    });

    const text = await eaRes.text();

    if (!eaRes.ok) {
      res.status(eaRes.status).json({
        error: `EA hat mit Status ${eaRes.status} geantwortet (evtl. Bot-Schutz oder ungültige Club-ID).`,
        raw: text.slice(0, 300),
      });
      return;
    }

    res.setHeader('Content-Type', 'application/json');
    res.status(200).send(text);
  } catch (err) {
    res.status(502).json({ error: 'Anfrage an EA fehlgeschlagen: ' + err.message });
  }
};
