// ============================================================
//  core/anthropic-client.js
//  הגרעין התשתיתי — הקריאה אל אדונטרופיק.
//  אינו יודע דבר על "גרסה" או על מהות הטבע.
//  מקבל את בלוק הידע (system) ואת ההודעות כפרמטרים בלבד.
//
//  מיישם prompt caching: בלוק הידע היציב מסומן ב-cache_control,
//  כך שבקריאות חוזרות הוא נקרא במחיר מוזל (כ-10% מטוקן רגיל).
// ============================================================

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-opus-4-8";
const DEFAULT_MAX_TOKENS = 4096;

/**
 * שולח בקשה לאדונטרופיק.
 * @param {Object} opts
 * @param {string} opts.apiKey - מפתח ה-API (מהסביבה)
 * @param {string} opts.systemStable - בלוק הידע היציב (נשמר במטמון)
 * @param {Array}  opts.messages - היסטוריית השיחה + ההודעה החדשה
 * @param {string} [opts.model]
 * @param {number} [opts.maxTokens]
 * @returns {Promise<{status:number, data:object}>}
 */
async function askClaude({ apiKey, systemStable, messages, model, maxTokens }) {
  if (!apiKey) {
    return { status: 500, data: { error: "Missing ANTHROPIC_API_KEY on the server" } };
  }

  // בלוק ה-system כמערך: הבלוק היציב מסומן ב-cache_control.
  // כל מה שלפני הסימון (כאן: בלוק הידע כולו) נשמר במטמון.
  const system = [
    {
      type: "text",
      text: systemStable,
      cache_control: { type: "ephemeral" },
    },
  ];

  const body = {
    model: model || DEFAULT_MODEL,
    max_tokens: maxTokens || DEFAULT_MAX_TOKENS,
    system,
    messages,
  };

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

module.exports = { askClaude, DEFAULT_MODEL, DEFAULT_MAX_TOKENS };
