
// ============================================================
//  core/knowledge-loader.js
//  טוען את בלוק הידע היציב מתיקיית knowledge/.
//
//  סורק את התיקייה לפי סדר שמות הקבצים — לא לפי רשימה קבועה.
//  לכן הוספת אונטולוגיה חדשה היא הנחת קובץ בתיקייה, בלי נגיעה בקוד.
//  הקבצים 01–05 נכתבים ביד; הקבצים מ-10 ומעלה נוצרים במזקק.
//
//  בנוסף מחשב "גרסת ידע" — טביעת אצבע של התוכן בפועל. היא
//  משתנה מאליה בכל שינוי בקובץ ידע, ולכן אי אפשר לשכוח לעדכן
//  אותה ידנית ולהציג בסרגל מספר שאינו נכון.
// ============================================================

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const KNOWLEDGE_DIR = path.join(__dirname, "..", "knowledge");

let cache = null;
let meta = null;

function readAll() {
  if (!fs.existsSync(KNOWLEDGE_DIR)) {
    throw new Error("knowledge directory not found: " + KNOWLEDGE_DIR);
  }

  //  סדר לקסיקוגרפי. המספור בשמות הקבצים הוא שקובע את סדר הבלוק.
  const files = fs
    .readdirSync(KNOWLEDGE_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();

  if (!files.length) {
    throw new Error("no .md files found in " + KNOWLEDGE_DIR);
  }

  const parts = [];
  const report = [];

  for (const name of files) {
    const full = path.join(KNOWLEDGE_DIR, name);
    const text = fs.readFileSync(full, "utf8").trim();
    if (!text) continue;

    //  מפריד מסומן — כך גבול בין קבצים ברור למודל.
    parts.push("<!-- ===== " + name + " ===== -->\n" + text);
    report.push({ name, bytes: Buffer.byteLength(text, "utf8") });
  }

  const combined = parts.join("\n\n---\n\n");
  const bytes = Buffer.byteLength(combined, "utf8");

  //  טביעת אצבע קצרה של התוכן. שישה תווים מספיקים לזיהוי חזותי
  //  של "האם מה שרץ בשרת הוא מה שדחפתי".
  const hash = crypto.createHash("sha256").update(combined).digest("hex").slice(0, 6);

  meta = {
    files: report.length,
    bytes,
    hash,
    approxTokens: Math.round(bytes / 3.7),
    loadedAt: new Date().toISOString(),
    version: report.length + "f\u00B7" + hash,
  };

  //  דוח טעינה. בלעדיו קובץ שלא נטען נראה בדיוק כמו קובץ שנטען.
  console.log("Knowledge loaded — " + report.length + " files, " +
    (bytes / 1024).toFixed(1) + " KB, roughly " +
    Math.round(bytes / 3.7 / 1000) + "k tokens, id " + hash + ":");
  for (const r of report) {
    console.log("   " + r.name + "  " + (r.bytes / 1024).toFixed(1) + " KB");
  }

  return combined;
}

function loadKnowledge() {
  cache = readAll();
  return cache;
}

function getKnowledge() {
  if (cache === null) loadKnowledge();
  return cache;
}

function reloadKnowledge() {
  cache = null;
  return loadKnowledge();
}

//  מטא-נתונים לתצוגה בלבד. אינו חושף שום תוכן ידע.
function getKnowledgeMeta() {
  if (cache === null) loadKnowledge();
  return meta;
}

module.exports = {
  loadKnowledge,
  getKnowledge,
  reloadKnowledge,
  getKnowledgeMeta,
  KNOWLEDGE_DIR,
};