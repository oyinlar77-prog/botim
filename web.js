// ============================================================
// web.js — Web Server + Admin Panel + PPT Generator (Fayl 3/3)
// Express.js + pptxgenjs + Inline HTML Admin Panel
// ============================================================

require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const PptxGenJS = require("pptxgenjs");
const db = require("./db.js");
const { callGemini, usageInfoText } = require("./bot.js");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_ID = 7595247253;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ──────────────────────────────────────────────
// YORDAMCHI: ADMIN TEKSHIRUV
// ──────────────────────────────────────────────
function isAdmin(req) {
  const id = req.query.admin_id || req.body?.admin_id;
  return String(id) === String(ADMIN_ID);
}

// ──────────────────────────────────────────────
// PPT GENERATSIYA (Gemini + pptxgenjs)
// ──────────────────────────────────────────────
async function generatePPT(topic, slideCount) {
  // 1. Gemini dan slayt tarkibini olish
  const prompt = `Sen professional prezentatsiya dizayner siz. Quyidagi mavzu uchun ${slideCount} ta slayd tayyorla.
Mavzu: "${topic}"
Til: O'zbek tili

Har bir slayd uchun quyidagi JSON formatda javob ber (faqat JSON, boshqa narsa yozma):
{
  "slides": [
    {
      "title": "Slayd sarlavhasi",
      "bullets": ["band 1", "band 2", "band 3"],
      "note": "Kichik izoh (ixtiyoriy)"
    }
  ]
}

Qoidalar:
- 1-slayd: Kirish / sarlavha slayd (faqat title va subtitle)
- Oxirgi slayd: Xulosa
- Har bir slaydda 3-5 ta bullet point
- Bullet pointlar qisqa va aniq bo'lsin (max 10 so'z)
- Faqat JSON qaytarni, markdown yoki izoh qo'shma`;

  const raw = await callGemini(prompt);

  // JSON ni tozalash
  let parsed;
  try {
    const cleaned = raw
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    // JSON xato bo'lsa oddiy matndan slayd yasash
    parsed = { slides: fallbackSlides(topic, slideCount, raw) };
  }

  const slides = parsed.slides || [];

  // 2. pptxgenjs bilan PPT yaratish
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";

  // Rang sxemasi
  const COLORS = {
    bg: "1a1a2e",       // Qorong'i ko'k
    accent: "e94560",   // Qizil accent
    title: "FFFFFF",    // Oq sarlavha
    text: "eaeaea",     // Och kulrang matn
    bullet: "0f3460",   // Qayu ko'k (bullet bg)
    slide_bg: "16213e", // Slayd orqa fon
  };

  slides.forEach((slide, idx) => {
    const s = pptx.addSlide();

    // Orqa fon
    s.background = { color: COLORS.slide_bg };

    // Raqam (pastki o'ng)
    s.addText(`${idx + 1} / ${slides.length}`, {
      x: 8.5, y: 6.8, w: 1.2, h: 0.3,
      fontSize: 10, color: "888888", align: "right",
    });

    if (idx === 0) {
      // ── KIRISH SLAYD ──
      // Dekorativ chiziq
      s.addShape(pptx.ShapeType.rect, {
        x: 0, y: 2.5, w: 10, h: 0.05,
        fill: { color: COLORS.accent },
        line: { color: COLORS.accent },
      });

      s.addText(slide.title || topic, {
        x: 0.5, y: 1.5, w: 9, h: 1.2,
        fontSize: 40, bold: true, color: COLORS.title,
        align: "center", fontFace: "Calibri",
      });

      if (slide.bullets && slide.bullets[0]) {
        s.addText(slide.bullets[0], {
          x: 0.5, y: 2.8, w: 9, h: 0.8,
          fontSize: 20, color: COLORS.accent,
          align: "center", fontFace: "Calibri",
        });
      }

      s.addText("Naorat Javoblari", {
        x: 0, y: 6.5, w: 10, h: 0.4,
        fontSize: 12, color: "555577",
        align: "center",
      });
    } else {
      // ── ODDIY SLAYD ──
      // Sarlavha panel
      s.addShape(pptx.ShapeType.rect, {
        x: 0, y: 0, w: 10, h: 1.3,
        fill: { color: COLORS.bg },
        line: { color: COLORS.bg },
      });

      // Accent chiziq (sarlavha ostida)
      s.addShape(pptx.ShapeType.rect, {
        x: 0, y: 1.3, w: 10, h: 0.06,
        fill: { color: COLORS.accent },
        line: { color: COLORS.accent },
      });

      // Slayd raqami - accent box
      s.addShape(pptx.ShapeType.rect, {
        x: 0.3, y: 0.25, w: 0.55, h: 0.55,
        fill: { color: COLORS.accent },
        line: { color: COLORS.accent },
      });
      s.addText(String(idx), {
        x: 0.3, y: 0.25, w: 0.55, h: 0.55,
        fontSize: 14, bold: true, color: "FFFFFF",
        align: "center", valign: "middle",
      });

      // Sarlavha
      s.addText(slide.title || "", {
        x: 1.1, y: 0.2, w: 8.5, h: 0.9,
        fontSize: 24, bold: true, color: COLORS.title,
        valign: "middle", fontFace: "Calibri",
      });

      // Bullet pointlar
      const bullets = slide.bullets || [];
      bullets.forEach((bullet, bIdx) => {
        const yPos = 1.6 + bIdx * 0.9;
        if (yPos > 6.2) return; // sahifadan chiqmasin

        // Bullet icon
        s.addShape(pptx.ShapeType.rect, {
          x: 0.4, y: yPos + 0.18, w: 0.25, h: 0.25,
          fill: { color: COLORS.accent },
          line: { color: COLORS.accent },
        });

        s.addText(bullet, {
          x: 0.85, y: yPos, w: 8.8, h: 0.75,
          fontSize: 15, color: COLORS.text,
          valign: "middle", fontFace: "Calibri",
          wrap: true,
        });
      });

      // Izoh (mavjud bo'lsa)
      if (slide.note) {
        s.addText(slide.note, {
          x: 0.4, y: 6.4, w: 9, h: 0.4,
          fontSize: 10, color: "666688", italic: true,
        });
      }
    }
  });

  // Faylni saqlash
  const fileName = `slide_${Date.now()}.pptx`;
  const filePath = path.join("/tmp", fileName);
  await pptx.writeFile({ fileName: filePath });
  return filePath;
}

// Fallback: oddiy slaydlar (JSON xato bo'lsa)
function fallbackSlides(topic, count, rawText) {
  const slides = [{ title: topic, bullets: ["Kirish", "Asosiy ma'lumot", "Tahlil"] }];
  const lines = rawText.split("\n").filter((l) => l.trim().length > 5);
  const perSlide = Math.ceil(lines.length / Math.max(count - 2, 1));
  for (let i = 0; i < count - 2 && i * perSlide < lines.length; i++) {
    slides.push({
      title: `${i + 1}-qism`,
      bullets: lines.slice(i * perSlide, (i + 1) * perSlide).map((l) => l.trim().substring(0, 80)),
    });
  }
  slides.push({ title: "Xulosa", bullets: ["Asosiy g'oyalar", "Natijalar", "Tavsiyalar"] });
  return slides;
}

// ──────────────────────────────────────────────
// API ENDPOINTLAR
// ──────────────────────────────────────────────

// Slayt yaratish (bot.js chaqiradi)
app.post("/api/generate-slide", async (req, res) => {
  const { topic, slideCount, userId } = req.body;
  if (!topic || !slideCount) return res.status(400).json({ error: "topic va slideCount kerak" });

  // Limit/coin tekshirish (slayd soniga qarab narx)
  const check = db.checkAndUseLimit(userId, "slide", parseInt(slideCount));
  if (!check.allowed) {
    return res.status(429).json({ error: check.message });
  }

  try {
    const filePath = await generatePPT(topic, parseInt(slideCount));
    res.json({ filePath, success: true, usage: check });
  } catch (e) {
    console.error("PPT xato:", e);
    res.status(500).json({ error: e.message });
  }
});

// Admin: premium berish/olish
app.post("/api/admin/premium", (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Ruxsat yo'q" });
  const { chatId, action, days } = req.body;
  if (!chatId) return res.status(400).json({ error: "chatId kerak" });

  if (action === "give") {
    const user = db.setPremium(chatId, parseInt(days) || 30);
    return res.json({ success: true, user });
  }
  if (action === "remove") {
    const user = db.removePremium(chatId);
    return res.json({ success: true, user });
  }
  res.status(400).json({ error: "action: give yoki remove" });
});

// Admin: limitlarni yangilash
app.post("/api/admin/limits", (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Ruxsat yo'q" });
  const { tier, action, value } = req.body;
  if (!tier || !action || value === undefined) {
    return res.status(400).json({ error: "tier, action, value kerak" });
  }
  const limits = db.setSingleLimit(tier, action, value);
  res.json({ success: true, limits });
});

// Admin: foydalanuvchi reset
app.post("/api/admin/reset-user", (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Ruxsat yo'q" });
  const { chatId } = req.body;
  if (!chatId) return res.status(400).json({ error: "chatId kerak" });
  const user = db.resetUserUsage(chatId);
  res.json({ success: true, user });
});

// Admin: narxlarni (coin) yangilash
app.post("/api/admin/prices", (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Ruxsat yo'q" });
  const { action, basePrice, perPage } = req.body;
  if (!action) return res.status(400).json({ error: "action kerak" });
  const prices = db.setPrice(action, basePrice, perPage);
  res.json({ success: true, prices });
});

// Admin: foydalanuvchi coin balansini boshqarish
app.post("/api/admin/coins", (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Ruxsat yo'q" });
  const { chatId, action, amount } = req.body;
  if (!chatId || amount === undefined) return res.status(400).json({ error: "chatId va amount kerak" });

  const numAmount = parseFloat(amount);
  if (isNaN(numAmount) || numAmount < 0) return res.status(400).json({ error: "amount musbat son bo'lishi kerak" });

  let user;
  if (action === "add") user = db.addCoins(chatId, numAmount);
  else if (action === "remove") user = db.removeCoins(chatId, numAmount);
  else if (action === "set") user = db.setBalance(chatId, numAmount);
  else return res.status(400).json({ error: "action: add | remove | set" });

  res.json({ success: true, user });
});

// Admin: dashboard ma'lumotlari (JSON)
app.get("/api/admin/data", (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Ruxsat yo'q" });
  res.json(db.getAdminDashboard());
});

// Foydalanuvchi ma'lumoti
app.get("/api/user/:id", (req, res) => {
  const detail = db.getUserDetail(req.params.id);
  res.json(detail);
});

// ──────────────────────────────────────────────
// SLAYT WEB APP SAHIFASI
// ──────────────────────────────────────────────
app.get("/slide", (req, res) => {
  const userId = req.query.user_id || "";
  const user = db.getUserDetail(userId);
  const maxSlides = 20;

  res.send(`<!DOCTYPE html>
<html lang="uz">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Slayt Tayyorlash</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', sans-serif;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding: 20px;
  }
  .card {
    background: rgba(255,255,255,0.05);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 20px;
    padding: 36px 28px;
    width: 100%; max-width: 440px;
    color: #fff;
  }
  .logo { text-align: center; margin-bottom: 24px; }
  .logo h1 { font-size: 22px; font-weight: 700; color: #e94560; }
  .logo p { font-size: 13px; color: #888; margin-top: 4px; }
  label { display: block; font-size: 13px; color: #aaa; margin-bottom: 6px; margin-top: 18px; }
  input, select {
    width: 100%; padding: 12px 16px;
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 12px; color: #fff; font-size: 15px;
    outline: none; transition: border-color .2s;
  }
  input::placeholder { color: #555; }
  input:focus, select:focus { border-color: #e94560; }
  select option { background: #1a1a2e; color: #fff; }
  .slider-wrap { display: flex; align-items: center; gap: 14px; margin-top: 4px; }
  input[type=range] {
    flex: 1; padding: 0; height: 6px;
    -webkit-appearance: none; background: rgba(255,255,255,0.15);
    border-radius: 10px; border: none;
  }
  input[type=range]::-webkit-slider-thumb {
    -webkit-appearance: none; width: 20px; height: 20px;
    border-radius: 50%; background: #e94560; cursor: pointer;
  }
  .count-badge {
    background: #e94560; color: #fff;
    border-radius: 8px; padding: 4px 12px;
    font-weight: 700; font-size: 16px; min-width: 44px;
    text-align: center;
  }
  .limit-info {
    background: rgba(233,69,96,0.1);
    border: 1px solid rgba(233,69,96,0.3);
    border-radius: 10px; padding: 10px 14px;
    font-size: 12px; color: #e94560; margin-top: 16px;
  }
  .btn {
    width: 100%; padding: 15px;
    background: linear-gradient(135deg, #e94560, #c62a47);
    border: none; border-radius: 14px;
    color: #fff; font-size: 16px; font-weight: 700;
    cursor: pointer; margin-top: 28px;
    transition: opacity .2s, transform .1s;
    letter-spacing: 0.5px;
  }
  .btn:active { transform: scale(0.98); opacity: 0.9; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .spinner {
    display: none; text-align: center; margin-top: 20px; color: #aaa; font-size: 14px;
  }
  .spinner.show { display: block; }
  .dot-anim::after {
    content: ''; animation: dots 1.5s infinite;
  }
  @keyframes dots {
    0%,20%{content:'.'} 40%{content:'..'} 60%,100%{content:'...'}
  }
</style>
</head>
<body>
<div class="card">
  <div class="logo">
    <h1>📊 Slayt Tayyorlash</h1>
    <p>Naorat Javoblari · AI Yordamchi</p>
  </div>

  <label>📌 Mavzu</label>
  <input type="text" id="topic" placeholder="Masalan: Fotosintez jarayoni" maxlength="200">

  <label>📊 Slaydlar soni</label>
  <div class="slider-wrap">
    <input type="range" id="slideRange" min="5" max="${maxSlides}" value="10"
      oninput="updateSlideCount(this.value)">
    <span class="count-badge" id="slideCount">10</span>
  </div>

  <div class="limit-info" id="limitInfo">
    📈 Bugungi: <b>${user.todayUsage?.slide || 0} / ${user.limits?.slide === 999 ? '♾️' : (user.limits?.slide ?? 0)}</b> bepul ishlatildi
    ${user.isPremium ? ' · 💎 Premium' : ''}
  </div>
  <div class="limit-info" id="priceInfo" style="margin-top:8px;${(user.todayUsage?.slide || 0) < (user.limits?.slide ?? 0) ? 'display:none' : ''}">
    💰 Balans: <b>${user.balance} coin</b> · Narx: <b id="priceVal">--</b> coin
  </div>

  <button class="btn" id="generateBtn" onclick="generate()">
    ⚡ Slayt Yaratish
  </button>

  <div class="spinner" id="spinner">
    <span class="dot-anim">⏳ Tayyorlanmoqda</span><br>
    <small>Bu 30-60 soniya olishi mumkin</small>
  </div>
</div>

<script>
  const tg = window.Telegram?.WebApp;
  if (tg) { tg.ready(); tg.expand(); }

  // Narx konfiguratsiyasi (server tomonidan hisoblangan)
  const PRICE = { base: ${db.getPrices().slide?.basePrice ?? 2}, perPage: ${db.getPrices().slide?.perPage ?? 1} };
  const STILL_FREE = ${(user.todayUsage?.slide || 0) < (user.limits?.slide ?? 0) ? 'true' : 'false'};

  function updateSlideCount(val) {
    document.getElementById('slideCount').textContent = val;
    if (!STILL_FREE) {
      const price = PRICE.base + PRICE.perPage * parseInt(val);
      document.getElementById('priceVal').textContent = price;
    }
  }
  updateSlideCount(document.getElementById('slideRange').value);

  async function generate() {
    const topic = document.getElementById('topic').value.trim();
    const slideCount = document.getElementById('slideRange').value;

    if (!topic) {
      alert('❌ Mavzuni kiriting!');
      return;
    }

    const btn = document.getElementById('generateBtn');
    const spinner = document.getElementById('spinner');
    btn.disabled = true;
    spinner.classList.add('show');

    if (tg) {
      tg.sendData(JSON.stringify({ type: 'slide', topic, slideCount: parseInt(slideCount) }));
    } else {
      // Test uchun (Telegram WebApp dan tashqarida)
      try {
        const resp = await fetch('/api/generate-slide', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic, slideCount: parseInt(slideCount), userId: '${userId}' })
        });
        const data = await resp.json();
        alert(data.success ? '✅ Slayt tayyor! Bot orqali yuboriladi.' : '❌ ' + data.error);
      } catch(e) {
        alert('❌ Xatolik: ' + e.message);
      }
      btn.disabled = false;
      spinner.classList.remove('show');
    }
  }
</script>
</body>
</html>`);
});

// ──────────────────────────────────────────────
// ADMIN PANEL
// ──────────────────────────────────────────────
app.get("/admin", (req, res) => {
  if (!isAdmin(req)) {
    return res.status(403).send(`
      <html><body style="background:#1a1a2e;color:#e94560;display:flex;align-items:center;
      justify-content:center;height:100vh;font-family:sans-serif;font-size:24px;">
      ⛔ Ruxsat yo'q</body></html>`);
  }

  const d = db.getAdminDashboard();
  const limits = d.limits;
  const prices = d.prices;
  const adminId = req.query.admin_id;

  const actions = ["slide", "test", "referat", "mustaqil", "esse"];
  const actionEmojis = { slide: "📊", test: "📝", referat: "📄", mustaqil: "📚", esse: "✍️" };
  const actionNames = { slide: "Slayt", test: "Test", referat: "Referat", mustaqil: "Mustaqil", esse: "Esse" };

  const todayTotal = Object.values(d.todayStats).reduce((a, b) => a + b, 0);

  res.send(`<!DOCTYPE html>
<html lang="uz">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin Panel</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',sans-serif;background:#0d1117;color:#e6edf3;min-height:100vh}
  .nav{background:#161b22;border-bottom:1px solid #30363d;padding:16px 24px;
    display:flex;align-items:center;justify-content:space-between}
  .nav h1{font-size:18px;color:#58a6ff}
  .nav span{font-size:12px;color:#8b949e}
  .container{max-width:1100px;margin:0 auto;padding:24px 16px}
  .tabs{display:flex;gap:4px;margin-bottom:24px;background:#161b22;
    border-radius:12px;padding:6px;border:1px solid #30363d}
  .tab{flex:1;padding:10px;text-align:center;border-radius:8px;
    cursor:pointer;font-size:14px;color:#8b949e;transition:.2s;border:none;background:none}
  .tab.active{background:#21262d;color:#e6edf3;font-weight:600}
  .panel{display:none} .panel.active{display:block}
  .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:24px}
  .stat-card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:18px 16px}
  .stat-card .val{font-size:32px;font-weight:700;color:#58a6ff}
  .stat-card .lbl{font-size:12px;color:#8b949e;margin-top:4px}
  .stat-card.red .val{color:#f85149}
  .stat-card.green .val{color:#3fb950}
  .stat-card.orange .val{color:#f0883e}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{background:#21262d;color:#8b949e;padding:10px 12px;text-align:left;
    font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.5px}
  td{padding:10px 12px;border-bottom:1px solid #21262d;vertical-align:middle}
  tr:hover td{background:#161b22}
  .badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}
  .badge.premium{background:rgba(240,136,62,.15);color:#f0883e;border:1px solid rgba(240,136,62,.3)}
  .badge.free{background:rgba(139,148,158,.1);color:#8b949e;border:1px solid #30363d}
  .card{background:#161b22;border:1px solid #30363d;border-radius:12px;
    padding:20px;margin-bottom:16px}
  .card h3{font-size:14px;color:#8b949e;margin-bottom:16px;text-transform:uppercase;
    letter-spacing:.5px;font-size:12px}
  .limit-row{display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap}
  .limit-row label{width:120px;font-size:13px;color:#e6edf3;flex-shrink:0}
  .limit-row input{width:80px;padding:6px 10px;background:#0d1117;
    border:1px solid #30363d;border-radius:8px;color:#e6edf3;font-size:14px;text-align:center}
  .limit-row .tier{font-size:11px;color:#8b949e;margin-right:4px}
  .btn{padding:9px 20px;border-radius:8px;border:none;cursor:pointer;
    font-size:13px;font-weight:600;transition:.15s}
  .btn-blue{background:#1f6feb;color:#fff} .btn-blue:hover{background:#388bfd}
  .btn-red{background:#da3633;color:#fff} .btn-red:hover{background:#f85149}
  .btn-green{background:#238636;color:#fff} .btn-green:hover{background:#3fb950}
  .btn-sm{padding:5px 12px;font-size:12px}
  .form-row{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:12px}
  .form-row .field{display:flex;flex-direction:column;gap:5px}
  .form-row label{font-size:12px;color:#8b949e}
  .form-row input,.form-row select{
    padding:8px 12px;background:#0d1117;border:1px solid #30363d;
    border-radius:8px;color:#e6edf3;font-size:13px;min-width:140px}
  .toast{position:fixed;bottom:20px;right:20px;background:#238636;color:#fff;
    padding:12px 20px;border-radius:10px;font-size:14px;display:none;z-index:999}
  .search-box{padding:8px 14px;background:#0d1117;border:1px solid #30363d;
    border-radius:8px;color:#e6edf3;font-size:13px;width:100%;max-width:300px;margin-bottom:16px}
  @media(max-width:600px){.stats-grid{grid-template-columns:1fr 1fr}
    .limit-row{flex-direction:column;align-items:flex-start}}
</style>
</head>
<body>
<div class="nav">
  <h1>⚙️ Admin Panel</h1>
  <span>Naorat Javoblari Bot</span>
</div>

<div class="container">
  <!-- STAT KARTALAR -->
  <div class="stats-grid">
    <div class="stat-card">
      <div class="val">${d.userCount}</div>
      <div class="lbl">👥 Jami foydalanuvchi</div>
    </div>
    <div class="stat-card green">
      <div class="val">${d.premiumCount}</div>
      <div class="lbl">💎 Premium</div>
    </div>
    <div class="stat-card">
      <div class="val">${d.freeCount}</div>
      <div class="lbl">🆓 Bepul</div>
    </div>
    <div class="stat-card orange">
      <div class="val">${todayTotal}</div>
      <div class="lbl">📈 Bugungi amallar</div>
    </div>
    <div class="stat-card red">
      <div class="val">${d.totalActions}</div>
      <div class="lbl">🔢 Jami amallar</div>
    </div>
    <div class="stat-card" style="border-color:#d29922">
      <div class="val" style="color:#d29922">${d.totalCoinsInCirculation}</div>
      <div class="lbl">🪙 Aylanmadagi coin</div>
    </div>
    <div class="stat-card">
      <div class="val">${d.totalCoinsSpent}</div>
      <div class="lbl">💸 Sarflangan coin</div>
    </div>
  </div>

  <!-- TABLAR -->
  <div class="tabs">
    <button class="tab active" onclick="switchTab('users')">👥 Foydalanuvchilar</button>
    <button class="tab" onclick="switchTab('limits')">🔢 Limitlar</button>
    <button class="tab" onclick="switchTab('prices')">🪙 Narxlar</button>
    <button class="tab" onclick="switchTab('premium')">💎 Premium</button>
    <button class="tab" onclick="switchTab('stats')">📊 Statistika</button>
  </div>

  <!-- ── FOYDALANUVCHILAR ── -->
  <div class="panel active" id="panel-users">
    <input class="search-box" type="text" id="userSearch"
      placeholder="🔍 ID, username yoki ism bo'yicha izlash..."
      oninput="filterUsers(this.value)">
    <div class="card" style="padding:0;overflow:hidden">
      <table id="userTable">
        <thead>
          <tr>
            <th>ID</th>
            <th>Ism</th>
            <th>Username</th>
            <th>Tarif</th>
            <th>🪙 Balans</th>
            <th>Qo'shilgan</th>
            <th>Amallar</th>
          </tr>
        </thead>
        <tbody>
          ${Object.values(db.getAllUsers()).map((u) => `
          <tr data-id="${u.chatId}" data-name="${(u.name||'').toLowerCase()}" data-uname="${(u.username||'').toLowerCase()}">
            <td><code>${u.chatId}</code></td>
            <td>${u.name || '—'}</td>
            <td>${u.username ? '@' + u.username : '—'}</td>
            <td><span class="badge ${u.isPremium ? 'premium' : 'free'}">${u.isPremium ? '💎 Premium' : '🆓 Bepul'}</span></td>
            <td style="color:#d29922;font-weight:600">${u.balance || 0}</td>
            <td>${u.joinedAt ? new Date(u.joinedAt).toLocaleDateString('uz-UZ') : '—'}</td>
            <td style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="btn btn-green btn-sm" onclick="givePremium('${u.chatId}')">💎 Premium</button>
              <button class="btn btn-red btn-sm" onclick="removePremium('${u.chatId}')">❌ Olish</button>
              <button class="btn btn-sm" style="background:#d29922" onclick="quickAddCoins('${u.chatId}')">🪙 Coin</button>
              <button class="btn btn-sm" style="background:#21262d" onclick="resetUser('${u.chatId}')">🔄 Reset</button>
            </td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
  </div>

  <!-- ── LIMITLAR ── -->
  <div class="panel" id="panel-limits">
    <div class="card" style="background:rgba(88,166,255,0.08);border-color:rgba(88,166,255,0.3)">
      <p style="font-size:13px;color:#8b949e;line-height:1.6">
        ℹ️ Bu yerda har bir tugmani <b>kuniga necha marta bepul</b> ishlatish mumkinligi belgilanadi.
        Bepul limit tugagach, foydalanuvchi <b>coin</b> bilan to'laydi (narxlarni "🪙 Narxlar" bo'limidan sozlang).
        <br>0 = bepul ishlatib bo'lmaydi (doim coin kerak) · 999 = cheksiz bepul.
      </p>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div class="card">
        <h3>🆓 Bepul tarif — kuniga necha marta</h3>
        ${actions.map((a) => `
        <div class="limit-row">
          <label>${actionEmojis[a]} ${actionNames[a]}</label>
          <input type="number" id="free_${a}" value="${limits.free[a] || 0}" min="0" max="999">
          <span style="font-size:11px;color:#8b949e">marta/kun</span>
        </div>`).join("")}
        <div class="limit-row">
          <label>📄 Max sahifa</label>
          <input type="number" id="free_maxPages" value="${limits.free.maxPages || 10}" min="1" max="25">
          <span style="font-size:11px;color:#8b949e">bet</span>
        </div>
        <button class="btn btn-blue" style="margin-top:8px" onclick="saveLimits('free')">💾 Saqlash</button>
      </div>

      <div class="card">
        <h3>💎 Premium tarif — kuniga necha marta</h3>
        ${actions.map((a) => `
        <div class="limit-row">
          <label>${actionEmojis[a]} ${actionNames[a]}</label>
          <input type="number" id="premium_${a}" value="${limits.premium[a] || 0}" min="0" max="999">
          <span style="font-size:11px;color:#8b949e">marta/kun</span>
        </div>`).join("")}
        <div class="limit-row">
          <label>📄 Max sahifa</label>
          <input type="number" id="premium_maxPages" value="${limits.premium.maxPages || 25}" min="1" max="25">
          <span style="font-size:11px;color:#8b949e">bet</span>
        </div>
        <button class="btn btn-blue" style="margin-top:8px" onclick="saveLimits('premium')">💾 Saqlash</button>
      </div>
    </div>
  </div>

  <!-- ── NARXLAR (COIN) ── -->
  <div class="panel" id="panel-prices">
    <div class="card" style="background:rgba(210,153,34,0.08);border-color:rgba(210,153,34,0.3)">
      <p style="font-size:13px;color:#8b949e;line-height:1.6">
        🪙 Bepul limit tugagandan keyin har bir amal uchun coin narxi shu yerda belgilanadi.<br>
        <b>Narx = Bazaviy narx + (Sahifa/Slayd/Savol soni × Birlik narx)</b><br>
        Masalan: Referat uchun bazaviy=2, birlik=2 bo'lsa, 10 betlik referat = 2 + 10×2 = <b>22 coin</b>.
      </p>
    </div>

    <div class="card">
      <h3>🪙 Har amal narxi</h3>
      <table>
        <thead>
          <tr><th>Xizmat</th><th>Bazaviy narx (coin)</th><th>Birlik narx (coin/bet yoki /slayd)</th><th>Namuna (10 ta uchun)</th></tr>
        </thead>
        <tbody>
          ${actions.map((a) => {
            const p = prices[a] || { basePrice: 0, perPage: 0 };
            const unitLabel = a === 'slide' ? 'slayd' : a === 'test' ? 'savol' : 'bet';
            return `
          <tr>
            <td>${actionEmojis[a]} ${actionNames[a]}</td>
            <td><input type="number" id="price_base_${a}" value="${p.basePrice}" min="0" step="0.5" style="width:80px;padding:6px 10px;background:#0d1117;border:1px solid #30363d;border-radius:8px;color:#e6edf3;text-align:center"></td>
            <td><input type="number" id="price_per_${a}" value="${p.perPage}" min="0" step="0.5" style="width:80px;padding:6px 10px;background:#0d1117;border:1px solid #30363d;border-radius:8px;color:#e6edf3;text-align:center"> / ${unitLabel}</td>
            <td id="price_example_${a}" style="color:#d29922;font-weight:600">${p.basePrice + p.perPage * 10} coin</td>
          </tr>`;
          }).join("")}
        </tbody>
      </table>
      <button class="btn btn-blue" style="margin-top:16px" onclick="savePrices()">💾 Narxlarni saqlash</button>
    </div>

    <div class="card">
      <h3>👤 Foydalanuvchi balansini boshqarish</h3>
      <div class="form-row">
        <div class="field">
          <label>Foydalanuvchi ID</label>
          <input type="text" id="coinChatId" placeholder="123456789">
        </div>
        <div class="field">
          <label>Coin miqdori</label>
          <input type="number" id="coinAmount" placeholder="50" min="0">
        </div>
        <button class="btn btn-green" onclick="addCoinsForm()">➕ Qo'shish</button>
        <button class="btn btn-red" onclick="removeCoinsForm()">➖ Ayirish</button>
        <button class="btn" style="background:#21262d" onclick="setCoinsForm()">✏️ Belgilash</button>
      </div>
    </div>

    <div class="card">
      <h3>🏆 Eng ko'p coin sarflagan foydalanuvchilar</h3>
      <table>
        <thead><tr><th>ID</th><th>Ism</th><th>Balans</th><th>Jami sarflangan</th></tr></thead>
        <tbody>
          ${Object.values(db.getAllUsers())
            .filter(u => (u.totalSpent || 0) > 0 || (u.balance || 0) > 0)
            .sort((a,b) => (b.totalSpent||0) - (a.totalSpent||0))
            .slice(0, 15)
            .map(u => `
          <tr>
            <td><code>${u.chatId}</code></td>
            <td>${u.name || '—'}</td>
            <td style="color:#d29922;font-weight:600">${u.balance || 0} 🪙</td>
            <td>${u.totalSpent || 0} 🪙</td>
          </tr>`).join("") || '<tr><td colspan="4" style="text-align:center;color:#8b949e;padding:20px">Ma\'lumot yo\'q</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>

  <!-- ── PREMIUM BERISH ── -->
  <div class="panel" id="panel-premium">
    <div class="card">
      <h3>💎 Premium berish / olish</h3>
      <div class="form-row">
        <div class="field">
          <label>Foydalanuvchi ID</label>
          <input type="text" id="premiumChatId" placeholder="123456789">
        </div>
        <div class="field">
          <label>Muddat (kun)</label>
          <select id="premiumDays">
            <option value="7">7 kun</option>
            <option value="30" selected>30 kun</option>
            <option value="90">90 kun</option>
            <option value="180">180 kun</option>
            <option value="365">1 yil</option>
            <option value="0">♾️ Cheksiz</option>
          </select>
        </div>
        <button class="btn btn-green" onclick="givePremiumForm()">💎 Premium berish</button>
        <button class="btn btn-red" onclick="removePremiumForm()">❌ Premiumni olish</button>
      </div>
    </div>

    <div class="card">
      <h3>💎 Premium foydalanuvchilar</h3>
      <table>
        <thead><tr><th>ID</th><th>Ism</th><th>Username</th><th>Tugash sanasi</th></tr></thead>
        <tbody>
          ${Object.values(db.getAllUsers()).filter((u) => u.isPremium).map((u) => `
          <tr>
            <td><code>${u.chatId}</code></td>
            <td>${u.name || '—'}</td>
            <td>${u.username ? '@' + u.username : '—'}</td>
            <td>${u.premiumExpiry ? new Date(u.premiumExpiry).toLocaleDateString('uz-UZ') : '♾️ Cheksiz'}</td>
          </tr>`).join("") || '<tr><td colspan="4" style="text-align:center;color:#8b949e;padding:20px">Premium foydalanuvchi yo\'q</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>

  <!-- ── STATISTIKA ── -->
  <div class="panel" id="panel-stats">
    <div class="card">
      <h3>📈 Bugungi statistika</h3>
      <div class="stats-grid" style="margin-bottom:0">
        ${actions.map((a) => `
        <div class="stat-card">
          <div class="val">${d.todayStats[a] || 0}</div>
          <div class="lbl">${actionEmojis[a]} ${actionNames[a]}</div>
        </div>`).join("")}
      </div>
    </div>
    <div class="card">
      <h3>📊 Umumiy statistika</h3>
      <div class="stats-grid" style="margin-bottom:0">
        ${actions.map((a) => `
        <div class="stat-card">
          <div class="val">${d.totalStats[a] || 0}</div>
          <div class="lbl">${actionEmojis[a]} ${actionNames[a]}</div>
        </div>`).join("")}
      </div>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
const ADMIN_ID = '${adminId}';

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t,i) => {
    t.classList.toggle('active', ['users','limits','prices','premium','stats'][i] === name);
  });
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
}

function toast(msg, ok=true) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background = ok ? '#238636' : '#da3633';
  t.style.display = 'block';
  setTimeout(() => t.style.display='none', 3000);
}

async function api(url, body) {
  const r = await fetch(url + '?admin_id=' + ADMIN_ID, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({...body, admin_id: ADMIN_ID})
  });
  return r.json();
}

async function givePremium(chatId) {
  const days = prompt('Necha kun? (0 = cheksiz)', '30');
  if (days === null) return;
  const r = await api('/api/admin/premium', {chatId, action:'give', days});
  r.success ? toast('✅ Premium berildi!') : toast('❌ '+r.error, false);
}
async function removePremium(chatId) {
  if (!confirm('Premiumni olib tashlamoqchimisiz?')) return;
  const r = await api('/api/admin/premium', {chatId, action:'remove'});
  r.success ? toast('✅ Premium olib tashlandi') : toast('❌ '+r.error, false);
}
async function resetUser(chatId) {
  if (!confirm("Foydalanuvchi limitini reset qilinsinmi?")) return;
  const r = await api('/api/admin/reset-user', {chatId});
  r.success ? toast('✅ Reset qilindi') : toast('❌ '+r.error, false);
}

async function quickAddCoins(chatId) {
  const amount = prompt('Necha coin qo\\'shilsin?', '50');
  if (amount === null) return;
  const r = await api('/api/admin/coins', {chatId, action:'add', amount});
  r.success ? toast('✅ ' + amount + " coin qo'shildi! Balans: " + r.user.balance) : toast('❌ '+r.error, false);
}

async function saveLimits(tier) {
  const actions = ['slide','test','referat','mustaqil','esse','maxPages'];
  for (const a of actions) {
    const val = document.getElementById(tier+'_'+a)?.value;
    if (val !== undefined) {
      await api('/api/admin/limits', {tier, action:a, value:parseInt(val)});
    }
  }
  toast('✅ Limitlar saqlandi!');
}

// ── NARXLAR (COIN) ──
const PRICE_ACTIONS = ['slide','test','referat','mustaqil','esse'];

function updatePriceExample(action) {
  const base = parseFloat(document.getElementById('price_base_'+action)?.value || 0);
  const per = parseFloat(document.getElementById('price_per_'+action)?.value || 0);
  const example = Math.max(0, Math.round(base + per * 10));
  const el = document.getElementById('price_example_'+action);
  if (el) el.textContent = example + ' coin';
}

// Har input o'zgarganda live yangilanish
document.addEventListener('DOMContentLoaded', () => {
  PRICE_ACTIONS.forEach(a => {
    document.getElementById('price_base_'+a)?.addEventListener('input', () => updatePriceExample(a));
    document.getElementById('price_per_'+a)?.addEventListener('input', () => updatePriceExample(a));
  });
});

async function savePrices() {
  for (const a of PRICE_ACTIONS) {
    const basePrice = document.getElementById('price_base_'+a)?.value;
    const perPage = document.getElementById('price_per_'+a)?.value;
    await api('/api/admin/prices', {action: a, basePrice: parseFloat(basePrice), perPage: parseFloat(perPage)});
  }
  toast('✅ Narxlar saqlandi!');
}

async function addCoinsForm() {
  const chatId = document.getElementById('coinChatId').value.trim();
  const amount = document.getElementById('coinAmount').value;
  if (!chatId || !amount) return toast('❌ ID va miqdorni kiriting!', false);
  const r = await api('/api/admin/coins', {chatId, action:'add', amount});
  r.success ? toast('✅ ' + amount + " coin qo'shildi! Yangi balans: " + r.user.balance) : toast('❌ '+r.error, false);
}
async function removeCoinsForm() {
  const chatId = document.getElementById('coinChatId').value.trim();
  const amount = document.getElementById('coinAmount').value;
  if (!chatId || !amount) return toast('❌ ID va miqdorni kiriting!', false);
  const r = await api('/api/admin/coins', {chatId, action:'remove', amount});
  r.success ? toast('✅ ' + amount + ' coin ayirildi! Yangi balans: ' + r.user.balance) : toast('❌ '+r.error, false);
}
async function setCoinsForm() {
  const chatId = document.getElementById('coinChatId').value.trim();
  const amount = document.getElementById('coinAmount').value;
  if (!chatId || amount === '') return toast('❌ ID va miqdorni kiriting!', false);
  const r = await api('/api/admin/coins', {chatId, action:'set', amount});
  r.success ? toast('✅ Balans belgilandi: ' + r.user.balance + ' coin') : toast('❌ '+r.error, false);
}

async function givePremiumForm() {
  const chatId = document.getElementById('premiumChatId').value.trim();
  const days = document.getElementById('premiumDays').value;
  if (!chatId) return toast('❌ ID kiriting!', false);
  const r = await api('/api/admin/premium', {chatId, action:'give', days});
  r.success ? toast('✅ Premium berildi!') : toast('❌ '+r.error, false);
}
async function removePremiumForm() {
  const chatId = document.getElementById('premiumChatId').value.trim();
  if (!chatId) return toast('❌ ID kiriting!', false);
  const r = await api('/api/admin/premium', {chatId, action:'remove'});
  r.success ? toast('✅ Premium olib tashlandi') : toast('❌ '+r.error, false);
}

function filterUsers(q) {
  q = q.toLowerCase().replace('@','');
  document.querySelectorAll('#userTable tbody tr').forEach(tr => {
    const id = tr.dataset.id || '';
    const name = tr.dataset.name || '';
    const uname = tr.dataset.uname || '';
    tr.style.display = (id.includes(q)||name.includes(q)||uname.includes(q)) ? '' : 'none';
  });
}
</script>
</body>
</html>`);
});

// ──────────────────────────────────────────────
// SERVER ISHGA TUSHIRISH
// ──────────────────────────────────────────────
app.get("/health", (_, res) => res.json({ status: "ok", time: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`🌐 Web server ishga tushdi: http://localhost:${PORT}`);
  console.log(`🔗 Admin panel: http://localhost:${PORT}/admin?admin_id=${ADMIN_ID}`);
});
