const fs = require('fs');
const path = require('path');

const client = fs.readFileSync(
  path.resolve(__dirname, '..', 'public', 'index.html'),
  'utf8'
);

const requiredChecks = [
  ['cross-organization response detection', 'response.status === 403'],
  ['explicit adoption confirmation', 'const adoptJob = window.confirm('],
  ['fresh report ID for adopted jobs', 'const adoptedReportId = crypto.randomUUID()'],
  ['single adoption retry guard', 'adoptionAttempted: true'],
  ['archive reads the current ID after save', 'const currentCloudReportId = activeReportIdRef.current || activeReportId']
];

for (const [description, marker] of requiredChecks) {
  if (!client.includes(marker)) {
    throw new Error(`Missing ${description}.`);
  }
}

console.log('Job ownership recovery checks passed.');
