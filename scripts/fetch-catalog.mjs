// Fetches the public GP catalog from CelesTrak and writes a compact snapshot
// to public/data/catalog.json. Run with `npm run data:fetch`.
// `--offline` re-compacts the files already in data-raw/ without downloading.
import fs from 'node:fs';
import path from 'node:path';

const RAW = path.resolve('data-raw');
const OUT = path.resolve('public/data/catalog.json');
const UA = 'orbitrace-demo/0.1';

const SOURCES = [
  { file: 'active.json', url: 'GROUP=active', kind: 'PAYLOAD' },
  { file: 'cosmos-1408-debris.json', url: 'GROUP=cosmos-1408-debris', kind: 'DEBRIS' },
  { file: 'fengyun-1c-debris.json', url: 'GROUP=fengyun-1c-debris', kind: 'DEBRIS' },
  { file: 'iridium-33-debris.json', url: 'GROUP=iridium-33-debris', kind: 'DEBRIS' },
  { file: 'cosmos-2251-debris.json', url: 'GROUP=cosmos-2251-debris', kind: 'DEBRIS' },
  { file: 'defunct.json', url: 'CATNR=27386', kind: 'DEFUNCT' }, // ENVISAT
  // All other cataloged fragments and spent stages (name search, no login needed).
  { file: 'all-debris.json', url: 'NAME=DEB', kind: 'DEBRIS' },
  { file: 'rocket-bodies.json', url: 'NAME=R/B', kind: 'DEFUNCT' },
];

const offline = process.argv.includes('--offline');
fs.mkdirSync(RAW, { recursive: true });

for (const s of SOURCES) {
  if (offline) continue;
  const res = await fetch(`https://celestrak.org/NORAD/elements/gp.php?${s.url}&FORMAT=json`, {
    headers: { 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`${s.url}: HTTP ${res.status}`);
  fs.writeFileSync(path.join(RAW, s.file), await res.text());
  console.log('fetched', s.file);
}

// Field order of each compact row. The app rebuilds OMM objects from it.
const FIELDS = [
  'OBJECT_NAME', 'OBJECT_ID', 'NORAD_CAT_ID', 'EPOCH', 'MEAN_MOTION', 'ECCENTRICITY',
  'INCLINATION', 'RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY', 'BSTAR',
  'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT',
];

const seen = new Set();
const rows = [];
for (const s of SOURCES) {
  const list = JSON.parse(fs.readFileSync(path.join(RAW, s.file), 'utf8'));
  for (const o of list) {
    if (seen.has(o.NORAD_CAT_ID)) continue;
    seen.add(o.NORAD_CAT_ID);
    // Parent bodies inside the debris groups (e.g. "FENGYUN 1C") are dead payloads.
    let kind = s.kind;
    if (kind === 'DEBRIS' && !/\bDEB\b/.test(o.OBJECT_NAME)) kind = 'DEFUNCT';
    rows.push([...FIELDS.map((f) => o[f]), kind]);
  }
}

const epochs = rows.map((r) => Date.parse(r[3] + 'Z')).sort((a, b) => a - b);
const snapshot = {
  source: 'CelesTrak GP (public), https://celestrak.org',
  fetchedAt: new Date().toISOString(),
  medianEpoch: new Date(epochs[Math.floor(epochs.length / 2)]).toISOString(),
  fields: [...FIELDS, 'KIND'],
  rows,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(snapshot));
console.log(`wrote ${rows.length} objects to ${OUT} (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB)`);
