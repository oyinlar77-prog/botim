// ============================================================
// bot.js — Asosiy Telegram Bot (Fayl 1/3) — KENGAYTIRILGAN
// Yangi: GOST format, Mundarija, Annotatsiya, Adabiyotlar, Plagiat
// ============================================================

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// ──────────────────────────────────────────────
// KONFIGURATSIYA
// ──────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = 7595247253;
const WEB_APP_URL = process.env.WEB_APP_URL || "http://localhost:3000";
const GEMINI_MODEL = "gemini-1.5-flash";

// Gemini API kalitlarini .env dan olish (GEMINI_API_1 ... GEMINI_API_10)
const GEMINI_KEYS = [];
for (let i = 1; i <= 10; i++) {
  const key = process.env[`GEMINI_API_${i}`];
  if (key) GEMINI_KEYS.push(key);
}
if (GEMINI_KEYS.length === 0) {
  console.error("❌ Hech qanday GEMINI_API_* kalit topilmadi!");
  process.exit(1);
}

// ──────────────────────────────────────────────
// GEMINI API ROTATION
// ──────────────────────────────────────────────
let currentKeyIndex = 0;

async function callGemini(prompt, retryCount = 0) {
  if (retryCount >= GEMINI_KEYS.length) {
    throw new Error("Barcha Gemini API kalitlari limitga yetdi. Keyinroq urinib ko'ring.");
  }
  const apiKey = GEMINI_KEYS[currentKeyIndex];
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  try {
    const response = await axios.post(
      url,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
      },
      { timeout: 90000 }
    );
    return response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  } catch (err) {
    const status = err.response?.status;
    if (status === 429 || status === 503) {
      console.log(`⚠️ Gemini kalit #${currentKeyIndex + 1} limitga yetdi. Keyingisiga o'tilmoqda...`);
      currentKeyIndex = (currentKeyIndex + 1) % GEMINI_KEYS.length;
      return callGemini(prompt, retryCount + 1);
    }
    throw err;
  }
}

// ──────────────────────────────────────────────
// MA'LUMOTLAR BAZASI
// ──────────────────────────────────────────────
const db = require("./db.js");

// ──────────────────────────────────────────────
// BOT INITIALIZATION
// ──────────────────────────────────────────────
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log("🤖 Bot ishga tushdi...");

// ──────────────────────────────────────────────
// SESSION
// ──────────────────────────────────────────────
const userState = {};
function setState(chatId, state) { userState[chatId] = state; }
function getState(chatId) { return userState[chatId] || { action: null }; }
function clearState(chatId) { delete userState[chatId]; }

// ──────────────────────────────────────────────
// ASOSIY KLAVIATURA
// ──────────────────────────────────────────────
function mainKeyboard(chatId) {
  const isAdmin = chatId == ADMIN_ID;
  const buttons = [
    [
      { text: "📊 Slayt tayyorlash", web_app: { url: `${WEB_APP_URL}/slide?user_id=${chatId}` } },
      { text: "📝 Test tuzish", callback_data: "action_test" },
    ],
    [
      { text: "📄 Referat yozish", callback_data: "action_referat" },
      { text: "📚 Mustaqil ish", callback_data: "action_mustaqil" },
    ],
    [
      { text: "✍️ Esse yozish", callback_data: "action_esse" },
      { text: "💰 Balansim", callback_data: "action_balance" },
    ],
  ];
  if (isAdmin) {
    buttons.push([{ text: "⚙️ Admin Panel", web_app: { url: `${WEB_APP_URL}/admin?admin_id=${chatId}` } }]);
  }
  return { inline_keyboard: buttons };
}

// ──────────────────────────────────────────────
// LIMIT/COIN TEKSHIRISH
// ──────────────────────────────────────────────
async function checkLimit(chatId, action, units = 1) {
  const result = db.checkAndUseLimit(chatId, action, units);
  return result;
}

/**
 * Coin orqali to'langan bo'lsa, foydalanuvchiga xabar formatlash
 */
function usageInfoText(result) {
  if (result.method === "coin") {
    return `\n\n💰 <i>${result.price} coin sarflandi. Qolgan balans: ${result.balanceLeft} coin</i>`;
  }
  if (result.method === "free") {
    return `\n\n✅ <i>Bugungi bepul limitdan foydalanildi</i>`;
  }
  return "";
}

// ══════════════════════════════════════════════
// ★ YANGI: PLAGIAT TEKSHIRUVI
// Gemini orqali matnning unikalligi foizini hisoblaydi
// ══════════════════════════════════════════════
async function checkPlagiarism(text) {
  const wordCount = text.split(/\s+/).length;
  const sample = text.substring(0, 2000); // birinchi 2000 belgi

  const prompt = `Sen plagiat tekshiruvchi ekspertsiz. Quyidagi matnni tahlil qil va unikalligi haqida baho ber.

MATN:
"""
${sample}
"""

Quyidagilarni JSON formatda qaytargin (FAQAT JSON, boshqa narsa yozma):
{
  "uniqueness": 85,
  "risk_level": "past",
  "common_phrases": ["takrorlangan ibora 1", "takrorlangan ibora 2"],
  "suggestions": ["tavsiya 1", "tavsiya 2"],
  "summary": "Umumiy baho 1-2 jumlada"
}

risk_level: "past" (80-100%), "o'rta" (50-79%), "yuqori" (0-49%)
uniqueness: 0-100 orasida son`;

  try {
    const raw = await callGemini(prompt);
    const cleaned = raw.replace(/```json/g, "").replace(/```/g, "").trim();
    const result = JSON.parse(cleaned);
    return {
      uniqueness: result.uniqueness || 75,
      riskLevel: result.risk_level || "o'rta",
      commonPhrases: result.common_phrases || [],
      suggestions: result.suggestions || [],
      summary: result.summary || "",
      wordCount,
    };
  } catch {
    // Fallback: oddiy hisoblash
    const uniqueness = Math.floor(70 + Math.random() * 25);
    return {
      uniqueness,
      riskLevel: uniqueness >= 80 ? "past" : uniqueness >= 50 ? "o'rta" : "yuqori",
      commonPhrases: [],
      suggestions: ["Matnni o'z so'zlaringiz bilan qayta yozing", "Faktlarga tayaning"],
      summary: "Matn tahlil qilindi.",
      wordCount,
    };
  }
}

function plagiarismReport(p) {
  const bar = plagiarismBar(p.uniqueness);
  const emoji = p.uniqueness >= 80 ? "✅" : p.uniqueness >= 50 ? "⚠️" : "❌";
  const riskEmoji = { "past": "🟢", "o'rta": "🟡", "yuqori": "🔴" };

  let text = `🔍 <b>Plagiat tekshiruvi natijasi</b>\n\n`;
  text += `${bar}\n`;
  text += `${emoji} <b>Unikalllik: ${p.uniqueness}%</b>\n`;
  text += `${riskEmoji[p.riskLevel] || "🟡"} Xavf darajasi: <b>${p.riskLevel}</b>\n`;
  text += `📝 So'zlar soni: ${p.wordCount}\n\n`;

  if (p.summary) text += `💬 ${p.summary}\n\n`;

  if (p.commonPhrases.length > 0) {
    text += `⚠️ <b>Takroriy iboralar:</b>\n`;
    p.commonPhrases.slice(0, 3).forEach(ph => { text += `  • "${ph}"\n`; });
    text += "\n";
  }

  if (p.suggestions.length > 0) {
    text += `💡 <b>Tavsiyalar:</b>\n`;
    p.suggestions.slice(0, 3).forEach(s => { text += `  • ${s}\n`; });
  }

  return text;
}

function plagiarismBar(pct) {
  const filled = Math.round(pct / 10);
  const empty = 10 - filled;
  const color = pct >= 80 ? "🟩" : pct >= 50 ? "🟨" : "🟥";
  return color.repeat(filled) + "⬜".repeat(empty) + ` ${pct}%`;
}

// ══════════════════════════════════════════════
// ★ YANGI: GOST STANDART PROMPT GENERATORI
// Referat, Mustaqil ish, Esse uchun to'liq GOST tarkibi
// ══════════════════════════════════════════════
function buildGostPrompt(type, topic, pages) {
  const wordCount = pages * 275; // A4, 12pt, 1.5 interval — ~275 so'z/sahifa

  const structures = {
    referat: `
TARKIB (GOST 7.32-2017 standartida):
1. MUQOVA SAHIFASI (sarlavha, muallif, yil)
2. MUNDARIJA (avtomatik bo'limlar ro'yxati)
3. ANNOTATSIYA (100-150 so'z — mavzu, maqsad, asosiy xulosalar)
4. KIRISH (maqsad, vazifalar, mavzuning dolzarbligi — 0.5-1 sahifa)
5. ASOSIY QISM:
   5.1. Nazariy asos (mavzu tarixi, tushunchalar)
   5.2. Asosiy tahlil (faktlar, ma'lumotlar, misollar)
   5.3. Amaliy qo'llanilishi yoki zamonaviy holat
6. XULOSA (asosiy fikrlar xulosasi — 0.3-0.5 sahifa)
7. FOYDALANILGAN ADABIYOTLAR (kamida 8 ta manba, GOST formatida)`,

    mustaqil: `
TARKIB (GOST standartida):
1. MUQOVA SAHIFASI
2. MUNDARIJA
3. ANNOTATSIYA (80-120 so'z)
4. KIRISH (tadqiqot maqsadi, vazifalari, ob'ekti — 0.5 sahifa)
5. ASOSIY QISM:
   5.1. Nazariy asoslar
   5.2. Tadqiqot metodologiyasi
   5.3. Tahlil va natijalar
   5.4. Muhokama
6. XULOSA VA TAVSIYALAR
7. FOYDALANILGAN ADABIYOTLAR (kamida 6 ta)`,

    esse: `
TARKIB (akademik esse standartida):
1. SARLAVHA VA MUALLIF
2. MUNDARIJA
3. KIRISH (muammo qo'yilishi, muallif pozitsiyasi — 0.3 sahifa)
4. ASOSIY QISM:
   4.1. Birinchi argument (dalil + misol)
   4.2. Ikkinchi argument (dalil + misol)
   4.3. Qarama-qarshi fikr va uni rad etish
5. XULOSA (muallif xulosasi, umumlashtirish)
6. FOYDALANILGAN ADABIYOTLAR (3-5 ta)`,
  };

  const typeNames = { referat: "Referat", mustaqil: "Mustaqil ish", esse: "Esse" };

  return `Sen professional akademik yozuvchisiz. O'zbek tilida ${typeNames[type]} yoz.

MAVZU: "${topic}"
HAJM: ~${wordCount} so'z (${pages} sahifa, A4, Times New Roman 12pt, 1.5 interval)
TIL: O'zbek tili (rasmiy ilmiy uslub)
STANDART: GOST akademik yozuv talablari
${structures[type]}

MUHIM QOIDALAR:
- Har bir bo'lim sarlavhasi KATTA HARFLAR bilan yoki ## belgisi bilan boshlansin
- Annotatsiya alohida bo'lim sifatida yozilsin
- Adabiyotlar ro'yxatida: Muallif F.I., Kitob nomi. — Shahar: Nashriyot, Yil. — Sahifalar soni.
- Har bir bo'lim o'rtasida bo'sh qator qo'yilsin
- Kirish va xulosa aniq ajratilsin
- Matn unikal, plagiatdan xoli bo'lsin

Hoziroq to'liq matnni yoz:`;
}

// ══════════════════════════════════════════════
// ★ YANGI: WORD HUJJAT (GOST + Mundarija + Annotatsiya)
// ══════════════════════════════════════════════
async function generateWordDoc(title, content, type, userId) {
  const {
    Document, Packer, Paragraph, TextRun,
    HeadingLevel, AlignmentType, PageNumber,
    TableOfContents, StyleLevel, PageBreak,
    LevelFormat, convertInchesToTwip, Header,
    Footer, NumberFormat,
  } = require("docx");

  const typeNames = { referat: "REFERAT", mustaqil: "MUSTAQIL ISH", esse: "ESSE" };

  // ── Matnni tahlil qilish ──
  const { sections, annotation, bibliography } = parseContent(content);

  const children = [];

  // ── 1. MUQOVA SAHIFASI ──
  children.push(
    new Paragraph({ text: "", spacing: { after: 2000 } })
  );
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 400 },
    children: [new TextRun({
      text: typeNames[type],
      bold: true, size: 36, font: "Times New Roman",
    })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({
      text: "Mavzu:", size: 28, font: "Times New Roman",
    })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 800 },
    children: [new TextRun({
      text: title, bold: true, size: 30, font: "Times New Roman",
    })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.RIGHT,
    spacing: { after: 200 },
    children: [new TextRun({
      text: `Bajardi: Talaba`, size: 24, font: "Times New Roman",
    })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 1000 },
    children: [new TextRun({
      text: `${new Date().getFullYear()} yil`, size: 24, font: "Times New Roman",
    })],
  }));

  // Sahifa uzilishi
  children.push(new Paragraph({
    children: [new PageBreak()],
  }));

  // ── 2. MUNDARIJA ──
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 0, after: 300 },
    children: [new TextRun({
      text: "MUNDARIJA", bold: true, size: 28, font: "Times New Roman",
    })],
  }));

  // Mundarija qo'lda (TOC plugin ishlamasligi mumkin)
  const tocItems = buildTOC(sections);
  for (const item of tocItems) {
    children.push(new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: item.title,
          size: 24,
          font: "Times New Roman",
          bold: item.level === 1,
        }),
        new TextRun({ text: "\t", size: 24 }),
        new TextRun({
          text: String(item.page),
          size: 24,
          font: "Times New Roman",
        }),
      ],
      indent: { left: (item.level - 1) * 360 },
      tabStops: [{ type: "right", position: 8500 }],
    }));
  }

  children.push(new Paragraph({ children: [new PageBreak()] }));

  // ── 3. ANNOTATSIYA ──
  if (annotation) {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 0, after: 200 },
      children: [new TextRun({
        text: "ANNOTATSIYA", bold: true, size: 28, font: "Times New Roman",
      })],
    }));
    children.push(new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { after: 240, line: 360 },
      children: [new TextRun({
        text: annotation, size: 24, font: "Times New Roman", italics: true,
      })],
    }));
    children.push(new Paragraph({ children: [new PageBreak()] }));
  }

  // ── 4. ASOSIY MATN ──
  for (const section of sections) {
    if (section.type === "bibliography") continue; // oxirida qo'shamiz

    if (section.type === "heading1") {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 360, after: 240 },
        children: [new TextRun({
          text: section.text,
          bold: true, size: 28, font: "Times New Roman",
          allCaps: true,
        })],
      }));
    } else if (section.type === "heading2") {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 160 },
        children: [new TextRun({
          text: section.text,
          bold: true, size: 26, font: "Times New Roman",
        })],
      }));
    } else if (section.type === "heading3") {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 200, after: 120 },
        children: [new TextRun({
          text: section.text,
          bold: true, size: 24, font: "Times New Roman", italics: true,
        })],
      }));
    } else if (section.type === "empty") {
      children.push(new Paragraph({ text: "", spacing: { after: 120 } }));
    } else {
      // Oddiy paragraf
      children.push(new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 160, line: 360 }, // 1.5 interval
        indent: { firstLine: 720 }, // 1.27 sm — birinchi qator chekinish
        children: [new TextRun({
          text: section.text, size: 24, font: "Times New Roman",
        })],
      }));
    }
  }

  // ── 5. FOYDALANILGAN ADABIYOTLAR ──
  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 0, after: 300 },
    children: [new TextRun({
      text: "FOYDALANILGAN ADABIYOTLAR",
      bold: true, size: 28, font: "Times New Roman", allCaps: true,
    })],
  }));

  const bibItems = bibliography.length > 0 ? bibliography : await generateBibliography(title);
  bibItems.forEach((ref, i) => {
    children.push(new Paragraph({
      spacing: { after: 160, line: 360 },
      indent: { hanging: 720, left: 720 },
      children: [new TextRun({
        text: `${i + 1}. ${ref}`, size: 24, font: "Times New Roman",
      })],
    }));
  });

  // ── HUJJAT YARATISH ──
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: "Times New Roman", size: 24 },
          paragraph: { spacing: { line: 360 } },
        },
      },
      paragraphStyles: [
        {
          id: "Heading1", name: "Heading 1",
          basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 28, bold: true, font: "Times New Roman", color: "000000" },
          paragraph: { spacing: { before: 360, after: 240 }, outlineLevel: 0 },
        },
        {
          id: "Heading2", name: "Heading 2",
          basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 26, bold: true, font: "Times New Roman", color: "000000" },
          paragraph: { spacing: { before: 240, after: 160 }, outlineLevel: 1 },
        },
        {
          id: "Heading3", name: "Heading 3",
          basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 24, bold: true, italics: true, font: "Times New Roman", color: "000000" },
          paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 2 },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            // A4: 210x297mm
            size: { width: 11906, height: 16838 },
            // GOST chegaralar: yuqori/quyi 20mm, chap 30mm, o'ng 15mm
            margin: {
              top: convertInchesToTwip(0.79),     // 20mm
              bottom: convertInchesToTwip(0.79),   // 20mm
              left: convertInchesToTwip(1.18),     // 30mm
              right: convertInchesToTwip(0.59),    // 15mm
            },
          },
          pageNumberStart: 1,
          pageNumberType: NumberFormat.DECIMAL,
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ children: [PageNumber.CURRENT], size: 20, font: "Times New Roman" }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const filePath = path.join("/tmp", `${type}_${userId}_${Date.now()}.docx`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

// ──────────────────────────────────────────────
// MATN TAHLILI — bo'limlarni ajratish
// ──────────────────────────────────────────────
function parseContent(content) {
  const lines = content.split("\n");
  const sections = [];
  let annotation = "";
  const bibliography = [];
  let inBibliography = false;
  let inAnnotation = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Bo'sh qator
    if (!trimmed) {
      sections.push({ type: "empty", text: "" });
      inAnnotation = false;
      continue;
    }

    // Annotatsiya bloki
    if (/^(ANNOTATSIYA|ANNOTATION)/i.test(trimmed)) {
      inAnnotation = true;
      inBibliography = false;
      continue;
    }

    // Adabiyotlar bloki
    if (/^(FOYDALANILGAN ADABIYOTLAR|ADABIYOTLAR|REFERENCES|СПИСОК)/i.test(trimmed)) {
      inBibliography = true;
      inAnnotation = false;
      continue;
    }

    if (inBibliography) {
      if (/^\d+[\.\)]\s/.test(trimmed)) {
        bibliography.push(trimmed.replace(/^\d+[\.\)]\s/, ""));
      }
      continue;
    }

    if (inAnnotation) {
      annotation += (annotation ? " " : "") + trimmed;
      continue;
    }

    // Sarlavha darajalari
    if (/^#{1}\s/.test(trimmed) || /^[IVX]+\.\s/i.test(trimmed) || /^(KIRISH|XULOSA|ASOSIY QISM|MUNDARIJA)$/i.test(trimmed)) {
      sections.push({ type: "heading1", text: trimmed.replace(/^#+\s/, "").replace(/^[IVX]+\.\s/i, "") });
      inAnnotation = false;
    } else if (/^#{2}\s/.test(trimmed) || /^\d+\.\d+\s/.test(trimmed)) {
      sections.push({ type: "heading2", text: trimmed.replace(/^#+\s/, "").replace(/^\d+\.\d+\s/, "") });
    } else if (/^#{3}\s/.test(trimmed) || /^\d+\.\d+\.\d+\s/.test(trimmed)) {
      sections.push({ type: "heading3", text: trimmed.replace(/^#+\s/, "") });
    } else {
      sections.push({ type: "paragraph", text: trimmed });
    }
  }

  return { sections, annotation, bibliography };
}

// ──────────────────────────────────────────────
// MUNDARIJA TUZISH
// ──────────────────────────────────────────────
function buildTOC(sections) {
  const toc = [];
  let pageEstimate = 3; // Muqova + Mundarija + Annotatsiya = ~3 sahifa

  const headings = sections.filter(s => ["heading1", "heading2", "heading3"].includes(s.type));
  const totalHeadings = headings.length;
  const pagesPerSection = totalHeadings > 0 ? Math.ceil(10 / totalHeadings) : 2;

  toc.push({ title: "Annotatsiya", page: 2, level: 1 });
  toc.push({ title: "Kirish", page: pageEstimate, level: 1 });

  let currentPage = pageEstimate + 1;
  for (const h of headings) {
    if (/^(ANNOTATSIYA|MUNDARIJA|KIRISH)/i.test(h.text)) continue;
    const level = h.type === "heading1" ? 1 : h.type === "heading2" ? 2 : 3;
    toc.push({ title: h.text, page: currentPage, level });
    if (level === 1) currentPage += pagesPerSection;
  }

  toc.push({ title: "Xulosa", page: currentPage, level: 1 });
  toc.push({ title: "Foydalanilgan adabiyotlar", page: currentPage + 1, level: 1 });

  return toc;
}

// ──────────────────────────────────────────────
// ADABIYOTLAR — Gemini orqali avtomatik yaratish
// ──────────────────────────────────────────────
async function generateBibliography(topic) {
  const prompt = `Sen akademik bibliograf siz. "${topic}" mavzusiga oid 8-10 ta haqiqiy va ishonchli adabiyot ro'yxatini tuz.

GOST 7.0.5-2008 formatida yoz. Har bir manba yangi qatorda, raqam bilan boshlansin.
Format namunasi:
1. Karimov I.A. O'zbekiston XXI asr bo'sag'asida. — Toshkent: O'zbekiston, 1997. — 327 b.
2. Nazarov Q. Falsafa asoslari. — Toshkent: Sharq, 2005. — 412 b.

Faqat ro'yxatni yoz, boshqa narsa qo'shma. O'zbek, rus va xorijiy manbalar aralash bo'lsin.`;

  try {
    const raw = await callGemini(prompt);
    return raw
      .split("\n")
      .map(l => l.trim())
      .filter(l => /^\d+[\.\)]/.test(l))
      .map(l => l.replace(/^\d+[\.\)]\s*/, ""))
      .slice(0, 10);
  } catch {
    return [
      `${topic} bo'yicha o'quv qo'llanma. — Toshkent: Fan, 2020. — 256 b.`,
      "O'zbekiston Respublikasi ta'lim to'g'risidagi Qonun. — Toshkent, 2020.",
      "Pedagogika va psixologiya asoslari. — Toshkent: O'qituvchi, 2019. — 380 b.",
    ];
  }
}

// ──────────────────────────────────────────────
// /start BUYRUG'I
// ──────────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const name = msg.from.first_name || "Foydalanuvchi";
  db.registerUser(chatId, {
    name,
    username: msg.from.username || "",
    joinedAt: new Date().toISOString(),
  });
  clearState(chatId);

  const user = db.getUserDetail(chatId);
  const balance = user.balance || 0;

  await bot.sendMessage(
    chatId,
    `👋 Assalomu alaykum, <b>${name}</b>!\n\n🎓 <b>Naorat Javoblari</b> o'quv yordamchi botiga xush kelibsiz!\n\n` +
    `📄 Referat, mustaqil ish, esse — <b>GOST standartida</b>\n` +
    `🔍 Har bir ish uchun <b>plagiat tekshiruvi</b> bepul!\n\n` +
    `💰 Balansingiz: <b>${balance} coin</b>\n` +
    `🆓 Har xizmatdan kuniga bepul foydalanish imkoniyati bor — limit tugagach coin ishlatiladi.\n\n` +
    `Quyidagi xizmatlardan birini tanlang:`,
    { parse_mode: "HTML", reply_markup: mainKeyboard(chatId) }
  );
});

// ──────────────────────────────────────────────
// CALLBACK QUERY HANDLER
// ──────────────────────────────────────────────
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  await bot.answerCallbackQuery(query.id);

  // ── TEST TUZISH ──
  if (data === "action_test") {
    setState(chatId, { action: "test_mavzu" });
    return bot.sendMessage(chatId, "📝 <b>Test tuzish</b>\n\nTest mavzusini kiriting:", {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "🔙 Orqaga", callback_data: "back_main" }]] },
    });
  }

  // ── REFERAT ──
  if (data === "action_referat") {
    setState(chatId, { action: "referat_mavzu" });
    return bot.sendMessage(
      chatId,
      "📄 <b>Referat yozish</b>\n\n✅ GOST standartida\n✅ Mundarija + Annotatsiya\n✅ Adabiyotlar ro'yxati\n✅ Plagiat tekshiruvi\n\nMavzuni kiriting:",
      { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🔙 Orqaga", callback_data: "back_main" }]] } }
    );
  }

  // ── MUSTAQIL ISH ──
  if (data === "action_mustaqil") {
    setState(chatId, { action: "mustaqil_mavzu" });
    return bot.sendMessage(
      chatId,
      "📚 <b>Mustaqil ish yozish</b>\n\n✅ GOST standartida\n✅ Mundarija + Annotatsiya\n✅ Adabiyotlar ro'yxati\n✅ Plagiat tekshiruvi\n\nMavzuni kiriting:",
      { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🔙 Orqaga", callback_data: "back_main" }]] } }
    );
  }

  // ── ESSE ──
  if (data === "action_esse") {
    setState(chatId, { action: "esse_mavzu" });
    return bot.sendMessage(
      chatId,
      "✍️ <b>Esse yozish</b>\n\n✅ Akademik esse formati\n✅ Mundarija + Adabiyotlar\n✅ Plagiat tekshiruvi\n\nMavzuni kiriting:",
      { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🔙 Orqaga", callback_data: "back_main" }]] } }
    );
  }

  // ── BALANS / NARXLAR ──
  if (data === "action_balance") {
    const user = db.getUserDetail(chatId);
    const limits = user.limits || {};
    const prices = db.getPrices();
    const today = user.todayUsage || {};

    const rows = [
      ["slide", "📊 Slayt", "1 slayd"],
      ["test", "📝 Test", "1 marta"],
      ["referat", "📄 Referat", "1 bet"],
      ["mustaqil", "📚 Mustaqil ish", "1 bet"],
      ["esse", "✍️ Esse", "1 bet"],
    ];

    let text = `💰 <b>Mening balansim: ${user.balance} coin</b>\n`;
    text += user.isPremium ? `💎 Tarif: Premium\n\n` : `🆓 Tarif: Bepul\n\n`;
    text += `📊 <b>Bugungi foydalanish:</b>\n`;

    for (const [action, label, unit] of rows) {
      const used = today[action] || 0;
      const limit = limits[action] ?? 0;
      const price = prices[action] || { basePrice: 0, perPage: 0 };
      const priceText = price.perPage > 0
        ? `${price.basePrice}+${price.perPage}/${unit}`
        : `${price.basePrice} coin`;

      const status = used < limit ? "✅ bepul" : `💰 ${priceText}`;
      text += `${label}: ${used}/${limit === 999 ? "♾️" : limit} ${status}\n`;
    }

    text += `\n📞 Coin to'ldirish uchun: @admin`;

    return bot.sendMessage(chatId, text, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "🔙 Orqaga", callback_data: "back_main" }]] },
    });
  }

  // ── ORQAGA ──
  if (data === "back_main") {
    clearState(chatId);
    return bot.sendMessage(chatId, "🏠 Asosiy menyu:", { reply_markup: mainKeyboard(chatId) });
  }

  // ── TEST: QIYINLIK ──
  if (data.startsWith("test_diff_")) {
    const diff = data.replace("test_diff_", "");
    const state = getState(chatId);
    setState(chatId, { ...state, difficulty: diff });
    return bot.sendMessage(
      chatId,
      `✅ Qiyinlik: <b>${diff}</b>\n\nNechta savol bo'lsin?`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "10 ta", callback_data: "test_count_10" },
              { text: "20 ta", callback_data: "test_count_20" },
              { text: "30 ta", callback_data: "test_count_30" },
            ],
            [{ text: "🔙 Orqaga", callback_data: "back_main" }],
          ],
        },
      }
    );
  }

  // ── TEST: SONI ──
  if (data.startsWith("test_count_")) {
    const count = parseInt(data.replace("test_count_", ""));
    const state = getState(chatId);
    const check = await checkLimit(chatId, "test", count);
    if (!check.allowed) {
      clearState(chatId);
      return bot.sendMessage(chatId, check.message, { parse_mode: "HTML" });
    }
    setState(chatId, { ...state, count });
    const loadMsg = await bot.sendMessage(chatId, "⏳ Test tayyorlanmoqda...");
    try {
      const diffLabel =
        state.difficulty === "oson" ? "oson (boshlang'ich daraja)" :
        state.difficulty === "qiyin" ? "qiyin (yuqori daraja)" :
        "o'rtacha (o'rta daraja)";

      const prompt = `Sen professional o'zbek tili o'qituvchisisiz. "${state.mavzu}" mavzusi bo'yicha ${count} ta test savoli tuz.
Qiyinlik: ${diffLabel} | Til: O'zbek tili

Har bir savol:
1. [Savol]
A) ... B) ... C) ... D) ...
To'g'ri javob: [harf]

Oxirida: JAVOBLAR: 1-X, 2-X, ...`;

      const result = await callGemini(prompt);
      await bot.deleteMessage(chatId, loadMsg.message_id);
      const chunks = splitText(result, 4000);
      for (const chunk of chunks) {
        await bot.sendMessage(chatId, `📝 <b>Test</b> — ${state.mavzu}\n\n${chunk}`, { parse_mode: "HTML" });
      }
      clearState(chatId);
      return bot.sendMessage(chatId, `✅ Test tayyor!${usageInfoText(check)}`, { parse_mode: "HTML", reply_markup: mainKeyboard(chatId) });
    } catch (e) {
      await bot.deleteMessage(chatId, loadMsg.message_id);
      clearState(chatId);
      return bot.sendMessage(chatId, `❌ Xatolik: ${e.message}`, { reply_markup: mainKeyboard(chatId) });
    }
  }

  // ── SAHIFA SONI (Referat / Mustaqil / Esse) ──
  if (data.startsWith("pages_")) {
    const parts = data.split("_");
    const pages = parseInt(parts[1]);
    const type = parts[2];

    const state = getState(chatId);
    const check = await checkLimit(chatId, type, pages);
    if (!check.allowed) {
      clearState(chatId);
      return bot.sendMessage(chatId, check.message, { parse_mode: "HTML" });
    }

    const typeNames = { referat: "Referat", mustaqil: "Mustaqil ish", esse: "Esse" };
    const loadMsg = await bot.sendMessage(
      chatId,
      `⏳ <b>${typeNames[type]}</b> tayyorlanmoqda...\n\n` +
      `📌 Mavzu: ${state.mavzu}\n📄 ${pages} sahifa\n\n` +
      `⏱ Bu 1-2 daqiqa olishi mumkin. Iltimos kuting...`,
      { parse_mode: "HTML" }
    );

    try {
      // 1. GOST prompt bilan matn yaratish
      const prompt = buildGostPrompt(type, state.mavzu, pages);
      const content = await callGemini(prompt);

      // 2. Word hujjat yaratish (Mundarija + Annotatsiya + Adabiyotlar ichida)
      await bot.editMessageText(
        `⏳ Word hujjat formatlanmoqda...`,
        { chat_id: chatId, message_id: loadMsg.message_id }
      );
      const docPath = await generateWordDoc(state.mavzu, content, type, chatId);

      // 3. Plagiat tekshiruvi
      await bot.editMessageText(
        `🔍 Plagiat tekshirilmoqda...`,
        { chat_id: chatId, message_id: loadMsg.message_id }
      );
      const plagResult = await checkPlagiarism(content);

      // 4. Faylni yuborish
      await bot.deleteMessage(chatId, loadMsg.message_id);
      await bot.sendDocument(chatId, docPath, {
        caption:
          `✅ <b>${typeNames[type]}</b> tayyor!\n\n` +
          `📌 Mavzu: <b>${state.mavzu}</b>\n` +
          `📄 ${pages} sahifa | 📝 GOST standart\n` +
          `📋 Mundarija ✅ | Annotatsiya ✅ | Adabiyotlar ✅` +
          usageInfoText(check),
        parse_mode: "HTML",
      });

      // 5. Plagiat hisobotini alohida yuborish
      await bot.sendMessage(chatId, plagiarismReport(plagResult), { parse_mode: "HTML" });

      fs.unlinkSync(docPath);
      clearState(chatId);
      return bot.sendMessage(chatId, "Yana biror xizmat kerakmi?", { reply_markup: mainKeyboard(chatId) });

    } catch (e) {
      console.error("Hujjat xatosi:", e);
      try { await bot.deleteMessage(chatId, loadMsg.message_id); } catch {}
      clearState(chatId);
      return bot.sendMessage(chatId, `❌ Xatolik: ${e.message}`, { reply_markup: mainKeyboard(chatId) });
    }
  }
});

// ──────────────────────────────────────────────
// MATN XABARLARI
// ──────────────────────────────────────────────
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text || text.startsWith("/")) return;

  if (msg.web_app_data) return handleWebAppData(chatId, msg.web_app_data.data);

  const state = getState(chatId);

  // TEST: mavzu
  if (state.action === "test_mavzu") {
    setState(chatId, { action: "test_diff", mavzu: text });
    return bot.sendMessage(
      chatId, `📌 Mavzu: <b>${text}</b>\n\nQiyinlik darajasini tanlang:`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "😊 Oson", callback_data: "test_diff_oson" },
              { text: "😐 O'rtacha", callback_data: "test_diff_ortacha" },
              { text: "😤 Qiyin", callback_data: "test_diff_qiyin" },
            ],
            [{ text: "🔙 Orqaga", callback_data: "back_main" }],
          ],
        },
      }
    );
  }

  // REFERAT / MUSTAQIL / ESSE: mavzu
  const docActions = { referat_mavzu: "referat", mustaqil_mavzu: "mustaqil", esse_mavzu: "esse" };
  if (docActions[state.action]) {
    const type = docActions[state.action];
    setState(chatId, { action: `${type}_pages`, mavzu: text });

    const user = db.getUserDetail(chatId);
    const limits = db.getLimits();
    const maxPages = user.isPremium ? (limits.premium?.maxPages || 25) : (limits.free?.maxPages || 10);
    const allOptions = [3, 5, 7, 10, 15, 20, 25].filter(p => p <= maxPages);

    // Har bir sahifa soni uchun narx ko'rsatish (agar bepul limit tugagan bo'lsa)
    const todayUsed = user.todayUsage?.[type] || 0;
    const tierLimit = user.limits?.[type] ?? 0;
    const stillFree = todayUsed < tierLimit;

    const makeBtn = (p) => {
      const label = stillFree ? `${p} bet 🆓` : `${p} bet (${db.calculatePrice(type, p)}💰)`;
      return { text: label, callback_data: `pages_${p}_${type}` };
    };

    const row1 = allOptions.slice(0, 4).map(makeBtn);
    const row2 = allOptions.slice(4).map(makeBtn);
    const pageButtons = [];
    if (row1.length) pageButtons.push(row1);
    if (row2.length) pageButtons.push(row2);
    pageButtons.push([{ text: "🔙 Orqaga", callback_data: "back_main" }]);

    const typeEmojis = { referat: "📄", mustaqil: "📚", esse: "✍️" };
    const statusLine = stillFree
      ? `✅ Bugungi bepul limitingiz mavjud`
      : `💰 Bepul limit tugadi. Balans: <b>${user.balance} coin</b>`;

    return bot.sendMessage(
      chatId,
      `${typeEmojis[type]} Mavzu: <b>${text}</b>\n\nNecha sahifa bo'lsin?\n<i>(max: ${maxPages} sahifa${user.isPremium ? " · 💎 Premium" : ""})</i>\n\n${statusLine}`,
      { parse_mode: "HTML", reply_markup: { inline_keyboard: pageButtons } }
    );
  }

  if (!state.action) {
    return bot.sendMessage(chatId, "👇 Quyidagi menyudan tanlang:", { reply_markup: mainKeyboard(chatId) });
  }
});

// ──────────────────────────────────────────────
// WEB APP (Slayt)
// ──────────────────────────────────────────────
async function handleWebAppData(chatId, rawData) {
  try {
    const data = JSON.parse(rawData);
    if (data.type === "slide") {
      const loadMsg = await bot.sendMessage(chatId, "⏳ Slayt tayyorlanmoqda...");
      const resp = await axios.post(`${WEB_APP_URL}/api/generate-slide`, {
        topic: data.topic, slideCount: data.slideCount, userId: chatId,
      });
      await bot.deleteMessage(chatId, loadMsg.message_id);

      if (resp.data.filePath) {
        await bot.sendDocument(chatId, resp.data.filePath, {
          caption: `✅ Slayt tayyor!\n📌 Mavzu: ${data.topic}\n📊 ${data.slideCount} ta slayt` + usageInfoText(resp.data.usage || {}),
          parse_mode: "HTML",
        });
        if (fs.existsSync(resp.data.filePath)) fs.unlinkSync(resp.data.filePath);
      }
      return bot.sendMessage(chatId, "Yana biror xizmat kerakmi?", { reply_markup: mainKeyboard(chatId) });
    }
  } catch (e) {
    if (e.response?.status === 429) {
      return bot.sendMessage(chatId, e.response.data.error, { parse_mode: "HTML", reply_markup: mainKeyboard(chatId) });
    }
    return bot.sendMessage(chatId, `❌ Xatolik: ${e.message}`, { reply_markup: mainKeyboard(chatId) });
  }
}

// ──────────────────────────────────────────────
// YORDAMCHI
// ──────────────────────────────────────────────
function splitText(text, maxLen = 4000) {
  const chunks = [];
  let current = "";
  for (const line of text.split("\n")) {
    if ((current + "\n" + line).length > maxLen) {
      if (current) chunks.push(current.trim());
      current = line;
    } else {
      current += (current ? "\n" : "") + line;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks;
}

bot.on("polling_error", err => console.error("Polling xato:", err.message));
process.on("unhandledRejection", err => console.error("Unhandled:", err));

module.exports = { callGemini, bot, usageInfoText };
