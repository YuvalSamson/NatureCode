// ============================================================
//  Biomimicry Engine — server
//  - Serves the static front-end (index.html)
//  - Proxies the Anthropic API (keeps the API key on the server)
//  - Persists chats on disk so history survives reloads & restarts
//
//  Run:
//    npm install
//    set ANTHROPIC_API_KEY=sk-ant-...   (PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-...")
//    node server.js
//  Requires Node.js 18+ (built-in fetch).
// ============================================================

const express = require("express");
const fs = require("fs");
const path = require("path");

// Optional .env support (works even if dotenv isn't installed)
try { require("dotenv").config(); } catch (e) { /* dotenv optional */ }

const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const DATA_DIR = path.join(__dirname, "data");
const CHATS_FILE = path.join(DATA_DIR, "chats.json");

app.use(express.json({ limit: "8mb" }));
app.use(express.static(path.join(__dirname, "public"))); // serves public/index.html and assets

// Explicit home route — guarantees the app loads at "/"
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---------- Chat storage (flat JSON file) ----------
function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CHATS_FILE)) fs.writeFileSync(CHATS_FILE, "[]", "utf8");
}
function readChats() {
  ensureStore();
  try {
    const data = JSON.parse(fs.readFileSync(CHATS_FILE, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}
function writeChats(chats) {
  ensureStore();
  fs.writeFileSync(CHATS_FILE, JSON.stringify(chats, null, 2), "utf8");
}

// ---------- Chat CRUD ----------
app.get("/api/chats", (req, res) => {
  res.json(readChats());
});

// Upsert a single chat by id
app.put("/api/chats/:id", (req, res) => {
  const id = req.params.id;
  const incoming = req.body;
  if (!incoming || incoming.id !== id) {
    return res.status(400).json({ error: "chat id mismatch" });
  }
  const chats = readChats();
  const idx = chats.findIndex(c => c.id === id);
  if (idx >= 0) chats[idx] = incoming;
  else chats.push(incoming);
  writeChats(chats);
  res.json({ ok: true });
});

app.delete("/api/chats/:id", (req, res) => {
  const id = req.params.id;
  const chats = readChats().filter(c => c.id !== id);
  writeChats(chats);
  res.json({ ok: true });
});

// ---------- Anthropic proxy ----------
app.post("/api/ask", async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "Missing ANTHROPIC_API_KEY on the server" });
  }
  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (e) {
    res.status(502).json({ error: "proxy request failed", detail: String(e) });
  }
});

app.listen(PORT, () => {
  console.log("Biomimicry server running on http://localhost:" + PORT);
  if (!ANTHROPIC_API_KEY) {
    console.warn("WARNING: ANTHROPIC_API_KEY is not set — /api/ask will fail until you set it.");
  }
});
