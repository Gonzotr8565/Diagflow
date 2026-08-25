const fs = require('fs');
const path = require('path');

const client = fs.readFileSync(
  path.resolve(__dirname, '..', 'public', 'index.html'),
  'utf8'
);

const requiredChecks = [
  ['source signature state', 'const [aiAnalysisSourceSignature, setAiAnalysisSourceSignature]'],
  ['Step 1-10 evidence signature', 'const buildAIReviewSourceSignature = () =>'],
  ['signature captured before request', 'const requestedSourceSignature = buildAIReviewSourceSignature()'],
  ['saved-source comparison', 'stepNotes.__diagflowAIReviewSourceSignature === aiAnalysisSourceSignature'],
  ['managed review start marker', '--- AI REPORT — managed by DiagFlow ---'],
  ['managed review end marker', '--- END AI REPORT ---'],
  ['technician text preservation', 'technicianText ? `${technicianText}\\n\\n${managedReview}` : managedReview'],
  ['existing report detection', "const hasSavedAIReview = String(stepNotes[11] || '').includes('# DiagFlow AI Checkpoint Review')"],
  ['existing report guidance', 'A saved AI report already exists in Step 11. Generate again after updating Step 1-10 evidence'],
  ['unchanged evidence message', 'A saved AI report already exists for this Step 1-10 content. It was not overwritten.'],
  ['changed evidence message', 'Step 1-10 evidence changed. The previous AI report was replaced in Step 11.']
];

for (const [description, marker] of requiredChecks) {
  if (!client.includes(marker)) {
    throw new Error(`Missing ${description}.`);
  }
}

console.log('AI review overwrite checks passed.');
