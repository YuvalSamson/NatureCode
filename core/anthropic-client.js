// ============================================================
//  core/anthropic-client.js
//  הגרעין התשתיתי — הקריאה אל אנתרופיק.
//  אינו יודע דבר על מהות הטבע. מקבל את בלוק הידע וההודעות כפרמטרים.
//
//  שלושה מנגנונים:
//  1. prompt caching — בלוק הידע היציב מסומן ב-cache_control ונקרא במחיר מוזל.
//  2. חשיבה מורחבת — המנוע חושב לפני שהוא עונה, והחשיבה מוחזרת לתצוגה.
//  3. חיפוש רשת — המנוע בודק ידע קודם ומקורות חיים לפני שהוא מציע כיוון.
// ============================================================

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-opus-4-8";

//  חשיבה מורחבת דורשת max_tokens גדול מ-thinking budget.
const DEFAULT_MAX_TOKENS = 16000;
const DEFAULT_THINKING_BUDGET = 8000;

//  מספר החיפושים המרבי לתשובה. נדרש למיפוי הפתרונות הקיימים בתחום
//  (מספר מתחרים, חולשות, ופטנטים) ולאימות מקורות.
const DEFAULT_MAX_SEARCHES = 12;

/**
 * שולח בקשה לאנתרופיק.
 * @param {Object} opts
 * @param {string} opts.apiKey - מפתח ה-API (מהסביבה)
 * @param {string} opts.systemStable - בלוק הידע היציב (נשמר במטמון)
 * @param {string} [opts.systemVolatile] - הנחיה משתנה (שפה) — מחוץ למטמון
 * @param {Array}  opts.messages - היסטוריית השיחה + ההודעה החדשה
 * @param {string} [opts.model]
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.thinkingBudget] - 0 מכבה חשיבה מורחבת
 * @param {boolean} [opts.webSearch] - false מכבה חיפוש רשת
 * @returns {Promise<{status:number, data:object}>}
 */
async function askClaude({
  apiKey,
  systemStable,
  systemVolatile,
  messages,
  model,
  maxTokens,
  thinkingBudget,
  webSearch,
}) {
  if (!apiKey) {
    return { status: 500, data: { error: "Missing ANTHROPIC_API_KEY on the server" } };
  }

  //  סדר חשוב: הבלוק היציב ראשון ומסומן במטמון. הנחיית השפה נוספת
  //  אחריו בלי סימון — כך החלפת שפה אינה פוסלת את המטמון של הידע.
  const system = [
    {
      type: "text",
      text: systemStable,
      cache_control: { type: "ephemeral" },
    },
  ];
  if (systemVolatile) {
    system.push({ type: "text", text: systemVolatile });
  }

  const budget = thinkingBudget === undefined ? DEFAULT_THINKING_BUDGET : thinkingBudget;
  const tokens = maxTokens || DEFAULT_MAX_TOKENS;

  const body = {
    model: model || DEFAULT_MODEL,
    max_tokens: tokens,
    system,
    messages,
  };

  //  חשיבה מורחבת — המנוע בודק, שוקל ופוסל לפני שהוא עונה.
  //  התקציב חייב להיות קטן מ-max_tokens.
  if (budget > 0) {
    body.thinking = {
      type: "enabled",
      budget_tokens: Math.min(budget, tokens - 1024),
    };
  }

  //  חיפוש רשת — לבדיקת ידע קודם, פטנטים ומקורות אקדמיים.
  //  בלי זה המנוע לא יכול לדעת מי כבר ניסה את הרעיון.
  if (webSearch !== false) {
    body.tools = [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: DEFAULT_MAX_SEARCHES,
      },
    ];
  }

  try {
    const upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });
    const data = await upstream.json();
    return { status: upstream.status, data };
  } catch (e) {
    return { status: 502, data: { error: "proxy request failed", detail: String(e) } };
  }
}

module.exports = {
  askClaude,
  DEFAULT_MODEL,
  DEFAULT_MAX_TOKENS,
  DEFAULT_THINKING_BUDGET,
};
