const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');

const activeRouteStart = server.indexOf("'/api/reports/active'");
const activeRouteEnd = server.indexOf("'/api/reports/:id/vehicle-info'", activeRouteStart);
if (activeRouteStart < 0 || activeRouteEnd < 0) {
  throw new Error('Could not locate the active-report recovery route.');
}
const activeRoute = server.slice(activeRouteStart, activeRouteEnd);

if (!activeRoute.includes('step_notes, step_images, parts_request')) {
  throw new Error('Active-report recovery does not select step_images.');
}

if (!client.includes('stepImages: report.step_images || {}')) {
  throw new Error('Client recovery does not map persisted step_images.');
}

if (!client.includes('setStepImages(job.stepImages || {})')) {
  throw new Error('Client restore does not apply recovered step images.');
}

console.log('Image persistence recovery checks passed.');
