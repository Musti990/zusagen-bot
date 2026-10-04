// Auf Netlify (AWS Lambda) ist keine einzige Schriftart installiert — sharp/librsvg würde
// deshalb jeden Text als leere Kästchen zeichnen. Hier wird die eingebettete DejaVu-Schrift
// beim ersten Aufruf in /tmp geschrieben und fontconfig darauf gerichtet.
// Muss VOR dem ersten Rendern mit sharp aufgerufen werden.

const fs = require('fs');
const path = require('path');
const { REGULAR_B64, BOLD_B64 } = require('./font-data');

let done = false;

function setupFonts() {
  if (done) return;

  const dir = path.join('/tmp', 'matchreport-fonts');
  const cacheDir = path.join('/tmp', 'matchreport-fontcache');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });

  fs.writeFileSync(path.join(dir, 'DejaVuSans.ttf'), Buffer.from(REGULAR_B64, 'base64'));
  fs.writeFileSync(path.join(dir, 'DejaVuSans-Bold.ttf'), Buffer.from(BOLD_B64, 'base64'));

  const confPath = path.join('/tmp', 'matchreport-fonts.conf');
  fs.writeFileSync(
    confPath,
    `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${dir}</dir>
  <cachedir>${cacheDir}</cachedir>
</fontconfig>
`
  );

  process.env.FONTCONFIG_FILE = confPath;
  process.env.FONTCONFIG_PATH = '/tmp';
  done = true;
}

module.exports = { setupFonts };
