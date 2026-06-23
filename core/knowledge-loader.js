// ============================================================
//  core/knowledge-loader.js
//  הגרעין התשתיתי — מרכיב את שלושת קבצי הידע לבלוק יציב אחד.
//
//  הבלוק המורכב הוא ה-system שנשלח לאדונטרופיק ונשמר במטמון.
//  הקבצים נקראים פעם אחת לזיכרון באתחול (loadKnowledge),
//  כדי שלא ייקראו מהדיסק בכל בקשה.
//
//  סדר ההרכבה קובע את המטמון: מהיציב ביותר למכוונן —
//  identity → flow → rules.
// ============================================================

const fs = require("fs");
const path = require("path");

const KNOWLEDGE_DIR = path.join(__dirname, "..", "knowledge");
const FILES = ["01-identity.md", "02-flow.md", "03-rules.md"];
const SEPARATOR = "\n\n";

let cachedKnowledge = null;

// קורא ומרכיב את שלושת הקבצים. נקרא פעם אחת באתחול.
function loadKnowledge() {
  const parts = FILES.map((file) => {
    const full = path.join(KNOWLEDGE_DIR, file);
    return fs.readFileSync(full, "utf8").trim();
  });
  cachedKnowledge = parts.join(SEPARATOR);
  return cachedKnowledge;
}

// מחזיר את בלוק הידע המורכב (מהזיכרון).
function getKnowledge() {
  if (cachedKnowledge === null) {
    return loadKnowledge();
  }
  return cachedKnowledge;
}

// טוען מחדש מהדיסק — שימושי אחרי שיפור המודל בלי הפעלה מחדש.
function reloadKnowledge() {
  return loadKnowledge();
}

module.exports = { loadKnowledge, getKnowledge, reloadKnowledge };
