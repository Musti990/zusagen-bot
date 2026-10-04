// Spielbericht-Grafik im "Poster"-Stil für Calcio Strada 1 und 2.
// Wird wie bisher als SVG gebaut und per "sharp" in ein PNG umgewandelt (keine externen Bilder,
// nur die eingebettete DejaVu-Schrift). Gleiche Schnittstelle wie die alte Version:
// buildMatchReportSvg(data) -> SVG-String.
//
// data = { homeName, awayName, homeGoals, awayGoals, matchType?, dateText?,
//          stats: {shots:{h,a}, passes:{h,a}, passacc:{h,a}, duels:{h,a}, saves:{h,a}},
//          homePlayers: [...], awayPlayers: [...] }

const W = 1024;
const BASE_H = 1536;
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
  if (t === 'cupMatch') return 'CUP MATCH';
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

function statRow(i, y, label, hVal, aVal, suffix, accent, lowerBetter = false) {
  const h = Number(hVal) || 0;
  const a = Number(aVal) || 0;
  const max = Math.max(h, a, 1);
  const barW = 180;
  const hW = (h / max) * barW;
  const aW = (a / max) * barW;
  // Höherer Wert weiß, niedrigerer gedimmt (Gold bleibt für das eigene Team reserviert)
  // bei "weniger ist besser" (Fehlpässe, Karten) ist der kleinere Wert der bessere
  const hBetter = lowerBetter ? h <= a : h >= a;
  const aBetter = lowerBetter ? a <= h : a >= h;
  const hCol = hBetter ? '#ffffff' : '#8b8b95';
  const aCol = aBetter ? '#ffffff' : '#8b8b95';
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

// Ausführliche Spielerstatistik (volle Breite) für das eigene Team
const DETAIL_ROW_H = 34;
function detailTable(py, title, players, bestRating, accent, crestSvg) {
  const rows = sortPlayers(players).slice(0, 11);
  const n = (k, p) => Number(p[k]) || 0;
  const cols = [
    { key: 'goals', label: 'TORE', val: (p) => n('goals', p), good: (v) => v > 0 },
    { key: 'assists', label: 'VORL.', val: (p) => n('assists', p), good: (v) => v > 0 },
    { key: 'shots', label: 'SCHÜSSE', val: (p) => n('shots', p) },
    { key: 'passes', label: 'PÄSSE', val: (p) => `${n('passesmade', p)}/${n('passattempts', p)}` },
    { key: 'lost', label: 'FEHLP.', val: (p) => Math.max(0, n('passattempts', p) - n('passesmade', p)), bad: (v) => v >= 8 },
    {
      key: 'passacc', label: 'PASS %',
      val: (p) => (n('passattempts', p) > 0 ? Math.round((n('passesmade', p) / n('passattempts', p)) * 100) : '–'),
      good: (v) => v >= 85, bad: (v) => v !== '–' && v < 70,
    },
    { key: 'tackles', label: 'TACKLES', val: (p) => `${n('tacklesmade', p)}/${n('tackleattempts', p)}` },
  ];
  // Abfangaktionen nur, wenn EA sie überhaupt liefert
  if (players.some((p) => p.interceptions != null)) cols.push({ key: 'int', label: 'ABFANG.', val: (p) => n('interceptions', p) });
  cols.push({ key: 'saves', label: 'PARADEN', val: (p) => n('saves', p), good: (v) => v > 0 });

  const height = 104 + 11 * DETAIL_ROW_H + 16;
  const x0 = 32, w = 960;
  const nameX = x0 + 70, nameW = 200;
  const numStart = nameX + nameW + 10;
  const ratingW = 66;
  const numEnd = x0 + w - 18 - ratingW - 8;
  const colW = (numEnd - numStart) / cols.length;

  let out = panel(x0, py, w, height, 14) + crestSvg;
  out += `<text x="${x0 + w / 2}" y="${py + 42}" text-anchor="middle" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="22" letter-spacing="4">${esc(String(title).toUpperCase())}</text>
  <line x1="${x0 + 90}" y1="${py + 56}" x2="${x0 + w - 16}" y2="${py + 56}" stroke="#ffffff" stroke-opacity="0.15"/>
  <text x="${nameX + nameW / 2}" y="${py + 84}" text-anchor="middle" fill="#9ca3af" font-family="${FONT}" font-size="12" letter-spacing="1">SPIELER</text>
  ${cols.map((c, i) => `<text x="${numStart + colW * i + colW / 2}" y="${py + 84}" text-anchor="middle" fill="#9ca3af" font-family="${FONT}" font-size="12">${c.label}</text>`).join('')}
  <text x="${x0 + w - 18 - ratingW / 2}" y="${py + 84}" text-anchor="middle" fill="#9ca3af" font-family="${FONT}" font-size="12" letter-spacing="1">RATING</text>`;

  for (let i = 0; i < 11; i++) {
    const y = py + 96 + i * DETAIL_ROW_H;
    const p = rows[i];
    out += cellBox(x0 + 18, y, 44, 27) + cellBox(nameX, y, nameW, 27);
    cols.forEach((c, ci) => (out += cellBox(numStart + colW * ci + 3, y, colW - 6, 27)));
    out += cellBox(x0 + w - 18 - ratingW, y, ratingW, 27, p ? '#2a2a31' : '#16161a');
    if (!p) continue;
    const name = truncate(p.name, 18);
    const r = parseFloat(p.rating);
    out += `
      <text x="${x0 + 40}" y="${y + 19}" text-anchor="middle" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="${posKurz(p).length > 2 ? 13 : 16}">${esc(posKurz(p))}</text>
      <text x="${nameX + nameW / 2}" y="${y + 20}" text-anchor="middle" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="${fitSize(name, nameW - 14, 17)}">${esc(name)}</text>`;
    cols.forEach((c, ci) => {
      const v = c.val(p);
      let col = '#ffffff';
      if (v === 0 || v === '0/0') col = '#6b7280';
      if (c.good && c.good(v)) col = accent;
      if (c.bad && c.bad(v)) col = '#f87171';
      out += `<text x="${numStart + colW * ci + colW / 2}" y="${y + 20}" text-anchor="middle" fill="${col}" font-family="${FONT}" font-weight="bold" font-size="${String(v).length > 4 ? 14 : 17}">${esc(v)}</text>`;
    });
    out += `<text x="${x0 + w - 18 - ratingW / 2}" y="${y + 20}" text-anchor="middle" fill="${ratingColor(r, !isNaN(r) && r === bestRating, accent)}" font-family="${FONT}" font-weight="bold" font-size="17">${esc(isNaN(r) ? p.rating : r.toFixed(1))}</text>`;
  }
  return { svg: out, height };
}

function footer(y) {
  return `<g transform="translate(0,${y - 1452})">
  <line x1="60" y1="1452" x2="964" y2="1452" stroke="#ffffff" stroke-opacity="0.15"/>
  ${logo(300, 1492, 62)}
  ${wordmark(345, 1503, 30, 'start', 'transform="skewX(-10) translate(265,0)"')}
  <rect x="660" y="1474" width="2" height="36" fill="#ffffff" opacity="0.3"/>
  <text x="678" y="1490" fill="#d4d4d8" font-family="${FONT}" font-size="13" letter-spacing="3">WIR SIND EINE</text>
  <text x="678" y="1510" font-family="${FONT}" font-weight="bold" font-size="14" letter-spacing="3"><tspan fill="${VERDE}">GROSSE</tspan><tspan fill="${ROSSO}" dx="6">FAMILIE</tspan></text>
  </g>`;
}

// Zweites Bild: ausführliche Spielerstatistik des eigenen Teams
function buildPlayerStatsSvg(data) {
  idCounter = 0;
  const num = teamNumber(data.homeName);
  const accent = (TEAM_STYLES[num] || DEFAULT_STYLE).accent;
  const players = data.homePlayers || [];
  let best = NaN;
  (data.homePlayers || []).concat(data.awayPlayers || []).forEach((p) => {
    const r = parseFloat(p.rating);
    if (!isNaN(r) && (isNaN(best) || r > best)) best = r;
  });
  const hg = Number(data.homeGoals) || 0;
  const ag = Number(data.awayGoals) || 0;
  const resFill = hg > ag ? '#16a34a' : hg < ag ? '#dc2626' : '#52525b';

  const tableY = 250;
  const detail = detailTable(tableY, data.homeName, players, best, accent, logo(70, tableY + 34, 56));
  const H = tableY + detail.height + 140;

  return frame(H, accent, num, `
  <g transform="translate(40,0)">
    <text x="0" y="52" fill="#d4d4d8" font-family="${FONT}" font-weight="bold" font-size="15" letter-spacing="6">PRO CLUBS · ${num ? 'TEAM ' + esc(num) : 'SPIELBERICHT'}</text>
    ${wordmark(0, 108, 56, 'start', 'transform="skewX(-10) translate(19,0)"')}
    ${tricolor(0, 122, 330, 5)}
    <text x="0" y="158" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="22" letter-spacing="7">SPIELERSTATISTIK</text>
    <text x="0" y="186" fill="#a1a1aa" font-family="${FONT}" font-size="15" letter-spacing="6">${esc(matchTypeLabel(data.matchType))}${data.dateText ? ' · ' + esc(data.dateText) : ''}</text>
  </g>
  <g font-family="${FONT}" font-weight="bold" text-anchor="end">
    <text x="985" y="96" fill="#ffffff" font-size="15" letter-spacing="2">${esc(truncate(String(data.homeName).toUpperCase(), 20))}</text>
    <text x="985" y="186" fill="#d4d4d8" font-size="15" letter-spacing="2">${esc(truncate(String(data.awayName).toUpperCase(), 20))}</text>
  </g>
  <rect x="870" y="110" width="115" height="48" rx="8" fill="${resFill}"/>
  <text x="927" y="143" text-anchor="middle" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="24">${hg} : ${ag}</text>
  ${detail.svg}
  ${footer(H - 84)}`);
}

// Gemeinsamer Rahmen (Verläufe, Hintergrund, Trikolore) für alle Grafiken
function frame(H, accent, num, inner, Wd = W) {
  // Lichtstreifen + Stadionlichter im Hintergrund
  const streaks = [
    [620, 0, 140, 0.10], [780, 0, 60, 0.07], [900, 0, 220, 0.05], [-200, 700, 160, 0.06], [-100, 1100, 90, 0.05],
  ]
    .map(([x, y, w, o]) => `<polygon points="${x},${y} ${x + w},${y} ${x + w - 700},${y + 1100} ${x - 700},${y + 1100}" fill="url(#streakGrad)" opacity="${o * 6}"/>`)
    .join('');
  const lights = [[90, 70], [150, 110], [60, 160], [960, 60], [900, 110], [990, 150], [520, 30]]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="16" fill="#ffffff" opacity="0.55" filter="url(#glow)"/><circle cx="${x}" cy="${y}" r="3" fill="#ffffff"/>`)
    .join('');

  return `<svg width="${Wd}" height="${H}" viewBox="0 0 ${Wd} ${H}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
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
  <rect width="${Wd}" height="${H}" fill="url(#bgGrad)"/>
  <rect width="${Wd}" height="${H}" fill="url(#spot)"/>
  <rect width="${Wd}" height="${H}" fill="url(#diag)"/>
  ${streaks}
  <g transform="translate(${Wd - 164},-60) rotate(32)" opacity="0.42" filter="url(#soft)">
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
  <rect width="${Wd}" height="${H}" fill="url(#vignette)"/>
  ${tricolor(0, 0, Wd, 6)}
  ${tricolor(0, H - 6, Wd, 6)}

${inner}
</svg>`;
}

// ---------------------------------------------------------------------------
// Session-Bilanz (/sessionend): alle Spiele der Session + Rangliste nach Ø-Rating
// data = { teamName, dateText?, matches: [{ oppName, homeGoals, awayGoals, matchType }],
//          players: [{ name, pos, ratings: [..], goals, assists, passesmade, passattempts }] }
const MEDAL = ['#e6b422', '#c0c7d1', '#cd7f32'];

function buildSessionSummarySvg(data) {
  idCounter = 0;
  const num = teamNumber(data.teamName);
  const accent = (TEAM_STYLES[num] || DEFAULT_STYLE).accent;
  const matches = data.matches || [];

  const players = (data.players || [])
    .map((p) => {
      const rs = (p.ratings || []).map(Number).filter((r) => !isNaN(r));
      const avg = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0;
      return { ...p, games: rs.length, avg };
    })
    .filter((p) => p.games > 0)
    .sort((a, b) => b.avg - a.avg || b.games - a.games);

  const wins = matches.filter((m) => Number(m.homeGoals) > Number(m.awayGoals)).length;
  const losses = matches.filter((m) => Number(m.homeGoals) < Number(m.awayGoals)).length;
  const draws = matches.length - wins - losses;
  const gf = matches.reduce((a, m) => a + (Number(m.homeGoals) || 0), 0);
  const ga = matches.reduce((a, m) => a + (Number(m.awayGoals) || 0), 0);
  const teamAvg = players.length ? players.reduce((a, p) => a + p.avg, 0) / players.length : 0;

  let y = 225;
  let body = '';

  // --- Spiele der Session ---
  const mH = 70 + matches.length * 46;
  body += panel(32, y, 960, mH, 14);
  body += `<text x="512" y="${y + 40}" text-anchor="middle" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="22" letter-spacing="5">SPIELE DER SESSION</text>`;
  matches.forEach((m, i) => {
    const ry = y + 60 + i * 46;
    const hg = Number(m.homeGoals) || 0;
    const ag = Number(m.awayGoals) || 0;
    const res = hg > ag ? ['S', '#16a34a'] : hg < ag ? ['N', '#dc2626'] : ['U', '#52525b'];
    body += `
    <rect x="56" y="${ry}" width="912" height="38" rx="4" fill="#000" fill-opacity="0.3" stroke="#ffffff" stroke-opacity="0.06"/>
    <rect x="66" y="${ry + 6}" width="26" height="26" rx="5" fill="${res[1]}"/>
    <text x="79" y="${ry + 25}" text-anchor="middle" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="16">${res[0]}</text>
    <text x="440" y="${ry + 26}" text-anchor="end" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="18">${esc(truncate(String(data.teamName).toUpperCase(), 22))}</text>
    <rect x="460" y="${ry + 4}" width="104" height="30" rx="5" fill="url(#metalGrad)"/>
    <text x="512" y="${ry + 27}" text-anchor="middle" fill="#111114" font-family="${FONT}" font-weight="bold" font-size="20">${hg} : ${ag}</text>
    <text x="584" y="${ry + 26}" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="${fitSize(truncate(String(m.oppName).toUpperCase(), 22), 280, 18)}">${esc(truncate(String(m.oppName).toUpperCase(), 22))}</text>
    <text x="956" y="${ry + 25}" text-anchor="end" fill="#9ca3af" font-family="${FONT}" font-size="12" letter-spacing="2">${esc(m.matchType === 'leagueMatch' ? 'LIGA' : m.matchType === 'friendlyMatch' ? 'FREUNDSCH.' : 'CUP')}</text>`;
  });
  y += mH + 22;

  // --- Kennzahlen ---
  const chips = [
    ['SPIELE', String(matches.length), '#ffffff'],
    ['BILANZ', `${wins}S ${draws}U ${losses}N`, '#ffffff'],
    ['TORE', `${gf} : ${ga}`, gf >= ga ? accent : '#f87171'],
    ['Ø TEAM-RATING', teamAvg.toFixed(2), GOLD],
  ];
  chips.forEach((c, i) => {
    const cx = 32 + i * 245;
    body += `<polygon points="${chamfer(cx, y, 230, 84, 10)}" fill="url(#panelGrad)" stroke="#3b3b44" stroke-width="2"/>
    <text x="${cx + 115}" y="${y + 30}" text-anchor="middle" fill="#9ca3af" font-family="${FONT}" font-size="13" letter-spacing="3">${c[0]}</text>
    <text x="${cx + 115}" y="${y + 66}" text-anchor="middle" fill="${c[2]}" font-family="${FONT}" font-weight="bold" font-size="${fitSize(c[1], 200, 30)}">${esc(c[1])}</text>`;
  });
  y += 84 + 30;

  // --- Podium Top 3 ---
  const top = players.slice(0, 3);
  if (top.length) {
    body += `<text x="512" y="${y + 22}" text-anchor="middle" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="22" letter-spacing="5">TOP 3 DER SESSION</text>`.replace(`y="${y + 22}"`, `y="${y + 12}"`);
    const slots = [
      { idx: 1, x: 52, top: 80 },
      { idx: 0, x: 362, top: 60 },
      { idx: 2, x: 672, top: 96 },
    ];
    slots.forEach((sl) => {
      const p = top[sl.idx];
      if (!p) return;
      const cy = y + sl.top;
      const h = 210;
      const c = MEDAL[sl.idx];
      const name = truncate(p.name, 16);
      body += `<polygon points="${chamfer(sl.x, cy, 300, h, 14)}" fill="url(#panelGrad)" stroke="${c}" stroke-opacity="0.8" stroke-width="2"/>
      <rect x="${sl.x + 100}" y="${cy - 1}" width="100" height="5" fill="${c}"/>
      <circle cx="${sl.x + 150}" cy="${cy + 40}" r="24" fill="${c}"/>
      <text x="${sl.x + 150}" y="${cy + 50}" text-anchor="middle" fill="#111114" font-family="${FONT}" font-weight="bold" font-size="26">${sl.idx + 1}</text>
      ${sl.idx === 0 ? crown(sl.x + 128, cy - 34, '#b8860b') : ''}
      <text x="${sl.x + 150}" y="${cy + 94}" text-anchor="middle" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="${fitSize(name, 270, 22)}">${esc(name)}</text>
      <text x="${sl.x + 150}" y="${cy + 144}" text-anchor="middle" fill="${c}" font-family="${FONT}" font-weight="bold" font-size="44">${p.avg.toFixed(2)}</text>
      <text x="${sl.x + 150}" y="${cy + 164}" text-anchor="middle" fill="#9ca3af" font-family="${FONT}" font-size="12" letter-spacing="3">Ø RATING</text>
      <text x="${sl.x + 150}" y="${cy + 192}" text-anchor="middle" fill="#d4d4d8" font-family="${FONT}" font-size="14">${p.games} ${p.games === 1 ? 'Spiel' : 'Spiele'} · ${p.goals || 0} T · ${p.assists || 0} V</text>`;
    });
    y += 306 + 30;
  }

  // --- Rangliste ---
  const rowH = 36;
  const tH = 100 + players.length * rowH + 14;
  body += panel(32, y, 960, tH, 14);
  body += `<text x="512" y="${y + 40}" text-anchor="middle" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="22" letter-spacing="5">RANGLISTE · Ø BEWERTUNG</text>
  <line x1="60" y1="${y + 54}" x2="964" y2="${y + 54}" stroke="#ffffff" stroke-opacity="0.15"/>`;
  const C = { rank: 50, pos: 98, name: 150, g: 382, t: 460, a: 538, pa: 616, r: 706, bar: 784 };
  const hy = y + 82;
  body += `
  <text x="${C.rank + 20}" y="${hy}" text-anchor="middle" fill="#9ca3af" font-family="${FONT}" font-size="12">#</text>
  <text x="${C.name + 110}" y="${hy}" text-anchor="middle" fill="#9ca3af" font-family="${FONT}" font-size="12" letter-spacing="1">SPIELER</text>
  <text x="${C.g + 35}" y="${hy}" text-anchor="middle" fill="#9ca3af" font-family="${FONT}" font-size="12">SPIELE</text>
  <text x="${C.t + 35}" y="${hy}" text-anchor="middle" fill="#9ca3af" font-family="${FONT}" font-size="12">TORE</text>
  <text x="${C.a + 35}" y="${hy}" text-anchor="middle" fill="#9ca3af" font-family="${FONT}" font-size="12">VORL.</text>
  <text x="${C.pa + 40}" y="${hy}" text-anchor="middle" fill="#9ca3af" font-family="${FONT}" font-size="12">PASS %</text>
  <text x="${C.r + 33}" y="${hy}" text-anchor="middle" fill="#9ca3af" font-family="${FONT}" font-size="12">Ø RATING</text>`;
  players.forEach((p, i) => {
    const ry = y + 96 + i * rowH;
    const rankCol = i < 3 ? MEDAL[i] : '#2a2a31';
    const bottom = players.length > 5 && i >= players.length - 3;
    const pass = p.passattempts > 0 ? Math.round((p.passesmade / p.passattempts) * 100) : '–';
    const barW = Math.max(4, Math.min(1, (p.avg - 5) / 5) * 184);
    const barCol = p.avg >= 8 ? '#4ade80' : p.avg >= 7 ? accent : p.avg >= 6 ? '#eab308' : '#f87171';
    const name = truncate(p.name, 20);
    body += `
    ${cellBox(C.rank, ry, 40, 28, rankCol)}
    <text x="${C.rank + 20}" y="${ry + 20}" text-anchor="middle" fill="${i < 3 ? '#111114' : bottom ? '#f87171' : '#ffffff'}" font-family="${FONT}" font-weight="bold" font-size="16">${i + 1}</text>
    ${cellBox(C.pos, ry, 44, 28)}
    <text x="${C.pos + 22}" y="${ry + 20}" text-anchor="middle" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="${posKurz(p).length > 2 ? 13 : 16}">${esc(posKurz(p))}</text>
    ${cellBox(C.name, ry, 222, 28)}
    <text x="${C.name + 111}" y="${ry + 20}" text-anchor="middle" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="${fitSize(name, 206, 17)}">${esc(name)}</text>
    ${cellBox(C.g, ry, 70, 28)}${cellBox(C.t, ry, 70, 28)}${cellBox(C.a, ry, 70, 28)}${cellBox(C.pa, ry, 80, 28)}
    <text x="${C.g + 35}" y="${ry + 20}" text-anchor="middle" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="16">${p.games}</text>
    <text x="${C.t + 35}" y="${ry + 20}" text-anchor="middle" fill="${p.goals ? accent : '#6b7280'}" font-family="${FONT}" font-weight="bold" font-size="16">${p.goals || 0}</text>
    <text x="${C.a + 35}" y="${ry + 20}" text-anchor="middle" fill="${p.assists ? accent : '#6b7280'}" font-family="${FONT}" font-weight="bold" font-size="16">${p.assists || 0}</text>
    <text x="${C.pa + 40}" y="${ry + 20}" text-anchor="middle" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="16">${pass}</text>
    ${cellBox(C.r, ry, 66, 28, '#2a2a31')}
    <text x="${C.r + 33}" y="${ry + 20}" text-anchor="middle" fill="${i === 0 ? GOLD : '#ffffff'}" font-family="${FONT}" font-weight="bold" font-size="16">${p.avg.toFixed(2)}</text>
    <rect x="${C.bar}" y="${ry + 8}" width="184" height="12" rx="3" fill="url(#trackGrad)"/>
    <rect x="${C.bar}" y="${ry + 8}" width="${barW}" height="12" rx="3" fill="${barCol}"/>`;
  });
  y += tH + 30;

  const H = y + 110;
  return frame(H, accent, num, `
  <g transform="translate(40,0)">
    <text x="0" y="52" fill="#d4d4d8" font-family="${FONT}" font-weight="bold" font-size="15" letter-spacing="6">PRO CLUBS · ${num ? 'TEAM ' + esc(num) : 'SESSION'}</text>
    ${wordmark(0, 108, 56, 'start', 'transform="skewX(-10) translate(19,0)"')}
    ${tricolor(0, 122, 330, 5)}
    <text x="0" y="158" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="22" letter-spacing="7">SESSION-BILANZ</text>
    <text x="0" y="186" fill="#a1a1aa" font-family="${FONT}" font-size="15" letter-spacing="6">${esc(data.dateText || '')}</text>
  </g>
  <g font-family="${FONT}" font-weight="bold" text-anchor="end">
    <text x="985" y="128" fill="#d4d4d8" font-size="15" letter-spacing="3">WIR SIND EINE</text>
    <text x="985" y="158" fill="${VERDE}" font-size="26" letter-spacing="1">GROSSE</text>
    <text x="985" y="186" fill="${ROSSO}" font-size="26" letter-spacing="1">FAMILIE</text>
  </g>
  ${body}
  ${footer(H - 84)}`);
}

// ---------------------------------------------------------------------------
// Kader-Grafik (Querformat): 4 Spalten Torwart / Abwehr / Mittelfeld / Offensive
// data = { teamName, players: [{ number, name, group: 'TW' | 'ABW' | 'MF' | 'OFF' }] }
const KADER_W = 1600;
const KADER_GROUPS = [
  { key: 'TW', title: 'TORWART' },
  { key: 'ABW', title: 'ABWEHR' },
  { key: 'MF', title: 'MITTELFELD' },
  { key: 'OFF', title: 'OFFENSIVE' },
];

function kaderIcon(key, cx, cy) {
  const f = '#ffffff';
  if (key === 'TW') {
    // Torwarthandschuh
    return `<g transform="translate(${cx - 22},${cy - 26})" fill="${f}">
      <rect x="8" y="22" width="30" height="26" rx="7"/>
      <rect x="9" y="2" width="6" height="26" rx="3"/><rect x="16.5" y="0" width="6" height="28" rx="3"/>
      <rect x="24" y="1" width="6" height="27" rx="3"/><rect x="31.5" y="5" width="6" height="23" rx="3"/>
      <rect x="0" y="18" width="7" height="20" rx="3.5" transform="rotate(-30 4 28)"/>
      <rect x="10" y="44" width="26" height="8" rx="2" fill="#9ca3af"/></g>`;
  }
  if (key === 'ABW') {
    // Schild, halb gefüllt
    return `<g transform="translate(${cx - 22},${cy - 26})">
      <path d="M22,2 L42,9 L42,26 C42,40 32,48 22,52 C12,48 2,40 2,26 L2,9 Z" fill="none" stroke="${f}" stroke-width="3.5"/>
      <path d="M22,8 L22,46 C14,42 8,36 8,26 L8,13 Z" fill="${f}"/></g>`;
  }
  if (key === 'MF') {
    // Spielfeld
    return `<g transform="translate(${cx - 30},${cy - 20})" fill="none" stroke="${f}" stroke-width="3">
      <rect x="1" y="1" width="58" height="38" rx="2"/><line x1="30" y1="1" x2="30" y2="39"/>
      <circle cx="30" cy="20" r="7"/><rect x="1" y="11" width="9" height="18"/><rect x="50" y="11" width="9" height="18"/></g>`;
  }
  // Ball
  return `<g transform="translate(${cx},${cy})">
    <circle r="25" fill="${f}"/>
    <polygon points="0,-8 7.6,-2.5 4.7,6.5 -4.7,6.5 -7.6,-2.5" fill="#111114"/>
    <path d="M0,-25 L0,-14 M-23.8,-7.7 L-13,-4 M23.8,-7.7 L13,-4 M-14.7,20.2 L-8,11 M14.7,20.2 L8,11" stroke="#111114" stroke-width="2.5"/>
    <path d="M-6,-24 L6,-24 L4,-16 L-4,-16 Z M-24,2 L-19,-10 L-14,-3 L-19,8 Z M24,2 L19,-10 L14,-3 L19,8 Z M-16,19 L-6,24 L-9,16 Z M16,19 L6,24 L9,16 Z" fill="#111114"/></g>`;
}

function buildKaderSvg(data) {
  idCounter = 0;
  const num = teamNumber(data.teamName);
  const accent = (TEAM_STYLES[num] || DEFAULT_STYLE).accent;
  const players = (data.players || []).slice();
  const groups = KADER_GROUPS.map((g) => ({
    ...g,
    list: players.filter((p) => p.group === g.key).sort((a, b) => (Number(a.number) || 999) - (Number(b.number) || 999)),
  }));

  const rows = Math.max(11, ...groups.map((g) => g.list.length));
  const rowH = 38;
  const colW = 330, gap = 22;
  const x0 = (KADER_W - (4 * colW + 3 * gap)) / 2;
  const y0 = 330;
  const panelH = 132 + rows * rowH + 18;

  let cols = '';
  groups.forEach((g, gi) => {
    const x = x0 + gi * (colW + gap);
    cols += panel(x, y0, colW, panelH, 14);
    cols += kaderIcon(g.key, x + colW / 2, y0 + 50);
    cols += `<text x="${x + colW / 2}" y="${y0 + 106}" text-anchor="middle" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="26" letter-spacing="2">${g.title}</text>
    <line x1="${x + 18}" y1="${y0 + 120}" x2="${x + colW - 18}" y2="${y0 + 120}" stroke="#ffffff" stroke-opacity="0.35"/>
    <rect x="${x + colW / 2 - 30}" y="${y0 + 118}" width="60" height="4" fill="${accent}"/>`;
    for (let i = 0; i < rows; i++) {
      const ry = y0 + 136 + i * rowH;
      const p = g.list[i];
      if (!p) {
        cols += cellBox(x + 18, ry, 48, 30, '#141418') + cellBox(x + 74, ry, colW - 92, 30, '#141418');
        continue;
      }
      const nr = Number.isInteger(Number(p.number)) && p.number !== null && p.number !== '' ? String(p.number).padStart(2, '0') : '–';
      const name = truncate(p.name, 22);
      cols += `<rect x="${x + 18}" y="${ry}" width="48" height="30" rx="5" fill="url(#metalGrad)"/>
      <text x="${x + 42}" y="${ry + 22}" text-anchor="middle" fill="#111114" font-family="${FONT}" font-weight="bold" font-size="17">${esc(nr)}</text>
      ${cellBox(x + 74, ry, colW - 92, 30, '#1c1c21')}
      <text x="${x + 88}" y="${ry + 21}" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="${fitSize(name, colW - 120, 17)}">${esc(name)}</text>`;
    }
  });

  const H = y0 + panelH + 130;
  const side = (x, anchor, words) =>
    words.map((w, i) => `<text x="${x}" y="${y0 + 40 + i * 30}" text-anchor="${anchor}" fill="#d4d4d8" font-family="${FONT}" font-size="17" letter-spacing="4">${w}</text>`).join('') +
    `<rect x="${anchor === 'start' ? x : x - 40}" y="${y0 + 40 + words.length * 30 - 8}" width="40" height="3" fill="${accent}"/>`;

  return frame(H, accent, num, `
  <!-- Kopf -->
  ${logo(230, 165, 250)}
  <text x="${KADER_W / 2}" y="70" text-anchor="middle" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="30" letter-spacing="6">CALCIO <tspan fill="${VERDE}">ST</tspan><tspan fill="${BIANCO}">RA</tspan><tspan fill="${ROSSO}">DA</tspan><tspan fill="#a1a1aa" font-weight="normal" dx="22">PRO CLUBS</tspan></text>
  <text x="${KADER_W / 2}" y="222" text-anchor="middle" fill="#000" opacity="0.6" font-family="${FONT}" font-weight="bold" font-size="170" letter-spacing="8" transform="skewX(-12) translate(${222 * 0.2126 + 6},6)">KADER</text>
  <text x="${KADER_W / 2}" y="222" text-anchor="middle" fill="url(#metalGrad)" stroke="#ffffff" stroke-width="2" font-family="${FONT}" font-weight="bold" font-size="170" letter-spacing="8" transform="skewX(-12) translate(${222 * 0.2126},0)">KADER</text>
  ${tricolor(KADER_W / 2 - 260, 240, 520, 6)}
  <text x="${KADER_W / 2}" y="285" text-anchor="middle" fill="#e5e7eb" font-family="${FONT}" font-size="20" letter-spacing="7">WIR SIND EINE GROSSE FAMILIE</text>

  <g text-anchor="end" font-family="${FONT}" font-weight="bold">
    <text x="${KADER_W - 70}" y="110" fill="#d4d4d8" font-size="20" letter-spacing="6">TEAM</text>
    <text x="${KADER_W - 70}" y="225" fill="${accent}" font-size="130">${esc(num || '')}</text>
    <text x="${KADER_W - 70}" y="270" fill="#a1a1aa" font-size="18" letter-spacing="4">${players.length} SPIELER</text>
  </g>


  ${cols}

  <g transform="translate(${KADER_W / 2 - 512},0)">${footer(H - 84)}</g>`, KADER_W);
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

  // Team-Statistik-Zeilen: [Label, {h,a}, Suffix, weniger-ist-besser]
  const pct = (made, att) => (att > 0 ? Math.round((made / att) * 100) : 0);
  const statRows = [
    ['SCHÜSSE', st('shots')],
    ['PÄSSE ANGEKOMMEN', st('passes')],
    ['FEHLPÄSSE', st('passesLost'), '', true],
    ['PASSQUOTE', st('passacc'), '%'],
    ['TACKLES GEWONNEN', st('duels')],
    ['TACKLE-QUOTE', { h: pct(st('duels').h, st('tackleAttempts').h), a: pct(st('duels').a, st('tackleAttempts').a) }, '%'],
  ];
  if (s.interceptions) statRows.push(['ABFANGAKTIONEN', st('interceptions')]);
  statRows.push(['PARADEN', st('saves')], ['ROTE KARTEN', st('redcards'), '', true]);
  const statsInnerH = statRows.length * 41 + 3;
  const dyStats = statsInnerH - 208; // Mehrhöhe gegenüber dem alten 5-Zeilen-Block

  const H = BASE_H + dyStats;

  const scoreStr = (g) => String(g);
  const scoreSize = (g) => (String(g).length > 1 ? 74 : 104);

  const homeTitle = truncate(data.homeName, 22).toUpperCase();
  const awayTitle = truncate(data.awayName, 22).toUpperCase();


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
  return frame(H, accent, num, `
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
  ${panel(55, 474, 914, statsInnerH + 38, 16)}
  <polygon points="300,452 724,452 708,494 316,494" fill="#0b0b0e" stroke="#4b4b55" stroke-width="2"/>
  <text x="512" y="483" text-anchor="middle" fill="#ffffff" font-family="${FONT}" font-weight="bold" font-size="24" letter-spacing="6">MATCH STATISTICS</text>
  <rect x="80" y="500" width="864" height="${statsInnerH}" fill="#000" fill-opacity="0.35" stroke="#ffffff" stroke-opacity="0.08"/>
  ${statRows.map((r, i) => statRow(i, 521 + i * 41, r[0], r[1].h, r[1].a, r[2] || '', accent, r[3])).join('')}

  <g transform="translate(0,${dyStats})">
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

  </g>

  <!-- Fußzeile -->
  <g transform="translate(0,${H - BASE_H})">
  <line x1="60" y1="1452" x2="964" y2="1452" stroke="#ffffff" stroke-opacity="0.15"/>
  ${logo(300, 1492, 62)}
  ${wordmark(345, 1503, 30, 'start', 'transform="skewX(-10) translate(265,0)"')}
  <rect x="660" y="1474" width="2" height="36" fill="#ffffff" opacity="0.3"/>
  <text x="678" y="1490" fill="#d4d4d8" font-family="${FONT}" font-size="13" letter-spacing="3">WIR SIND EINE</text>
  <text x="678" y="1510" font-family="${FONT}" font-weight="bold" font-size="14" letter-spacing="3"><tspan fill="${VERDE}">GROSSE</tspan><tspan fill="${ROSSO}" dx="6">FAMILIE</tspan></text>
  </g>`);
}

module.exports = { buildMatchReportSvg, buildPlayerStatsSvg, buildSessionSummarySvg, buildKaderSvg };
