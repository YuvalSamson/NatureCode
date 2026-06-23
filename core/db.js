// ============================================================
//  core/db.js
//  הגרעין התשתיתי — חיבור, שמירה וטעינה מ-PostgreSQL.
//  אינו יודע דבר על מהות הטבע. מנהל שיחות בלבד.
//
//  הטבלה נוצרת אוטומטית באתחול אם אינה קיימת, וגם עוברת
//  מיגרציה רכה: אם הטבלה כבר קיימת בלי עמודת variant
//  (למשל מהשירות הישן), העמודה תתווסף אוטומטית.
//  שורות ישנות מסומנות 'legacy' כדי לשמור על הפרדה
//  מהשיחות החדשות ('live'). אין אובדן מידע.
// ============================================================

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

// יצירת הטבלה + מיגרציה רכה באתחול
async function initDb() {
  // 1. יצירה אם אינה קיימת (טבלה חדשה לגמרי תיווצר עם variant מההתחלה)
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

  // 2. מיגרציה רכה לטבלה קיימת שאין בה variant.
  //    מוסיפים את העמודה ככל-שאינה-קיימת, מסמנים שורות קיימות
  //    כ-'legacy' (שומר הפרדה מ-'live'), ואז קובעים ברירת מחדל
  //    'live' לשורות חדשות ואת האילוץ NOT NULL.
  await pool.query(`ALTER TABLE chats ADD COLUMN IF NOT EXISTS variant TEXT;`);
  await pool.query(`UPDATE chats SET variant = 'legacy' WHERE variant IS NULL;`);
  await pool.query(`ALTER TABLE chats ALTER COLUMN variant SET DEFAULT 'live';`);
  await pool.query(`ALTER TABLE chats ALTER COLUMN variant SET NOT NULL;`);
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
