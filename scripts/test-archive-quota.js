const fs = require('fs');
const path = require('path');

const client = fs.readFileSync(
  path.resolve(__dirname, '..', 'public', 'index.html'),
  'utf8'
);

const requiredChecks = [
  ['lightweight archive cache helper', 'const prepareArchiveForLocalCache = reports =>'],
  ['top-level image removal', 'stepImages: {}'],
  ['per-step image removal', 'map(step => ({ ...step, images: [] }))'],
  ['lightweight cache write', 'JSON.stringify(prepareArchiveForLocalCache(newArchive))'],
  ['non-fatal cache handling', 'Cloud archive saved; local archive cache unavailable:'],
  ['active-job cleanup after cache handling', "clearActiveJobSave();\n        console.log('Report archived to Supabase')"]
];

for (const [description, marker] of requiredChecks) {
  if (!client.includes(marker)) {
    throw new Error(`Missing ${description}.`);
  }
}

console.log('Archive quota checks passed.');
