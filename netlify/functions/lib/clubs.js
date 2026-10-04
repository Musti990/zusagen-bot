// Leichtgewichtige Grundeinstellungen (ohne sharp/impit), damit /session-Befehle schnell antworten.
const { getStore } = require('@netlify/blobs');

// Die beiden überwachten Clubs (team = Kürzel für /session team:1 bzw. team:2)
const CLUBS = [
  { clubId: '22829', label: 'Calcio Strada 1', team: '1' },
  { clubId: '20998', label: 'Calcio Strada 2', team: '2' },
];

function blobStore(name) {
  return getStore({ name, siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
}

module.exports = { CLUBS, blobStore };
