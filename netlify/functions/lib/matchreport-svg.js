// Baut die Spielbericht-Grafik als SVG (statt HTML+Browser) — wird per "sharp" direkt in ein
// PNG umgewandelt. Dadurch kein Headless-Chromium nötig (67 MB, sprengt Netlifys 50-MB-Limit),
// sondern nur "sharp" (~28 MB), was deutlich darunter bleibt.

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function truncate(s, max) {
  const str = String(s == null ? '' : s);
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

function statBar(y, label, hVal, aVal) {
  const h = Number(hVal) || 0;
  const a = Number(aVal) || 0;
  const total = h + a || 1;
  const barWidth = 460;
  const hWidth = (h / total) * barWidth;
  return `
    <text x="40" y="${y}" text-anchor="end" fill="#ffffff" font-size="13" font-family="Arial">${h}</text>
    <text x="300" y="${y - 10}" text-anchor="middle" fill="#9ca3af" font-size="10" font-family="Arial" letter-spacing="1">${esc(label.toUpperCase())}</text>
    <rect x="70" y="${y - 7}" width="${barWidth}" height="6" rx="3" fill="#374151"/>
    <rect x="70" y="${y - 7}" width="${hWidth}" height="6" rx="3" fill="#e5e7eb"/>
    <text x="560" y="${y}" text-anchor="start" fill="#ffffff" font-size="13" font-family="Arial">${a}</text>`;
}

function playerTableRows(players, xOffset, startY) {
  return players
    .slice(0, 11)
    .map((p, i) => {
      const y = startY + i * 20;
      return `
      <text x="${xOffset}" y="${y}" fill="#9ca3af" font-size="11" font-family="Arial">${esc(p.pos)}</text>
      <text x="${xOffset + 35}" y="${y}" fill="#ffffff" font-size="11" font-family="Arial">${esc(truncate(p.name, 14))}</text>
      <text x="${xOffset + 150}" y="${y}" fill="#ffffff" font-size="11" font-family="Arial" text-anchor="middle">${p.goals}</text>
      <text x="${xOffset + 175}" y="${y}" fill="#ffffff" font-size="11" font-family="Arial" text-anchor="middle">${p.assists}</text>
      <rect x="${xOffset + 195}" y="${y - 12}" width="32" height="16" rx="3" fill="#374151"/>
      <text x="${xOffset + 211}" y="${y}" fill="#ffffff" font-size="11" font-family="Arial" font-weight="bold" text-anchor="middle">${esc(p.rating)}</text>`;
    })
    .join('');
}

// data = { homeName, awayName, homeGoals, awayGoals, stats: {shots:{h,a}, passes:{h,a}, passacc:{h,a}, duels:{h,a}, saves:{h,a}}, homePlayers: [...], awayPlayers: [...] }
function buildMatchReportSvg(data) {
  const allPlayers = data.homePlayers.concat(data.awayPlayers);
  const allScorers = allPlayers.filter((p) => p.goals > 0).sort((a, b) => b.goals - a.goals);
  const allAssisters = allPlayers.filter((p) => p.assists > 0).sort((a, b) => b.assists - a.assists);
  const scorers = allScorers.slice(0, 4);
  const assisters = allAssisters.slice(0, Math.max(0, 4 - scorers.length));

  let motm = null;
  allPlayers.forEach((p) => {
    const r = parseFloat(p.rating);
    if (!isNaN(r) && (!motm || r > motm.ratingNum)) motm = Object.assign({}, p, { ratingNum: r });
  });

  const s = data.stats;
  const maxPlayers = Math.max(data.homePlayers.length, data.awayPlayers.length, 1);
  const playersBlockHeight = Math.min(maxPlayers, 11) * 20 + 30;
  const height = 300 + playersBlockHeight + 140;

  const scorerLines = scorers
    .map((p, i) => `<text x="326" y="${height - 74 + i * 17}" fill="#ffffff" font-size="12" font-family="Arial">⚽ ${esc(truncate(p.name, 16))}</text><text x="550" y="${height - 74 + i * 17}" fill="#ffffff" font-size="12" font-family="Arial" text-anchor="end">${p.goals}</text>`)
    .join('');
  const assistLines = assisters
    .map((p, i) => `<text x="326" y="${height - 74 + (scorers.length + i) * 17}" fill="#ffffff" font-size="12" font-family="Arial">🎯 ${esc(truncate(p.name, 16))}</text><text x="550" y="${height - 74 + (scorers.length + i) * 17}" fill="#ffffff" font-size="12" font-family="Arial" text-anchor="end">${p.assists}</text>`)
    .join('');

  return `<svg width="600" height="${height}" viewBox="0 0 600 ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="600" height="${height}" rx="14" fill="#111827"/>

  <text x="170" y="55" text-anchor="middle" fill="#ffffff" font-size="17" font-weight="bold" font-family="Arial">${esc(truncate(data.homeName, 18))}</text>
  <rect x="255" y="30" width="90" height="36" rx="8" fill="#1f2937"/>
  <text x="300" y="55" text-anchor="middle" fill="#ffffff" font-size="22" font-weight="bold" font-family="Arial">${esc(data.homeGoals)} : ${esc(data.awayGoals)}</text>
  <text x="430" y="55" text-anchor="middle" fill="#ffffff" font-size="17" font-weight="bold" font-family="Arial">${esc(truncate(data.awayName, 18))}</text>

  ${statBar(110, 'Schüsse', s.shots.h, s.shots.a)}
  ${statBar(150, 'Pässe', s.passes.h, s.passes.a)}
  ${statBar(190, 'Passquote %', s.passacc.h, s.passacc.a)}
  ${statBar(230, 'Zweikämpfe', s.duels.h, s.duels.a)}
  ${statBar(270, 'Paraden', s.saves.h, s.saves.a)}

  <text x="40" y="300" fill="#9ca3af" font-size="12" font-family="Arial">${esc(truncate(data.homeName, 22))}</text>
  <text x="320" y="300" fill="#9ca3af" font-size="12" font-family="Arial">${esc(truncate(data.awayName, 22))}</text>
  ${playerTableRows(data.homePlayers, 40, 320)}
  ${playerTableRows(data.awayPlayers, 320, 320)}

  <rect x="40" y="${height - 120}" width="260" height="90" rx="10" fill="#1f2937"/>
  <text x="56" y="${height - 96}" fill="#9ca3af" font-size="10" font-family="Arial" letter-spacing="1">MAN OF THE MATCH</text>
  ${motm
    ? `<text x="56" y="${height - 74}" fill="#ffffff" font-size="14" font-weight="bold" font-family="Arial">${esc(truncate(motm.name, 20))}</text>
       <text x="56" y="${height - 56}" fill="#9ca3af" font-size="11" font-family="Arial">${motm.goals} Tore · Rating ${esc(motm.rating)}</text>`
    : `<text x="56" y="${height - 74}" fill="#9ca3af" font-size="13" font-family="Arial">—</text>`}

  <rect x="310" y="${height - 120}" width="250" height="90" rx="10" fill="#1f2937"/>
  <text x="326" y="${height - 96}" fill="#9ca3af" font-size="10" font-family="Arial" letter-spacing="1">TORBETEILIGUNGEN</text>
  ${scorerLines}${assistLines}
  ${scorers.length === 0 && assisters.length === 0 ? `<text x="326" y="${height - 74}" fill="#9ca3af" font-size="13" font-family="Arial">—</text>` : ''}
</svg>`;
}

module.exports = { buildMatchReportSvg };
