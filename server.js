// ============================================================
//  server.js
//  נקודת הכניסה — מחברת את הגרעין לדף ולמסד.
//  גרסה אחת חיה. הידע מורכב מכל קובצי knowledge/ לפי סדר שמותיהם,
//  ונשמר במטמון. הוספת קובץ ידע אינה דורשת שינוי כאן.
// ============================================================

const express = require("express");
const path = require("path");

try { require("dotenv").config(); } catch (e) { /* dotenv optional */ }

const { askClaude, streamClaude, DEFAULT_MODEL, DEFAULT_MAX_TOKENS, DEFAULT_THINKING_BUDGET } = require("./core/anthropic-client");
const { initDb, getChats, getChat, upsertChat, deleteChat } = require("./core/db");
const { loadKnowledge, getKnowledge, reloadKnowledge, getKnowledgeMeta } = require("./core/knowledge-loader");

//  גרסת המנוע. העלה אותה כשמשנים לוגיקה בשרת או בגרעין.
//  גרסת הידע אינה מוגדרת כאן — היא מחושבת מתוכן קובצי הידע
//  עצמם, ולכן אי אפשר לשכוח לעדכן אותה.
const ENGINE_VERSION = "11.1";

const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

app.use(express.json({ limit: "8mb" }));

//  הדף הראשי — מוגדר לפני ההגשה הסטטית, ולא אחריה. כשההגשה
//  הסטטית קודמת, היא זו שפותרת את "/" בעצמה, והמסלול המפורש
//  שמתחתיה אינו נקרא כלל. הסדר הזה מבטיח שהשורש תמיד index.html.
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

//  index:false מכבה את פתרון ברירת המחדל של התיקייה, כדי שלא
//  תהיה דרך שנייה להגיע לדף הראשי. גרסת הפיתוח נשארת נגישה
//  בשמה המפורש בלבד.
app.use(express.static(path.join(__dirname, "public"), { index: false }));

// ---------- ניהול שיחות ----------
// ============================================================
//  הזרמה בזמן אמת.
//  השרת קורא את זרם האירועים של אנתרופיק ומעביר לדפדפן רק את מה
//  שהוחלט שבטוח לחשוף: שלב העבודה, שאילתות החיפוש, החשיבה והטקסט.
//  מבנה הבקשה, בלוק הידע והמודל לעולם אינם עוברים לדפדפן.
// ============================================================
app.post("/api/ask-stream", async (req, res) => {
  const { messages, model, maxTokens, lang, thinkingBudget, webSearch } = req.body || {};

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");   // מונע באפרינג בפרוקסי של רנדר
  if (res.flushHeaders) res.flushHeaders();

  const send = (obj) => {
    try { res.write("data: " + JSON.stringify(obj) + "\n\n"); } catch (e) {}
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    send({ type: "error", message: "messages array is required" });
    return res.end();
  }
  if (!ANTHROPIC_API_KEY) {
    console.error("ASK-STREAM FAILED: ANTHROPIC_API_KEY is not set");
    send({ type: "error", message: "ANTHROPIC_API_KEY is not set on the server" });
    return res.end();
  }

  const langCode = lang || DEFAULT_LANGUAGE;
  const langName = LANGUAGES[langCode] || LANGUAGES[DEFAULT_LANGUAGE];
  const systemVolatile =
    "RESPONSE LANGUAGE: Write every turn in " + langName +
    ". Keep the same tight, concrete, low-reading style in that language — do not lengthen turns when translating. " +
    "If the user writes in a different language, follow the user's language instead.";

  const result = await streamClaude({
    apiKey: ANTHROPIC_API_KEY,
    systemStable: getKnowledge(),
    systemVolatile,
    messages,
    model: model || DEFAULT_MODEL,
    maxTokens: maxTokens || DEFAULT_MAX_TOKENS,
    thinkingBudget: thinkingBudget === undefined ? DEFAULT_THINKING_BUDGET : thinkingBudget,
    webSearch: webSearch !== false,
  });

  if (!result.ok) {
    console.error("ASK-STREAM FAILED:", result.status, JSON.stringify(result.error));
    send({ type: "error", message: (result.error && result.error.message) || "request failed" });
    return res.end();
  }

  send({ type: "status", stage: "start" });

  //  צובר קלט חלקי של קריאות כלי, כדי לחלץ את שאילתת החיפוש
  //  רק כשהיא שלמה.
  let toolJson = "";
  let inTool = false;
  let searchCount = 0;
  let sawText = false;

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for await (const chunk of result.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";

      for (const part of parts) {
        const line = part.split("\n").find(l => l.startsWith("data:"));
        if (!line) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        let ev;
        try { ev = JSON.parse(payload); } catch (e) { continue; }

        if (ev.type === "content_block_start") {
          const b = ev.content_block || {};
          if (b.type === "thinking") {
            send({ type: "status", stage: "thinking" });
          } else if (b.type === "server_tool_use") {
            inTool = true; toolJson = "";
            send({ type: "status", stage: "searching" });
          } else if (b.type === "web_search_tool_result") {
            send({ type: "status", stage: "reading" });
          } else if (b.type === "text") {
            if (!sawText) { sawText = true; send({ type: "status", stage: "writing" }); }
          }
        }

        else if (ev.type === "content_block_delta") {
          const d = ev.delta || {};
          if (d.type === "thinking_delta" && d.thinking) {
            send({ type: "thinking_delta", text: d.thinking });
          } else if (d.type === "text_delta" && d.text) {
            send({ type: "text_delta", text: d.text });
          } else if (d.type === "input_json_delta" && inTool) {
            toolJson += d.partial_json || "";
          }
        }

        else if (ev.type === "content_block_stop") {
          if (inTool) {
            inTool = false;
            try {
              const parsed = JSON.parse(toolJson || "{}");
              if (parsed.query) {
                searchCount++;
                send({ type: "search", query: String(parsed.query), n: searchCount });
                //  אחרי כמה חיפושים, המנוע בדרך כלל עובר לבדיקת בשלות.
                //  מבוסס על שאילתת החיפוש עצמה, לא על טיימר.
                const q = String(parsed.query).toLowerCase();
                if (/pilot|scale|manufactur|production|supplier|commercial|yield|trl/.test(q)) {
                  send({ type: "status", stage: "maturity" });
                } else if (/constraint|cost|temperature|regulat|standard|environment|condition/.test(q)) {
                  send({ type: "status", stage: "context" });
                }
              }
            } catch (e) {}
            toolJson = "";
          }
        }

        else if (ev.type === "error") {
          send({ type: "error", message: (ev.error && ev.error.message) || "stream error" });
        }
      }
    }
    send({ type: "done", searches: searchCount });
  } catch (e) {
    console.error("ASK-STREAM EXCEPTION:", String(e));
    send({ type: "error", message: String(e) });
  }
  res.end();
});

app.get("/api/chats", async (req, res) => {
  try {
    const chats = await getChats(req.query.variant);
    res.json(chats);
  } catch (e) {
    res.status(500).json({ error: "failed to load chats", detail: String(e) });
  }
});

app.get("/api/chats/:id", async (req, res) => {
  try {
    const chat = await getChat(req.params.id);
    if (!chat) return res.status(404).json({ error: "chat not found" });
    res.json(chat);
  } catch (e) {
    res.status(500).json({ error: "failed to load chat", detail: String(e) });
  }
});

app.put("/api/chats/:id", async (req, res) => {
  const id = req.params.id;
  const incoming = req.body;
  if (!incoming || incoming.id !== id) {
    return res.status(400).json({ error: "chat id mismatch" });
  }
  try {
    await upsertChat(incoming);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "failed to save chat", detail: String(e) });
  }
});

app.delete("/api/chats/:id", async (req, res) => {
  try {
    await deleteChat(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "failed to delete chat", detail: String(e) });
  }
});

// ---------- שאילתה למנוע ----------
//  הדף שולח רק messages (היסטוריה + הודעה חדשה).
//  השרת מצרף את בלוק הידע היציב (system) ושולח לקלוד.
//  קוד השפה מגיע מהדף; הנחיית השפה מורכבת כאן, בשרת.
//  היא נשלחת כבלוק system נפרד ולא מסומן במטמון, כדי שבלוק הידע
//  היציב יישאר זהה בין השפות והמטמון לא יישבר בכל החלפה.
const LANGUAGES = { en: "English", he: "Hebrew" };
const DEFAULT_LANGUAGE = "en";

app.post("/api/ask", async (req, res) => {
  try {
    const { messages, model, maxTokens, lang, thinkingBudget, webSearch } = req.body;
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: { type: "bad_request", message: "messages array is required" } });
    }
    if (!ANTHROPIC_API_KEY) {
      console.error("ASK FAILED: ANTHROPIC_API_KEY is not set on the server");
      return res.status(500).json({
        error: { type: "config_error", message: "ANTHROPIC_API_KEY is not set on the server" },
      });
    }
    const langName = LANGUAGES[lang] || LANGUAGES[DEFAULT_LANGUAGE];
    const systemStable = getKnowledge();
    const systemVolatile =
      "RESPONSE LANGUAGE: Write every turn in " + langName +
      ". Keep the same tight, concrete, low-reading style in that language — do not lengthen turns when translating. " +
      "If the user writes in a different language, follow the user's language instead.";
    const result = await askClaude({
      apiKey: ANTHROPIC_API_KEY,
      systemStable,
      systemVolatile,
      messages,
      model: model || DEFAULT_MODEL,
      maxTokens: maxTokens || DEFAULT_MAX_TOKENS,
      thinkingBudget: thinkingBudget === undefined ? DEFAULT_THINKING_BUDGET : thinkingBudget,
      webSearch: webSearch !== false,
    });
    //  רישום שגיאות במפורש — בלי זה אי אפשר לאבחן תקלה בפריסה.
    if (result.status < 200 || result.status >= 300) {
      console.error("ASK FAILED:", result.status,
        JSON.stringify(result.data && result.data.error) || "(no error body)");
    }
    res.status(result.status).json(result.data);
  } catch (e) {
    console.error("ASK EXCEPTION:", String(e));
    res.status(502).json({ error: { type: "server_error", message: String(e) } });
  }
});

// ---------- גרסאות ----------
//  הדף מציג שלוש גרסאות. את שלו הוא מכיר בעצמו; שתי אלה
//  נמשכות מכאן בזמן ריצה, ולכן אינן יכולות להציג מספר ישן.
//  לא נחשף שום תוכן ידע — רק ספירה וטביעת אצבע.
app.get("/api/version", (req, res) => {
  try {
    const meta = getKnowledgeMeta();
    res.json({
      engine: ENGINE_VERSION,
      knowledge: meta.version,
      knowledgeDetail: {
        files: meta.files,
        bytes: meta.bytes,
        approxTokens: meta.approxTokens,
        hash: meta.hash,
        loadedAt: meta.loadedAt,
      },
    });
  } catch (e) {
    console.error("VERSION FAILED:", String(e));
    res.json({ engine: ENGINE_VERSION, knowledge: null });
  }
});

// ---------- טעינת ידע מחדש (אחרי שיפור המודל) ----------
app.post("/api/reload-knowledge", (req, res) => {
  try {
    reloadKnowledge();
    //  מחזיר את טביעת האצבע החדשה — כך רואים מיד אם הרענון תפס.
    const meta = getKnowledgeMeta();
    res.json({ ok: true, message: "knowledge reloaded", knowledge: meta.version });
  } catch (e) {
    res.status(500).json({ error: "reload failed", detail: String(e) });
  }
});

// ---------- אתחול ----------
//  מדפיס איזו גרסה יושבת בכל אחד מקובצי הדף. בלי זה, קובץ
//  שהועתק בטעות נראה בדיוק כמו קובץ תקין, והבלבול מתגלה רק
//  בדפדפן.
function reportPages() {
  const fs = require("fs");
  for (const name of ["index.html", "index-dev.html"]) {
    const file = path.join(__dirname, "public", name);
    try {
      const text = fs.readFileSync(file, "utf8");
      const ver = (text.match(/SITE_VERSION\s*=\s*"([^"]+)"/) || [])[1] || "?";
      const picker = (text.match(/SHOW_MODEL_PICKER\s*=\s*(true|false)/) || [])[1] || "?";
      console.log("   " + name + "  version " + ver + "  model picker " + picker);
    } catch (e) {
      console.warn("   " + name + "  MISSING");
    }
  }
}

async function start() {
  loadKnowledge();
  console.log("Pages:");
  reportPages();
  try {
    await initDb();
    console.log("DB ready.");
  } catch (e) {
    console.warn("WARNING: DB init failed —", String(e));
  }
  app.listen(PORT, () => {
    console.log("Nature Engine v" + ENGINE_VERSION + " running on http://localhost:" + PORT);
    if (!ANTHROPIC_API_KEY) {
      console.warn("WARNING: ANTHROPIC_API_KEY is not set — /api/ask will fail until you set it.");
    }
    if (!process.env.DATABASE_URL) {
      console.warn("WARNING: DATABASE_URL is not set — chat storage will fail until you set it.");
    }
  });
}

start();
