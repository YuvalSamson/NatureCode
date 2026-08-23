// ============================================================
//  core/db.js
//  הגרעין התשתיתי — חיבור, שמירה וטעינה מ-PostgreSQL.
//  אינו יודע דבר על מהות הטבע. מנהל שיחות בלבד.
//
//  הטבלה נוצרת אוטומטית באתחול אם אינה קיימת, ועוברת שתי
//  מיגרציות רכות לטבלה שכבר קיימת:
//    א. הוספת עמודת variant לטבלאות מהשירות הישן.
//    ב. מעבר ממבנה בן עמודת data אחת למבנה title + messages.
//  בשני המקרים אין אובדן מידע — עמודות ישנות נשארות במקומן.
// ============================================================

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

//  בודק אם עמודה קיימת בטבלה. משמש את המיגרציות כדי לא
//  להריץ פעולות על מבנה שאינו קיים.
async function hasColumn(name) {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = 'chats' AND column_name = $1`,
    [name]
  );
  return rows.length > 0;
}

// יצירת הטבלה + מיגרציות רכות באתחול
async function initDb() {
  // 1. יצירה אם אינה קיימת. טבלה חדשה לגמרי נוצרת מלכתחילה
  //    במבנה הנכון; טבלה קיימת נדלגת בשקט, ולכן נחוצים
  //    השלבים הבאים.
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
  //    שורות קיימות מסומנות 'legacy' כדי לשמור הפרדה
  //    מהשיחות החדשות ('live').
  await pool.query(`ALTER TABLE chats ADD COLUMN IF NOT EXISTS variant TEXT;`);
  await pool.query(`UPDATE chats SET variant = 'live' WHERE variant IS NULL OR variant = 'legacy';`);
  await pool.query(`ALTER TABLE chats ALTER COLUMN variant SET DEFAULT 'live';`);
  await pool.query(`ALTER TABLE chats ALTER COLUMN variant SET NOT NULL;`);

  // 3. מיגרציה ממבנה ישן: טבלה שנוצרה עם עמודת data אחת
  //    במקום title ו-messages נפרדות. הכתיבה נוקבת בשמות
  //    העמודות, ולכן מבנה ישן מפיל כל שמירה בעוד הקריאה
  //    ממשיכה לעבוד — וזה בדיוק המצב שקשה לאבחן.
  await pool.query(`ALTER TABLE chats ADD COLUMN IF NOT EXISTS title TEXT;`);
  await pool.query(`ALTER TABLE chats ADD COLUMN IF NOT EXISTS messages JSONB;`);

  if (await hasColumn("data")) {
    //  שואב מתוך data רק לשורות שטרם הועברו.
    await pool.query(`
      UPDATE chats
         SET title    = COALESCE(title, data->>'title'),
             messages = COALESCE(messages, data->'messages')
       WHERE messages IS NULL OR title IS NULL;
    `);
    //  data נשארת NOT NULL מהמבנה הישן, ולכן היא לבדה תפיל
    //  כל כתיבה חדשה. מרפים את האילוץ ומשאירים את העמודה
    //  כגיבוי — לא מוחקים מידע.
    await pool.query(`ALTER TABLE chats ALTER COLUMN data DROP NOT NULL;`);
  }

  await pool.query(`UPDATE chats SET messages = '[]'::jsonb WHERE messages IS NULL;`);
  await pool.query(`ALTER TABLE chats ALTER COLUMN messages SET DEFAULT '[]'::jsonb;`);
  await pool.query(`ALTER TABLE chats ALTER COLUMN messages SET NOT NULL;`);

  //  אינדקס לסינון לפי גרסה — הרשימה נטענת בכל פתיחת דף.
  await pool.query(
    `CREATE INDEX IF NOT EXISTS chats_variant_updated_idx
       ON chats (variant, updated_at DESC);`
  );
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
  try {
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
  } catch (e) {
    //  בלי הדפסה מפורשת כאן, כשל כתיבה נבלע והמסוף שותק
    //  בזמן שהדף מציג שגיאה כללית. זה מה שהקשה על האבחון.
    console.error("UPSERT FAILED:", e.message);
    console.error("  chat id:", id, "| variant:", variant || "live");
    throw e;
  }
}

// מחיקת שיחה
async function deleteChat(id) {
  await pool.query("DELETE FROM chats WHERE id = $1", [id]);
}

module.exports = { initDb, getChats, getChat, upsertChat, deleteChat, pool };