/**
 * Builds a printable HTML version of the A7 submission from Markdown.
 * Usage: node scripts/build-a7-report.mjs
 * Then: chrome --headless --no-pdf-header-footer --print-to-pdf=...
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { marked } from "marked";

const root = resolve(process.cwd(), "..");
const markdown = readFileSync(resolve(root, "assignment9_submission.md"), "utf8");
const body = marked.parse(markdown, { async: false });

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>A7 — Evaluate and Improve Your AI Capability</title>
<meta name="author" content="Phyo Sithu (6731503082)" />
<style>
  @page { size: A4; margin: 15mm 15mm; }
  * { box-sizing: border-box; }
  html, body { height: auto; }
  body {
    font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    font-size: 9.7pt;
    line-height: 1.38;
    color: #17202a;
    max-width: 100%;
    margin: 0;
  }
  h1 { font-size: 19pt; line-height: 1.2; margin: 0 0 9px; color: #0b3d6b; }
  h2 { font-size: 12.9pt; margin: 17px 0 6px; padding-bottom: 4px; border-bottom: 2px solid #d6e2ee; color: #0b3d6b; page-break-after: avoid; }
  h3 { font-size: 11.1pt; margin: 13px 0 5px; color: #123; page-break-after: avoid; }
  p, li { orphans: 3; widows: 3; }
  code {
    font-family: Consolas, "Courier New", monospace;
    font-size: 8.5pt;
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
    padding: 8px 10px;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    page-break-inside: avoid;
  }
  pre code { background: none; padding: 0; font-size: 7.9pt; line-height: 1.35; }
  table { border-collapse: collapse; width: 100%; margin: 7px 0 11px; font-size: 7.8pt; }
  th, td { border: 1px solid #cbd5df; padding: 4px 5px; vertical-align: top; text-align: left; }
  th { background: #eaf2f8; font-weight: 600; }
  tr { page-break-inside: avoid; }
  blockquote {
    margin: 9px 0;
    padding: 8px 12px;
    background: #eef6fb;
    border-left: 3px solid #0b6fa4;
    color: #233;
  }
  blockquote p { margin: 0; }
  a { color: #0b5d8c; text-decoration: none; }
  hr { border: none; border-top: 1px solid #dde4ea; margin: 16px 0; }
  ul, ol { margin: 5px 0 9px; padding-left: 21px; }
  li { margin: 3px 0; }
  strong { color: #102a3a; }
  h2 + p, h3 + p { margin-top: 4px; }
  h2:last-of-type + ul { page-break-inside: avoid; }
  body > :last-child { margin-bottom: 0; page-break-after: avoid; }
</style>
</head>
<body>
${body}
</body>
</html>`;

writeFileSync(resolve(root, "assignment9_submission.html"), html);
console.log("Wrote assignment9_submission.html");
