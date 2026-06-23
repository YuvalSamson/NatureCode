// ============================================================
//  server.js
//  נקודת הכניסה — מחברת את הגרעין לדף ולמסד.
//  גרסה אחת חיה. הידע מורכב משלושת קבצי knowledge/ ונשמר במטמון.
// ============================================================

const express = require("express");
const path = require("path");

try { require("dotenv").config(); } catch (e) { /* dotenv optional */ }

const { askClaude, DEFAULT_MODEL, DEFAULT_MAX_TOKENS } = require("./core/anthropic-client");
const { initDb, getChats, getChat, upsertChat, deleteChat } = require("./core/db");
const { loadKnowledge, getKnowledge, reloadKnowledge } = require("./core/knowledge-loader");

const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

app.use(express.json({ limit: "8mb" }));
app.use(express.static(path.join(__dirname, "public")));

// הדף הראשי
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---------- ניהול שיחות ----------
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
app.post("/api/ask", async (req, res) => {
  try {
    const { messages, model, maxTokens } = req.body;
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "messages array is required" });
    }
    const systemStable = getKnowledge();
    const result = await askClaude({
      apiKey: ANTHROPIC_API_KEY,
      systemStable,
      messages,
      model: model || DEFAULT_MODEL,
      maxTokens: maxTokens || DEFAULT_MAX_TOKENS,
    });
    res.status(result.status).json(result.data);
  } catch (e) {
    res.status(502).json({ error: "ask failed", detail: String(e) });
  }
});

// ---------- טעינת ידע מחדש (אחרי שיפור המודל) ----------
app.post("/api/reload-knowledge", (req, res) => {
  try {
    reloadKnowledge();
    res.json({ ok: true, message: "knowledge reloaded" });
  } catch (e) {
    res.status(500).json({ error: "reload failed", detail: String(e) });
  }
});

// ---------- אתחול ----------
async function start() {
  loadKnowledge();
  try {
    await initDb();
    console.log("DB ready.");
  } catch (e) {
    console.warn("WARNING: DB init failed —", String(e));
  }
  app.listen(PORT, () => {
    console.log("Nature Engine running on http://localhost:" + PORT);
    if (!ANTHROPIC_API_KEY) {
      console.warn("WARNING: ANTHROPIC_API_KEY is not set — /api/ask will fail until you set it.");
    }
    if (!process.env.DATABASE_URL) {
      console.warn("WARNING: DATABASE_URL is not set — chat storage will fail until you set it.");
    }
  });
}

start();
