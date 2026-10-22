/**
 * Builds a printable HTML version of the submission from Markdown.
 * Usage: node scripts/build-report.mjs
 * Then: chrome --headless --print-to-pdf=...
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { marked } from "marked";

const root = resolve(process.cwd(), "..");
const markdown = readFileSync(resolve(root, "assignment8_submission.md"), "utf8");
const body = marked.parse(markdown, { async: false });

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>A6 — Customer Inquiry Classification with Jev</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    font-size: 10.5pt;
    line-height: 1.48;
    color: #17202a;
    max-width: 100%;
    margin: 0;
  }
  h1 { font-size: 21pt; line-height: 1.2; margin: 0 0 10px; color: #0b3d6b; }
  h2 { font-size: 14pt; margin: 24px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #d6e2ee; color: #0b3d6b; page-break-after: avoid; }
  h3 { font-size: 11.5pt; margin: 16px 0 6px; color: #123; page-break-after: avoid; }
  p, li { orphans: 3; widows: 3; }
  code {
    font-family: Consolas, "Courier New", monospace;
    font-size: 8.8pt;
    background: #f2f5f8;
    padding: 1px 4px;
    border-radius: 3px;
    word-break: break-word;
  }
  pre {
    background: #f6f8fa;
    border: 1px solid #dde4ea;
    border-left: 3px solid #0b6fa4;
    border-radius: 4px;
    padding: 9px 11px;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    page-break-inside: avoid;
  }
  pre code { background: none; padding: 0; font-size: 8.2pt; line-height: 1.4; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0 14px; font-size: 8.6pt; }
  th, td { border: 1px solid #cbd5df; padding: 5px 6px; vertical-align: top; text-align: left; }
  th { background: #eaf2f8; font-weight: 600; }
  tr { page-break-inside: avoid; }
  blockquote {
    margin: 10px 0;
    padding: 8px 12px;
    background: #eef6fb;
    border-left: 3px solid #0b6fa4;
    color: #233;
  }
  blockquote p { margin: 0; }
  a { color: #0b5d8c; text-decoration: none; }
  hr { border: none; border-top: 1px solid #dde4ea; margin: 18px 0; }
  ul, ol { margin: 6px 0 10px; padding-left: 22px; }
  li { margin: 3px 0; }
  strong { color: #102a3a; }
  h2 + p, h3 + p { margin-top: 4px; }
</style>
</head>
<body>
${body}
</body>
</html>`;

writeFileSync(resolve(root, "assignment8_submission.html"), html);
console.log("Wrote assignment8_submission.html");
