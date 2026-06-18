// ============================================================
//  Nature Wisdom Engine — server
//  - Serves the static front-end (index.html)
//  - Proxies the Anthropic API (keeps the API key on the server)
//  - Persists chats in PostgreSQL so history survives deploys & restarts
//
//  Run:
//    npm install
//    set ANTHROPIC_API_KEY=sk-ant-...   (PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-...")
//    set DATABASE_URL=postgres://...    (Render provides this automatically
//                                         once a PostgreSQL instance is linked)
//    node server.js
//  Requires Node.js 18+ (built-in fetch).
// ============================================================

const express = require("express");
const path = require("path");
const { Pool } = require("pg");

// Optional .env support (works even if dotenv isn't installed)
try { require("dotenv").config(); } catch (e) { /* dotenv optional */ }

const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

app.use(express.json({ limit: "8mb" }));
app.use(express.static(path.join(__dirname, "public"))); // serves public/index.html and assets

// Explicit home route — guarantees the app loads at "/"
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---------- Database (PostgreSQL) ----------
let pool = null;
let dbReady = false;

if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    // Render's managed Postgres requires SSL; this setting works for both
    // Render-internal and Render-external connection strings.
    ssl: { rejectUnauthorized: false },
  });
} else {
  console.warn("WARNING: DATABASE_URL is not set — chat history will not be saved.");
}

async function ensureSchema() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  dbReady = true;
  console.log("Database schema ready.");
}

if (pool) {
  ensureSchema().catch(err => {
    console.error("Failed to initialize database schema:", err);
  });
}

function requireDb(res) {
  if (!pool || !dbReady) {
    res.status(503).json({ error: "Database is not configured or not ready yet." });
    return false;
  }
  return true;
}

// ---------- Chat CRUD ----------
app.get("/api/chats", async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const result = await pool.query("SELECT data FROM chats ORDER BY updated_at DESC");
    res.json(result.rows.map(r => r.data));
  } catch (e) {
    console.error("GET /api/chats failed:", e);
    res.status(500).json({ error: "failed to load chats" });
  }
});

// Upsert a single chat by id
app.put("/api/chats/:id", async (req, res) => {
  if (!requireDb(res)) return;
  const id = req.params.id;
  const incoming = req.body;
  if (!incoming || incoming.id !== id) {
    return res.status(400).json({ error: "chat id mismatch" });
  }
  try {
    await pool.query(
      `INSERT INTO chats (id, data, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = now()`,
      [id, incoming]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("PUT /api/chats/:id failed:", e);
    res.status(500).json({ error: "failed to save chat" });
  }
});

app.delete("/api/chats/:id", async (req, res) => {
  if (!requireDb(res)) return;
  const id = req.params.id;
  try {
    await pool.query("DELETE FROM chats WHERE id = $1", [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/chats/:id failed:", e);
    res.status(500).json({ error: "failed to delete chat" });
  }
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
  console.log("Nature Wisdom Engine server running on http://localhost:" + PORT);
  if (!ANTHROPIC_API_KEY) {
    console.warn("WARNING: ANTHROPIC_API_KEY is not set — /api/ask will fail until you set it.");
  }
  if (!DATABASE_URL) {
    console.warn("WARNING: DATABASE_URL is not set — chat history will not be saved.");
  }
});
