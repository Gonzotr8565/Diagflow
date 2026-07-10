import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';

const inFile = process.argv[2];
const outFile = process.argv[3];
if (!inFile || !outFile) {
  console.error('Usage: node scripts/md-to-pdf.mjs <input.md> <output.pdf>');
  process.exit(1);
}

const md = readFileSync(resolve(inFile), 'utf8');

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, (_, c) => `<strong>${c}</strong>`);
  t = t.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, (_, p, c) => `${p}<em>${c}</em>`);
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, txt, href) => `<a href="${href}">${txt}</a>`);
  return t;
}

function mdToHtml(src) {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;

  const flushPara = (buf) => {
    if (buf.length) out.push(`<p>${inline(buf.join(' '))}</p>`);
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) { i++; continue; }

    // headings
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }

    // hr
    if (/^---+\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    // table: header row | --- row | data rows
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const parseRow = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
      const header = parseRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(parseRow(lines[i]));
        i++;
      }
      out.push('<table><thead><tr>' + header.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
        '</tbody></table>');
      continue;
    }

    // unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*[-*]\s+/, '');
        i++;
        // continuation lines (indented) get appended
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) {
          item += ' ' + lines[i].trim();
          i++;
        }
        items.push(`<li>${inline(item)}</li>`);
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    // ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*\d+\.\s+/, '');
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) {
          item += ' ' + lines[i].trim();
          i++;
        }
        items.push(`<li>${inline(item)}</li>`);
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    // paragraph (collect until blank or block start)
    const buf = [];
    while (i < lines.length && lines[i].trim() !== '' &&
           !/^#{1,6}\s/.test(lines[i]) &&
           !/^---+\s*$/.test(lines[i]) &&
           !/^\s*[-*]\s+/.test(lines[i]) &&
           !/^\s*\d+\.\s+/.test(lines[i]) &&
           !/^\s*\|.*\|\s*$/.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    flushPara(buf);
  }
  return out.join('\n');
}

const body = mdToHtml(md);
const title = basename(inFile).replace(/\.md$/i, '');

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: Letter; margin: 0.6in 0.7in; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: "Segoe UI", Arial, sans-serif; font-size: 10.5pt; line-height: 1.4; color: #111; }
  h1 { font-size: 20pt; margin: 0 0 6pt; border-bottom: 2px solid #222; padding-bottom: 4pt; page-break-after: avoid; }
  h2 { font-size: 14pt; margin: 18pt 0 6pt; border-bottom: 1px solid #888; padding-bottom: 2pt; page-break-after: avoid; }
  h3 { font-size: 12pt; margin: 12pt 0 4pt; page-break-after: avoid; }
  p, ul, ol { margin: 4pt 0 6pt; }
  ul, ol { padding-left: 22pt; }
  li { margin: 2pt 0; }
  hr { border: none; border-top: 1px solid #bbb; margin: 14pt 0; }
  table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 10pt; page-break-inside: avoid; }
  th, td { border: 1px solid #888; padding: 4pt 6pt; vertical-align: top; text-align: left; }
  th { background: #eee; }
  code { font-family: Consolas, monospace; background: #f3f3f3; padding: 1pt 3pt; border-radius: 2pt; font-size: 9.5pt; }
  strong { color: #000; }
  a { color: #0a58ca; text-decoration: none; }
  h2, h3, table { break-inside: avoid; }
</style></head><body>
${body}
</body></html>`;

const tmp = resolve(tmpdir(), `mdpdf-${Date.now()}.html`);
writeFileSync(tmp, html, 'utf8');

const outAbs = resolve(outFile);
const outDir = dirname(outAbs);
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const args = [
  '--headless=new',
  '--disable-gpu',
  '--no-pdf-header-footer',
  `--print-to-pdf=${outAbs}`,
  `file:///${tmp.replace(/\\/g, '/')}`,
];

const r = spawnSync(edge, args, { stdio: 'inherit' });
if (r.status !== 0) {
  console.error('Edge headless failed with status', r.status);
  process.exit(r.status || 1);
}
console.log('Wrote', outAbs);
