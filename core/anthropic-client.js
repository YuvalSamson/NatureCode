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

//  רמת המאמץ בתחביר החדש. מנוע מחקרי — מאמץ גבוה.
const DEFAULT_EFFORT = "high";

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
  const useSearch = webSearch !== false;

  //  בונה גוף בקשה. הדגלים מאפשרים ניסיון חוזר בלי יכולת שנדחתה.
  //  thinkingMode: "adaptive" (מודלים חדשים) | "budget" (ישנים) | null (ללא)
  function buildBody({ thinkingMode, withEffort, withTools }) {
    const body = {
      model: model || DEFAULT_MODEL,
      max_tokens: tokens,
      system,
      messages,
    };

    if (thinkingMode === "adaptive" && budget > 0) {
      //  התחביר החדש: המודל מחליט כמה לחשוב, ורמת המאמץ נשלטת בנפרד.
      body.thinking = { type: "adaptive" };
      if (withEffort) {
        body.output_config = { effort: DEFAULT_EFFORT };
      }
    } else if (thinkingMode === "budget" && budget > 0) {
      //  התחביר הישן, למודלים שעדיין דורשים תקציב מפורש.
      body.thinking = {
        type: "enabled",
        budget_tokens: Math.min(budget, tokens - 1024),
      };
    }

    if (withTools) {
      body.tools = [
        { type: "web_search_20250305", name: "web_search", max_uses: DEFAULT_MAX_SEARCHES },
      ];
    }
    return body;
  }

  async function callOnce(body) {
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
  }

  //  שגיאה שנובעת מיכולת לא נתמכת (חשיבה, מאמץ, כלי חיפוש) —
  //  להבדיל משגיאת מפתח, מכסה או קלט.
  function isCapabilityError(data) {
    const msg = ((data && data.error && data.error.message) || "").toLowerCase();
    if (!msg) return false;
    return (
      msg.includes("thinking") ||
      msg.includes("effort") ||
      msg.includes("output_config") ||
      msg.includes("tool") ||
      msg.includes("web_search") ||
      msg.includes("max_tokens") ||
      msg.includes("not supported") ||
      msg.includes("unsupported") ||
      msg.includes("unexpected") ||
      msg.includes("invalid_request")
    );
  }

  //  סולם ניסיונות יורד. כל שלב מוותר על יכולת אחת בלבד, כדי לשמור
  //  כמה שיותר מהיכולות שכן נתמכות במודל שבשימוש.
  const attempts = [
    { thinkingMode: "adaptive", withEffort: true,  withTools: useSearch, label: "adaptive+effort+search" },
    { thinkingMode: "adaptive", withEffort: false, withTools: useSearch, label: "adaptive+search" },
    { thinkingMode: "budget",   withEffort: false, withTools: useSearch, label: "budget+search" },
    { thinkingMode: null,       withEffort: false, withTools: useSearch, label: "search-only" },
    { thinkingMode: null,       withEffort: false, withTools: false,     label: "plain" },
  ];

  let last = null;
  try {
    for (const attempt of attempts) {
      const result = await callOnce(buildBody(attempt));
      last = result;

      if (result.status >= 200 && result.status < 300) {
        if (attempt.label !== "adaptive+effort+search") {
          console.warn("Anthropic: succeeded in degraded mode -", attempt.label);
        }
        return result;
      }

      //  שגיאה שאינה קשורה ליכולת (מפתח, מכסה, קלט) — אין טעם לנסות שוב.
      if (!isCapabilityError(result.data)) {
        console.error("Anthropic error (no retry):", result.status,
          JSON.stringify(result.data && result.data.error));
        return result;
      }

      console.warn("Anthropic: attempt '" + attempt.label + "' rejected -",
        (result.data && result.data.error && result.data.error.message) || result.status);
    }
    return last;
  } catch (e) {
    console.error("Anthropic request failed:", String(e));
    return { status: 502, data: { error: { type: "proxy_error", message: String(e) } } };
  }
}

module.exports = {
  askClaude,
  DEFAULT_MODEL,
  DEFAULT_MAX_TOKENS,
  DEFAULT_THINKING_BUDGET,
};
