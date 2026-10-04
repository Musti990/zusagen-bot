// Spielbericht-Grafik im "Poster"-Stil für Calcio Strada 1 und 2.
// Wird wie bisher als SVG gebaut und per "sharp" in ein PNG umgewandelt (keine externen Bilder,
// nur die eingebettete DejaVu-Schrift). Gleiche Schnittstelle wie die alte Version:
// buildMatchReportSvg(data) -> SVG-String.
//
// data = { homeName, awayName, homeGoals, awayGoals, matchType?, dateText?,
//          stats: {shots:{h,a}, passes:{h,a}, passacc:{h,a}, duels:{h,a}, saves:{h,a}},
//          homePlayers: [...], awayPlayers: [...] }

const W = 1024;
const H = 1536;
const FONT = 'DejaVu Sans';

// Akzentfarbe pro Team (wird anhand der Zahl im Teamnamen gewählt)
const { LOGO_B64, LOGO_W, LOGO_H } = require('./logo-data');

// Italienische Trikolore wie im Calcio-Strada-Logo
const VERDE = '#009246';
const BIANCO = '#f1f2f1';
const ROSSO = '#ce2b37';
const GOLD = '#e6b422'; // nur für Bestnote / Man of the Match

// Akzentfarbe pro Team (wird anhand der Zahl im Teamnamen gewählt)
const TEAM_STYLES = {
  '1': { accent: '#1fbf63' }, // Grün
  '2': { accent: '#e8434f' }, // Rot
};
const DEFAULT_STYLE = { accent: '#1fbf63' };

const POS_KURZ = { goalkeeper: 'TW', defender: 'ABW', midfielder: 'MF', forward: 'ST' };
const POS_REIHENFOLGE = { goalkeeper: 0, defender: 1, midfielder: 2, forward: 3 };

let idCounter = 0;
const uid = (p) => `${p}${++idCounter}`;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(s, max) {
  const str = String(s == null ? '' : s);
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

// Schriftgröße so wählen, dass der Text in maxWidth passt (DejaVu Bold ~0.68em pro Zeichen)
function fitSize(text, maxWidth, maxSize, factor = 0.68, letterSpacing = 0) {
  const len = Math.max(1, String(text).length);
  const size = maxWidth / (len * factor + (len * letterSpacing) / maxSize);
  return Math.max(9, Math.min(maxSize, Math.floor(size)));
}

function teamNumber(name) {
  const m = String(name || '').match(/(\d)\s*$/);
  return m ? m[1] : '';
}

function initials(name) {
  const words = String(name || '?').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

const posKey = (p) => String(p.pos || '').toLowerCase().trim();
function posKurz(p) {
  const key = posKey(p);
  return POS_KURZ[key] || (key ? key.slice(0, 3).toUpperCase() : '');
}
function sortPlayers(players) {
  return players.slice().sort((a, b) => {
    const pa = POS_REIHENFOLGE[posKey(a)] ?? 9;
    const pb = POS_REIHENFOLGE[posKey(b)] ?? 9;
    if (pa !== pb) return pa - pb;
    return (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0);
  });
}

function matchTypeLabel(t) {
  if (t === 'leagueMatch') return 'LEAGUE MATCH';
  if (t === 'friendlyMatch') return 'FRIENDLY MATCH';
  if (t === 'playoffMatch') return 'PLAYOFF MATCH';
  return 'PRO CLUBS MATCH';
}

// Polygon mit abgeschrägten Ecken (Panel-Form wie im Referenzbild)
function chamfer(x, y, w, h, c) {
  return `${x + c},${y} ${x + w - c},${y} ${x + w},${y + c} ${x + w},${y + h - c} ${x + w - c},${y + h} ${x + c},${y + h} ${x},${y + h - c} ${x},${y + c}`;
}

function tricolor(x, y, w, h) {
  const t = w / 3;
  return `<rect x="${x}" y="${y}" width="${t}" height="${h}" fill="${VERDE}"/><rect x="${x + t}" y="${y}" width="${t}" height="${h}" fill="${BIANCO}"/><rect x="${x + 2 * t}" y="${y}" width="${t}" height="${h}" fill="${ROSSO}"/>`;
}

// "CALCIO STRADA" wie im Logo: CALCIO weiß, STRADA in Grün-Weiß-Rot
function wordmark(x, y, size, anchor = 'start', extra = '') {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${FONT}" font-weight="bold" font-size="${size}" letter-spacing="1" ${extra}><tspan fill="#ffffff">CALCIO</tspan><tspan fill="${VERDE}" dx="${size * 0.3}">ST</tspan><tspan fill="${BIANCO}">RA</tspan><tspan fill="${ROSSO}">DA</tspan></text>`;
}

// Echtes Logo, kreisförmig zugeschnitten
function logo(cx, cy, size) {
  const clip = uid('logoClip');
  const scale = size / (LOGO_W * 0.93);
  const w = LOGO_W * scale;
  const h = LOGO_H * scale;
  return `<clipPath id="${clip}"><circle cx="${cx}" cy="${cy}" r="${size / 2}"/></clipPath>
  <circle cx="${cx + 3}" cy="${cy + 5}" r="${size / 2}" fill="#000" opacity="0.5"/>
  <image x="${cx - w / 2}" y="${cy - h / 2 + 1 * scale}" width="${w}" height="${h}" preserveAspectRatio="none" clip-path="url(#${clip})" href="data:image/png;base64,${LOGO_B64}" xlink:href="data:image/png;base64,${LOGO_B64}"/>
  <circle cx="${cx}" cy="${cy}" r="${size / 2}" fill="none" stroke="#2a2a2e" stroke-width="${Math.max(1, size / 60)}"/>`;
}

function panel(x, y, w, h, c = 14) {
  return `<polygon points="${chamfer(x, y, w, h, c)}" fill="url(#panelGrad)" stroke="#3b3b44" stroke-width="2"/>
  <polygon points="${chamfer(x + 5, y + 5, w - 10, h - 10, c - 4)}" fill="none" stroke="#ffffff" stroke-opacity="0.05" stroke-width="1"/>
  ${tricolor(x + w / 2 - 60, y - 1, 120, 4)}`;
}

// Eigenes Wappen: Schild mit Diagonalstreifen + Monogramm + Band unten
function crest(cx, cy, size, { mono, ribbon, accent, own }) {
  const s = size / 120;
  const clip = uid('crestClip');
  const shield = 'M10,6 L90,6 L90,58 C90,88 68,106 50,116 C32,106 10,88 10,58 Z';
  const base = own ? '#0d0d10' : '#2a2a31';
  const stripe = own ? accent : '#6b6b75';
  const monoSize = mono.length > 2 ? 26 : 34;
  return `<g transform="translate(${cx - 50 * s},${cy - 60 * s}) scale(${s})">
    <clipPath id="${clip}"><path d="${shield}"/></clipPath>
    <path d="${shield}" fill="#000" opacity="0.5" transform="translate(3,5)"/>
    <path d="${shield}" fill="${base}"/>
    <g clip-path="url(#${clip})">
      <polygon points="-10,74 110,22 110,40 -10,92" fill="${stripe}"/>
      <polygon points="-10,98 110,46 110,52 -10,104" fill="#ffffff" opacity="0.85"/>
    </g>
    <path d="${shield}" fill="none" stroke="#ffffff" stroke-width="5"/>
    <path d="${shield}" fill="none" stroke="${own ? accent : '#9a9aa5'}" stroke-width="1.5" transform="translate(50,60) scale(0.9) translate(-50,-60)"/>
    <text x="50" y="${own ? 50 : 52}" text-anchor="middle" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="${monoSize}" letter-spacing="1">${esc(mono)}</text>
    ${ribbon
      ? `<polygon points="14,96 86,96 92,108 86,120 14,120 8,108" fill="#ffffff" transform="translate(0,4)"/>
    <text x="50" y="119" text-anchor="middle" fill="#0d0d10" font-family="${FONT}" font-weight="bold" font-size="${ribbon.length > 6 ? 10 : 12}" letter-spacing="1">${esc(ribbon)}</text>`
      : ''}
  </g>`;
}

function crown(x, y, color) {
  return `<g transform="translate(${x},${y})">
    <polygon points="0,26 4,4 14,16 22,0 30,16 40,4 44,26" fill="url(#goldGrad)" stroke="${color}" stroke-width="1"/>
    <rect x="1" y="28" width="42" height="7" rx="2" fill="url(#goldGrad)"/>
    <circle cx="4" cy="4" r="3" fill="#fff3b0"/><circle cx="22" cy="0" r="3" fill="#fff3b0"/><circle cx="40" cy="4" r="3" fill="#fff3b0"/>
  </g>`;
}

function statRow(i, y, label, hVal, aVal, suffix, accent) {
  const h = Number(hVal) || 0;
  const a = Number(aVal) || 0;
  const max = Math.max(h, a, 1);
  const barW = 180;
  const hW = (h / max) * barW;
  const aW = (a / max) * barW;
  // Höherer Wert weiß, niedrigerer gedimmt (Gold bleibt für das eigene Team reserviert)
  const hCol = h >= a ? '#ffffff' : '#8b8b95';
  const aCol = a >= h ? '#ffffff' : '#8b8b95';
  return `
    ${i > 0 ? `<line x1="80" y1="${y - 21}" x2="944" y2="${y - 21}" stroke="#ffffff" stroke-opacity="0.08"/>` : ''}
    <text x="130" y="${y + 9}" text-anchor="middle" fill="${hCol}" font-family="${FONT}" font-weight="bold" font-size="24">${h}${suffix}</text>
    <rect x="188" y="${y - 9}" width="${barW}" height="18" fill="url(#trackGrad)"/>
    <rect x="${368 - hW}" y="${y - 9}" width="${hW}" height="18" fill="url(#homeBarGrad)"/>
    <text x="512" y="${y + 7}" text-anchor="middle" fill="#e5e7eb" font-family="${FONT}" font-size="19" letter-spacing="2">${esc(label)}</text>
    <rect x="656" y="${y - 9}" width="${barW}" height="18" fill="url(#trackGrad)"/>
    <rect x="656" y="${y - 9}" width="${aW}" height="18" fill="url(#barGrad)"/>
    <text x="893" y="${y + 9}" text-anchor="middle" fill="${aCol}" font-family="${FONT}" font-weight="bold" font-size="24">${a}${suffix}</text>`;
}

function cellBox(x, y, w, h, fill = '#16161a') {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${fill}" stroke="#3a3a42" stroke-width="1.2"/>`;
}

function ratingColor(r, isBest, accent) {
  if (isBest) return GOLD;
  if (isNaN(r)) return '#ffffff';
  if (r >= 8) return '#4ade80';
  if (r < 6) return '#f87171';
  return '#ffffff';
}

function playerTable(px, py, pw, title, players, crestSvg, bestRating, accent, own) {
  const rows = sortPlayers(players)
    .slice(0, 11)
    .map((p) => ({ ...p, label: posKurz(p) }));
  const col = { pos: px + 18, name: px + 70, t: px + 290, a: px + 338, r: px + 388 };
  const rowTop = py + 88;
  const rowH = 33;
  let out = panel(px, py, pw, 462, 12);
  out += crestSvg;
  out += `<text x="${px + pw / 2 + 24}" y="${py + 40}" text-anchor="middle" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="${fitSize(title, pw - 150, 24, 0.72, 3)}" letter-spacing="3">${esc(title.toUpperCase())}</text>
  <line x1="${px + 90}" y1="${py + 52}" x2="${px + pw - 16}" y2="${py + 52}" stroke="#ffffff" stroke-opacity="0.15"/>
  <text x="${col.name + 105}" y="${py + 76}" text-anchor="middle" fill="#9ca3af" font-family="${FONT}" font-size="14" letter-spacing="1">SPIELER</text>
  <text x="${col.t + 20}" y="${py + 76}" text-anchor="middle" fill="#9ca3af" font-family="${FONT}" font-size="14">T</text>
  <text x="${col.a + 20}" y="${py + 76}" text-anchor="middle" fill="#9ca3af" font-family="${FONT}" font-size="14">A</text>
  <text x="${col.r + 33}" y="${py + 76}" text-anchor="middle" fill="#9ca3af" font-family="${FONT}" font-size="14" letter-spacing="1">RATING</text>`;

  for (let i = 0; i < 11; i++) {
    const y = rowTop + i * rowH;
    const p = rows[i];
    out += cellBox(col.pos, y, 44, 27) + cellBox(col.name, y, 210, 27) + cellBox(col.t, y, 40, 27) + cellBox(col.a, y, 40, 27) + cellBox(col.r, y, 66, 27, p ? '#2a2a31' : '#16161a');
    if (!p) continue;
    const name = truncate(p.name, 18);
    const r = parseFloat(p.rating);
    const isBest = !isNaN(r) && r === bestRating;
    const hit = own ? accent : '#ffffff';
    const goalsCol = p.goals > 0 ? hit : '#6b7280';
    const assistCol = p.assists > 0 ? hit : '#6b7280';
    out += `
      <text x="${col.pos + 22}" y="${y + 19}" text-anchor="middle" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="${p.label.length > 2 ? 13 : 16}">${esc(p.label)}</text>
      <text x="${col.name + 105}" y="${y + 20}" text-anchor="middle" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="${fitSize(name, 196, 18)}">${esc(name)}</text>
      <text x="${col.t + 20}" y="${y + 20}" text-anchor="middle" fill="${goalsCol}" font-family="${FONT}" font-weight="bold" font-size="18">${p.goals}</text>
      <text x="${col.a + 20}" y="${y + 20}" text-anchor="middle" fill="${assistCol}" font-family="${FONT}" font-weight="bold" font-size="18">${p.assists}</text>
      <text x="${col.r + 33}" y="${y + 20}" text-anchor="middle" fill="${ratingColor(r, isBest, accent)}" font-family="${FONT}" font-weight="bold" font-size="18">${esc(isNaN(r) ? p.rating : r.toFixed(1))}</text>`;
  }
  return out;
}

function buildMatchReportSvg(data) {
  idCounter = 0;
  const num = teamNumber(data.homeName);
  const style = TEAM_STYLES[num] || DEFAULT_STYLE;
  const accent = style.accent;

  const homeGoals = Number(data.homeGoals) || 0;
  const awayGoals = Number(data.awayGoals) || 0;
  const result =
    homeGoals > awayGoals
      ? { text: 'SIEG', fill: '#16a34a' }
      : homeGoals < awayGoals
        ? { text: 'NIEDERLAGE', fill: '#dc2626' }
        : { text: 'UNENTSCHIEDEN', fill: '#52525b' };

  const homePlayers = data.homePlayers || [];
  const awayPlayers = data.awayPlayers || [];
  const allPlayers = homePlayers.map((p) => ({ ...p, own: true })).concat(awayPlayers.map((p) => ({ ...p, own: false })));

  let motm = null;
  allPlayers.forEach((p) => {
    const r = parseFloat(p.rating);
    if (!isNaN(r) && (!motm || r > motm.ratingNum)) motm = { ...p, ratingNum: r };
  });
  const bestRating = motm ? motm.ratingNum : NaN;

  const scorers = allPlayers.filter((p) => p.goals > 0).sort((a, b) => b.goals - a.goals).slice(0, 4);
  const assisters = allPlayers.filter((p) => p.assists > 0).sort((a, b) => b.assists - a.assists).slice(0, 4);

  const ownCrest = (cx, cy, size) => logo(cx, cy, size);
  // Gegner-Wappen: echtes EA-Wappen (data.awayCrest = data:-URI), sonst Ersatz-Wappen mit Initialen
  const oppCrest = (cx, cy, size) =>
    data.awayCrest
      ? `<image x="${cx - size / 2}" y="${cy - size / 2}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet" href="${data.awayCrest}" xlink:href="${data.awayCrest}"/>`
      : crest(cx, cy, size, { mono: initials(data.awayName), ribbon: '', accent, own: false });

  const s = data.stats || {};
  const st = (k) => s[k] || { h: 0, a: 0 };

  const scoreStr = (g) => String(g);
  const scoreSize = (g) => (String(g).length > 1 ? 74 : 104);

  const homeTitle = truncate(data.homeName, 22).toUpperCase();
  const awayTitle = truncate(data.awayName, 22).toUpperCase();

  // Lichtstreifen + Stadionlichter im Hintergrund
  const streaks = [
    [620, 0, 140, 0.10], [780, 0, 60, 0.07], [900, 0, 220, 0.05], [-200, 700, 160, 0.06], [-100, 1100, 90, 0.05],
  ]
    .map(([x, y, w, o]) => `<polygon points="${x},${y} ${x + w},${y} ${x + w - 700},${y + 1100} ${x - 700},${y + 1100}" fill="url(#streakGrad)" opacity="${o * 6}"/>`)
    .join('');
  const lights = [[90, 70], [150, 110], [60, 160], [960, 60], [900, 110], [990, 150], [520, 30]]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="16" fill="#ffffff" opacity="0.55" filter="url(#glow)"/><circle cx="${x}" cy="${y}" r="3" fill="#ffffff"/>`)
    .join('');

  const motmBlock = motm
    ? `
    <circle cx="125" cy="1325" r="74" fill="#0b0b0e" stroke="#ffffff" stroke-width="3"/>
    <circle cx="125" cy="1325" r="66" fill="none" stroke="${motm.own ? accent : '#6b6b75'}" stroke-width="2"/>
    ${motm.own ? ownCrest(125, 1325, 92) : oppCrest(125, 1325, 92)}
    ${crown(325, 1250, '#b8860b')}
    ${cellBox(220, 1296, 254, 40, '#101014')}
    <text x="347" y="1324" text-anchor="middle" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="${fitSize(truncate(motm.name, 20), 236, 22)}">${esc(truncate(motm.name, 20))}</text>
    ${cellBox(220, 1348, 70, 40, '#2a2a31')}${cellBox(305, 1348, 70, 40, '#2a2a31')}${cellBox(390, 1348, 84, 40, '#2a2a31')}
    <text x="255" y="1377" text-anchor="middle" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="24">${motm.goals}</text>
    <text x="340" y="1377" text-anchor="middle" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="24">${motm.assists}</text>
    <text x="432" y="1377" text-anchor="middle" fill="${GOLD}" font-family="${FONT}" font-weight="bold" font-size="24">${motm.ratingNum.toFixed(1)}</text>
    <text x="255" y="1406" text-anchor="middle" fill="#9ca3af" font-family="${FONT}" font-size="12" letter-spacing="1">TORE</text>
    <text x="340" y="1406" text-anchor="middle" fill="#9ca3af" font-family="${FONT}" font-size="12" letter-spacing="1">VORL.</text>
    <text x="432" y="1406" text-anchor="middle" fill="#9ca3af" font-family="${FONT}" font-size="12" letter-spacing="1">RATING</text>`
    : `<text x="268" y="1330" text-anchor="middle" fill="#9ca3af" font-family="${FONT}" font-size="22">—</text>`;

  const involvementList = (list, x, key) =>
    list.length === 0
      ? `<text x="${x + 100}" y="1310" text-anchor="middle" fill="#6b7280" font-family="${FONT}" font-size="22">—</text>`
      : list
          .map((p, i) => {
            const y = 1282 + i * 34;
            const name = truncate(p.name, 15);
            return `
      <circle cx="${x + 8}" cy="${y + 13}" r="5" fill="${p.own ? accent : '#6b6b75'}"/>
      <text x="${x + 22}" y="${y + 19}" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="${fitSize(name, 150, 16)}">${esc(name)}</text>
      ${cellBox(x + 178, y, 34, 26, '#2a2a31')}
      <text x="${x + 195}" y="${y + 19}" text-anchor="middle" fill="${p.own ? accent : '#ffffff'}" font-family="${FONT}" font-weight="bold" font-size="16">${p[key]}</text>`;
          })
          .join('');

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1a1a1f"/><stop offset="0.5" stop-color="#0c0c0f"/><stop offset="1" stop-color="#050506"/>
    </linearGradient>
    <radialGradient id="vignette" cx="0.5" cy="0.35" r="0.8">
      <stop offset="0.5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.75"/>
    </radialGradient>
    <linearGradient id="streakGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0"/><stop offset="0.45" stop-color="#ffffff" stop-opacity="0.12"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="panelGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1d1d22" stop-opacity="0.96"/><stop offset="1" stop-color="#0b0b0e" stop-opacity="0.96"/>
    </linearGradient>
    <linearGradient id="metalGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="#e4e4e7"/><stop offset="1" stop-color="#a1a1aa"/>
    </linearGradient>
    <linearGradient id="barGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#d4d4d8"/><stop offset="1" stop-color="#ffffff"/>
    </linearGradient>
    <linearGradient id="trackGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#3f3f46"/><stop offset="1" stop-color="#27272a"/>
    </linearGradient>
    <linearGradient id="homeBarGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.55"/><stop offset="1" stop-color="${accent}"/>
    </linearGradient>
    <linearGradient id="bandFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.3" stop-color="#fff" stop-opacity="1"/><stop offset="0.7" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <mask id="bandMask"><rect x="-800" y="-200" width="1600" height="2400" fill="url(#bandFade)"/></mask>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6"/></filter>
    <radialGradient id="spot" cx="0.5" cy="0.3" r="0.6">
      <stop offset="0" stop-color="#3a3a40" stop-opacity="0.9"/><stop offset="1" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="goldGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fde68a"/><stop offset="0.5" stop-color="#e6b422"/><stop offset="1" stop-color="#a16207"/>
    </linearGradient>
    <pattern id="diag" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
      <line x1="0" y1="0" x2="0" y2="14" stroke="#ffffff" stroke-opacity="0.025" stroke-width="2"/>
    </pattern>
    <filter id="glow" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="12"/></filter>
  </defs>

  <!-- Hintergrund: dunkel wie das Logo, mit Trikolore-Schärpen -->
  <rect width="${W}" height="${H}" fill="url(#bgGrad)"/>
  <rect width="${W}" height="${H}" fill="url(#spot)"/>
  <rect width="${W}" height="${H}" fill="url(#diag)"/>
  ${streaks}
  <g transform="translate(860,-60) rotate(32)" opacity="0.42" filter="url(#soft)">
    <rect x="-60" y="-200" width="40" height="2400" fill="${VERDE}" mask="url(#bandMask)"/>
    <rect x="-20" y="-200" width="40" height="2400" fill="${BIANCO}" mask="url(#bandMask)"/>
    <rect x="20" y="-200" width="40" height="2400" fill="${ROSSO}" mask="url(#bandMask)"/>
  </g>
  <g transform="translate(-40,980) rotate(32)" opacity="0.3" filter="url(#soft)">
    <rect x="-45" y="-700" width="30" height="1400" fill="${VERDE}"/>
    <rect x="-15" y="-700" width="30" height="1400" fill="${BIANCO}"/>
    <rect x="15" y="-700" width="30" height="1400" fill="${ROSSO}"/>
  </g>
  ${lights}
  <text x="600" y="250" text-anchor="middle" fill="none" stroke="#ffffff" stroke-opacity="0.07" stroke-width="2" font-family="${FONT}" font-weight="bold" font-size="210" transform="skewX(-12)">CS${esc(num)}</text>
  <rect width="${W}" height="${H}" fill="url(#vignette)"/>
  ${tricolor(0, 0, W, 6)}
  ${tricolor(0, H - 6, W, 6)}

  <!-- Kopfbereich -->
  <g transform="translate(40,0)">
    <text x="0" y="52" fill="#d4d4d8" font-family="${FONT}" font-weight="bold" font-size="15" letter-spacing="6">PRO CLUBS · ${num ? 'TEAM ' + esc(num) : 'SPIELBERICHT'}</text>
    ${wordmark(0, 108, 56, 'start', 'transform="skewX(-10) translate(19,0)"')}
    ${tricolor(0, 122, 330, 5)}
    <text x="0" y="158" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="22" letter-spacing="7">${esc(matchTypeLabel(data.matchType))}</text>
    <text x="0" y="186" fill="#a1a1aa" font-family="${FONT}" font-size="15" letter-spacing="6">FULL TIME${data.dateText ? ' · ' + esc(data.dateText) : ''}</text>
  </g>
  <g font-family="${FONT}" font-weight="bold" text-anchor="end">
    <text x="985" y="128" fill="#d4d4d8" font-size="15" letter-spacing="3">WIR SIND EINE</text>
    <text x="985" y="158" fill="${VERDE}" font-size="26" letter-spacing="1">GROSSE</text>
    <text x="985" y="186" fill="${ROSSO}" font-size="26" letter-spacing="1">FAMILIE</text>
  </g>

  <!-- Ergebnis -->
  ${panel(70, 210, 884, 236, 22)}
  ${ownCrest(212, 300, 150)}
  ${oppCrest(812, 300, 150)}
  <text x="212" y="420" text-anchor="middle" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="${fitSize(homeTitle, 300, 28, 0.72, 1)}" letter-spacing="1">${esc(homeTitle)}</text>
  <text x="812" y="420" text-anchor="middle" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="${fitSize(awayTitle, 300, 28, 0.72, 1)}" letter-spacing="1">${esc(awayTitle)}</text>
  <rect x="363" y="238" width="106" height="122" rx="8" fill="#000" opacity="0.5" transform="translate(3,4)"/>
  <rect x="363" y="238" width="106" height="122" rx="8" fill="url(#metalGrad)"/>
  <rect x="555" y="238" width="106" height="122" rx="8" fill="#000" opacity="0.5" transform="translate(3,4)"/>
  <rect x="555" y="238" width="106" height="122" rx="8" fill="url(#metalGrad)"/>
  <text x="416" y="${299 + scoreSize(homeGoals) * 0.36}" text-anchor="middle" fill="#111114" font-family="${FONT}" font-weight="bold" font-size="${scoreSize(homeGoals)}">${esc(scoreStr(homeGoals))}</text>
  <text x="608" y="${299 + scoreSize(awayGoals) * 0.36}" text-anchor="middle" fill="#111114" font-family="${FONT}" font-weight="bold" font-size="${scoreSize(awayGoals)}">${esc(scoreStr(awayGoals))}</text>
  <rect x="502" y="274" width="20" height="20" rx="3" fill="url(#metalGrad)"/>
  <rect x="502" y="306" width="20" height="20" rx="3" fill="url(#metalGrad)"/>
  <text x="512" y="388" text-anchor="middle" fill="#d4d4d8" font-family="${FONT}" font-size="15" letter-spacing="6">FULL TIME</text>
  <rect x="${512 - (result.text.length * 10 + 30) / 2}" y="400" width="${result.text.length * 10 + 30}" height="28" rx="14" fill="${result.fill}"/>
  <text x="512" y="420" text-anchor="middle" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="14" letter-spacing="2">${result.text}</text>

  <!-- Statistik -->
  ${panel(55, 474, 914, 246, 16)}
  <polygon points="300,452 724,452 708,494 316,494" fill="#0b0b0e" stroke="#4b4b55" stroke-width="2"/>
  <text x="512" y="483" text-anchor="middle" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="24" letter-spacing="6">MATCH STATISTICS</text>
  <rect x="80" y="500" width="864" height="208" fill="#000" fill-opacity="0.35" stroke="#ffffff" stroke-opacity="0.08"/>
  ${statRow(0, 521, 'SCHÜSSE', st('shots').h, st('shots').a, '', accent)}
  ${statRow(1, 562, 'PÄSSE', st('passes').h, st('passes').a, '', accent)}
  ${statRow(2, 603, 'PASSQUOTE', st('passacc').h, st('passacc').a, '%', accent)}
  ${statRow(3, 644, 'ZWEIKÄMPFE', st('duels').h, st('duels').a, '', accent)}
  ${statRow(4, 685, 'PARADEN', st('saves').h, st('saves').a, '', accent)}

  <!-- Aufstellungen -->
  ${playerTable(32, 734, 473, data.homeName, homePlayers, ownCrest(70, 768, 62), bestRating, accent, true)}
  ${playerTable(519, 734, 473, data.awayName, awayPlayers, oppCrest(557, 768, 62), bestRating, accent, false)}

  <!-- Man of the Match -->
  ${panel(32, 1210, 473, 214, 12)}
  <text x="268" y="1244" text-anchor="middle" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="20" letter-spacing="4">MAN OF THE MATCH</text>
  ${motmBlock}

  <!-- Torbeteiligungen -->
  ${panel(519, 1210, 473, 214, 12)}
  <text x="755" y="1244" text-anchor="middle" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="20" letter-spacing="4">TORBETEILIGUNGEN</text>
  <text x="640" y="1270" text-anchor="middle" fill="#9ca3af" font-family="${FONT}" font-size="12" letter-spacing="2">TORE</text>
  <text x="870" y="1270" text-anchor="middle" fill="#9ca3af" font-family="${FONT}" font-size="12" letter-spacing="2">VORLAGEN</text>
  <line x1="755" y1="1262" x2="755" y2="1410" stroke="#ffffff" stroke-opacity="0.15"/>
  ${involvementList(scorers, 535, 'goals')}
  ${involvementList(assisters, 768, 'assists')}

  <!-- Fußzeile -->
  <line x1="60" y1="1452" x2="964" y2="1452" stroke="#ffffff" stroke-opacity="0.15"/>
  ${logo(300, 1492, 62)}
  ${wordmark(345, 1503, 30, 'start', 'transform="skewX(-10) translate(265,0)"')}
  <rect x="660" y="1474" width="2" height="36" fill="#ffffff" opacity="0.3"/>
  <text x="678" y="1490" fill="#d4d4d8" font-family="${FONT}" font-size="13" letter-spacing="3">WIR SIND EINE</text>
  <text x="678" y="1510" font-family="${FONT}" font-weight="bold" font-size="14" letter-spacing="3"><tspan fill="${VERDE}">GROSSE</tspan><tspan fill="${ROSSO}" dx="6">FAMILIE</tspan></text>
</svg>`;
}

module.exports = { buildMatchReportSvg };
