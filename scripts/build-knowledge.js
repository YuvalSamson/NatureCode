#!/usr/bin/env node
// ============================================================
//  scripts/build-knowledge.js
//  מזקק חוברות אונטולוגיה לכרטיסי ידע קומפקטיים.
//
//  החוברות ב-ontology/xlsx/ הן מקור האמת ולעולם אינן נטענות
//  לפרומפט. הכרטיסים ב-knowledge/ הם האינדקס שכן נטען.
//
//  שימוש:
//    node scripts/build-knowledge.js            בונה הכול
//    node scripts/build-knowledge.js repair     בונה כרטיס אחד
// ============================================================

const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const XLSX_DIR = path.join(ROOT, "ontology", "xlsx");
const OUT_DIR = path.join(ROOT, "knowledge");

const MANIFEST = require("./ontology-manifest.json");

//  תקרת התו לכל תא. שומרת על גודל הכרטיס.
const CELL_CAP = 200;
//  תקרת התו לכל כרטיס. נקבעת במניפסט לכל כרטיס בנפרד, כי לאונטולוגיה
//  רחבה מגיע יותר מקום. חריגה נרשמת כאזהרה — לא נכשלת בשקט.
const CARD_CAP_DEFAULT = 15000;

// ---------------------------------------------------------------- utilities

function readSheet(wb, sheetName) {
  const ws = wb.Sheets[sheetName];
  if (!ws) return null;
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", blankrows: true });
  return grid.map(r => r.map(c => (c === null || c === undefined ? "" : String(c).trim())));
}

//  שורת הכותרת אינה תמיד ראשונה — לחוברות יש כותרת וכותרת משנה.
//  מזוהה כשורה הראשונה עם ארבעה תאים מלאים שאחריה שורת נתונים.
function findHeaderRow(grid, minCols) {
  const need = minCols || 4;
  const limit = Math.min(grid.length - 1, 10);
  for (let i = 0; i < limit; i++) {
    const a = grid[i].filter(x => x).length;
    const b = (grid[i + 1] || []).filter(x => x).length;
    if (a >= need && b >= need) return i;
  }
  return -1;
}

//  גיליון של שני טורים — מפתח והסבר. אין לו כותרת אמיתית,
//  ולכן הוא נפלט כרשימת הגדרות ולא כטבלה.
function buildKeyValue(wb, spec, warnings) {
  const grid = readSheet(wb, spec.sheet);
  if (!grid) { warnings.push(`sheet not found: ${spec.sheet}`); return null; }
  const lines = [];
  for (let i = (spec.skipRows || 0); i < grid.length; i++) {
    const k = (grid[i][0] || "").trim();
    const v = (grid[i][1] || "").trim();
    if (!k && !v) continue;
    if (!v) { lines.push(`- **${cap(k, 160)}**`); continue; }
    lines.push(`- **${cap(k, 80)}** — ${cap(v, spec.cap || 240)}`);
    if (spec.maxRows && lines.length >= spec.maxRows) break;
  }
  return lines.length ? { md: lines.join("\n"), rows: lines.length } : null;
}

//  התאמת עמודה לפי מחרוזת חלקית, לא לפי שם מדויק — שמות העמודות
//  משתנים מעט בין חוברות ואסור שהבנייה תישבר בגלל ניסוח.
function findCol(header, needles) {
  const lower = header.map(h => h.toLowerCase());
  for (const needle of needles) {
    const n = needle.toLowerCase();
    let idx = lower.findIndex(h => h === n);
    if (idx >= 0) return idx;
    idx = lower.findIndex(h => h.includes(n));
    if (idx >= 0) return idx;
  }
  return -1;
}

function cap(text, n = CELL_CAP) {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= n ? clean : clean.slice(0, n - 1).trimEnd() + "…";
}

function mdEscape(text) {
  return text.replace(/\|/g, "\\|");
}

// ------------------------------------------------------------ section build

//  בונה טבלת מרקדאון משורות גיליון, לפי העמודות שהמניפסט ביקש.
function buildTable(wb, spec, warnings) {
  const grid = readSheet(wb, spec.sheet);
  if (!grid) {
    warnings.push(`sheet not found: ${spec.sheet}`);
    return null;
  }
  const h = findHeaderRow(grid, spec.minCols);
  if (h < 0) {
    warnings.push(`no header row detected in: ${spec.sheet}`);
    return null;
  }
  const header = grid[h];

  const cols = spec.columns.map(c => {
    const idx = findCol(header, c.match);
    if (idx < 0) warnings.push(`column not found in ${spec.sheet}: ${c.match[0]}`);
    return { label: c.label, idx, capChars: c.cap || CELL_CAP };
  }).filter(c => c.idx >= 0);

  if (!cols.length) return null;

  const body = [];
  for (let i = h + 1; i < grid.length; i++) {
    const row = grid[i];
    if (!row.filter(x => x).length) continue;
    const cells = cols.map(c => mdEscape(cap(row[c.idx] || "", c.capChars)));
    if (!cells.filter(x => x).length) continue;
    body.push(cells);
    if (spec.maxRows && body.length >= spec.maxRows) break;
  }
  if (!body.length) return null;

  const lines = [];
  lines.push("| " + cols.map(c => c.label).join(" | ") + " |");
  lines.push("|" + cols.map(() => "---").join("|") + "|");
  for (const r of body) lines.push("| " + r.join(" | ") + " |");
  return { md: lines.join("\n"), rows: body.length };
}

//  ספירת שורות נתונים בגיליון — לשורת מצביע המקורות.
function countRows(wb, sheetName) {
  const grid = readSheet(wb, sheetName);
  if (!grid) return 0;
  const h = findHeaderRow(grid);
  if (h < 0) return 0;
  let n = 0;
  for (let i = h + 1; i < grid.length; i++) {
    if (grid[i].filter(x => x).length) n++;
  }
  return n;
}

// ------------------------------------------------------------- card builder

function buildCard(entry) {
  const warnings = [];
  const file = path.join(XLSX_DIR, entry.workbook);
  if (!fs.existsSync(file)) {
    return { error: `workbook missing: ${entry.workbook}` };
  }
  const wb = XLSX.readFile(file);

  const out = [];
  out.push(`# ${entry.title}`);
  out.push("");
  out.push(`**Card ${entry.code} · source workbook \`ontology/xlsx/${entry.workbook}\` · generated by \`scripts/build-knowledge.js\` — do not edit by hand.**`);
  out.push("");

  out.push("## Scope boundary");
  out.push("");
  out.push(entry.scope);
  out.push("");

  for (const section of entry.sections) {
    const t = section.type === "kv"
      ? buildKeyValue(wb, section, warnings)
      : buildTable(wb, section, warnings);
    if (!t) continue;
    out.push(`## ${section.title}`);
    out.push("");
    if (section.note) { out.push(section.note); out.push(""); }
    out.push(t.md);
    out.push("");
  }

  // ---- source pointer
  out.push("## Sources");
  out.push("");
  const counts = (entry.sourceSheets || []).map(s => {
    const n = countRows(wb, s);
    return n ? `${n} rows in \`${s}\`` : null;
  }).filter(Boolean);
  out.push(
    (counts.length
      ? `The evidence base for this card is ${counts.join(", ")}, held in \`ontology/xlsx/${entry.workbook}\`. `
      : `The evidence base for this card is held in \`ontology/xlsx/${entry.workbook}\`. `) +
    "That workbook is not loaded into this prompt. Cite only what is recorded there or what a live search verifies. " +
    "Never invent a citation, a DOI or a URL. Where a row is marked as unverified or estimated, say so rather than presenting it as established."
  );
  out.push("");
  out.push("This card is an index of a seed, not a boundary. A strategy code here is a pointer to verify, not a finding. Every direction built on it is still checked against current literature, patents and manufacturer data before it reaches the founder.");
  out.push("");

  const md = out.join("\n");
  return { md, warnings, bytes: Buffer.byteLength(md, "utf8") };
}

// --------------------------------------------------------------------- main

function main() {
  const only = process.argv[2];
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  let total = 0;
  const report = [];

  for (const entry of MANIFEST.ontologies) {
    if (only && entry.key !== only) continue;
    const result = buildCard(entry);
    if (result.error) {
      console.error(`  FAIL  ${entry.file} — ${result.error}`);
      continue;
    }
    fs.writeFileSync(path.join(OUT_DIR, entry.file), result.md, "utf8");
    total += result.bytes;
    const kb = (result.bytes / 1024).toFixed(1);
    const budget = entry.budget || CARD_CAP_DEFAULT;
    const flag = result.bytes > budget ? `  OVER BUDGET (${(budget / 1024).toFixed(0)} KB)` : "";
    console.log(`  ok    ${entry.file}  ${kb} KB${flag}`);
    for (const w of result.warnings) console.warn(`        warn: ${w}`);
    report.push({ file: entry.file, bytes: result.bytes, warnings: result.warnings.length });
  }

  console.log("");
  console.log(`  distilled ${report.length} cards, ${(total / 1024).toFixed(1)} KB total, roughly ${Math.round(total / 3.7 / 1000)}k tokens.`);
  console.log("  hand-written files 01–05 are not touched by this script.");
  console.log("  POST /api/reload-knowledge to load without a redeploy.");
}

main();
