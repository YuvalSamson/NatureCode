// server.js — שכבת ביניים מאובטחת למנוע הביומימיקרי
// השרת מחזיק את מפתח הגישה, מגביל קצב פניות, ומעביר את הבקשות למנוע הבינה.

const express = require("express");
const path = require("path");
const rateLimit = require("express-rate-limit");

const app = express();

// נדרש כדי לזהות נכון את כתובת המבקר מאחורי שירות האירוח
app.set("trust proxy", 1);

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// הגנה: עד 20 שאלות לכל מבקר בכל שעה
const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limit", detail: "הגעת למספר השאלות המרבי לשעה. נסה שוב מאוחר יותר." },
});
app.use("/api/", limiter);

// נקודת הקצה שאליה הדפדפן פונה
app.post("/api/ask", async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set" });
  }
  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Biomimicry engine running on http://localhost:" + PORT);
});
