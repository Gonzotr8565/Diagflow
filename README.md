DiagFlow — PDF Report Generator (sample)

This repository contains the DiagFlow server and a standalone sample PDF generator.

Quick: generate a sample PDF without running the server

1. From the project root run:

```bash
node scripts/generate-sample-pdf.js
```

2. The script will produce `DiagFlow_Sample_Report.pdf` in the project root.

Requirements

- Node.js (16+ recommended)
- npm install pdfkit (if not already installed). From project root run:

```bash
npm install pdfkit
```

Files added

- `scripts/generate-sample-pdf.js` — standalone script that creates a sample PDF using the same PDF layout used by the server.
- `scripts/commit-changes.ps1` — PowerShell helper to stage and commit changes (Windows).

Commit helper (Windows PowerShell)

To make a quick commit of the generated files and recent edits, run (from project root):

```powershell
.\scripts\commit-changes.ps1 -Message "Describe your changes here"
```

Notes

- The server remains unchanged; use the debug endpoint `/api/debug/generate-sample-pdf` when running the server.
- The standalone script requires `pdfkit` and writes `DiagFlow_Sample_Report.pdf` to the project root.
- If you want the script to output to a different path, edit `scripts/generate-sample-pdf.js`.

If you want, I can create a small git commit (or run it) for you; otherwise push locally when ready.