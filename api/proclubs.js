// Vercel Serverless Function: Proxy für die inoffizielle EA Pro Clubs API.
// Nutzt "impit", um Anfragen auf TLS-Ebene wie einen echten Chrome-Browser aussehen zu
// lassen (normales fetch() hat einen technischen "Fingerabdruck", der es als Bot/Skript
// verrät, unabhängig von Headern wie User-Agent — das versucht EAs Bot-Schutz zu erkennen).
const { Impit } = require('impit');
const impit = new Impit({ browser: 'chrome' });

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
    const eaRes = await impit.fetch(url, {
      headers: {
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
