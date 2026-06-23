// ============================================================
//  core/db.js
//  הגרעין התשתיתי — חיבור, שמירה וטעינה מ-PostgreSQL.
//  אינו יודע דבר על מהות הטבע. מנהל שיחות בלבד.
//
//  הטבלה נוצרת אוטומטית באתחול אם אינה קיימת.
//  עמודת variant שמורה לעתיד (השוואת גרסאות), כברירת מחדל "live".
// ============================================================

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

// יצירת הטבלה באתחול
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chats (
      id          TEXT PRIMARY KEY,
      title       TEXT,
      messages    JSONB NOT NULL DEFAULT '[]'::jsonb,
      variant     TEXT NOT NULL DEFAULT 'live',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

// כל השיחות (אפשר לסנן לפי variant)
async function getChats(variant) {
  if (variant) {
    const { rows } = await pool.query(
      "SELECT * FROM chats WHERE variant = $1 ORDER BY updated_at DESC",
      [variant]
    );
    return rows;
  }
  const { rows } = await pool.query("SELECT * FROM chats ORDER BY updated_at DESC");
  return rows;
}

// שיחה בודדת לפי מזהה
async function getChat(id) {
  const { rows } = await pool.query("SELECT * FROM chats WHERE id = $1", [id]);
  return rows[0] || null;
}

// שמירה/עדכון שיחה (upsert)
async function upsertChat(chat) {
  const { id, title, messages, variant } = chat;
  await pool.query(
    `INSERT INTO chats (id, title, messages, variant, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (id) DO UPDATE
       SET title = EXCLUDED.title,
           messages = EXCLUDED.messages,
           variant = EXCLUDED.variant,
           updated_at = now()`,
    [id, title || null, JSON.stringify(messages || []), variant || "live"]
  );
}

// מחיקת שיחה
async function deleteChat(id) {
  await pool.query("DELETE FROM chats WHERE id = $1", [id]);
}

module.exports = { initDb, getChats, getChat, upsertChat, deleteChat, pool };
