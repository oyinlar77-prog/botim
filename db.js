// ============================================================
// db.js — Ma'lumotlar Bazasi (Fayl 2/3) — COIN TIZIMI BILAN
// JSON fayl asosida oddiy, tez, ishonchli storage
// ============================================================

const fs = require("fs");
const path = require("path");

// ──────────────────────────────────────────────
// FAYL YO'LLARI
// ──────────────────────────────────────────────
// DATA_DIR: Railway Volume mount path (masalan /data) yoki lokal "./data"
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const LIMITS_FILE = path.join(DATA_DIR, "limits.json");
const PRICES_FILE = path.join(DATA_DIR, "prices.json");
const STATS_FILE = path.join(DATA_DIR, "stats.json");

// ──────────────────────────────────────────────
// BOSHLANG'ICH SOZLAMALAR
// ──────────────────────────────────────────────

// Default kunlik LIMITLAR (necha marta/kun bepul ishlatish mumkin)
// 0 = umuman bepul ishlatib bo'lmaydi (faqat coin bilan)
// 999 = cheksiz (limit yo'q)
const DEFAULT_LIMITS = {
  free: {
    slide: 1,      // kuniga 1 marta bepul
    test: 1,       // kuniga 1 marta bepul
    referat: 1,    // kuniga 1 marta bepul
    mustaqil: 1,   // kuniga 1 marta bepul
    esse: 1,       // kuniga 1 marta bepul
    maxPages: 10,  // bepul foydalanuvchi max sahifa
  },
  premium: {
    slide: 999,
    test: 999,
    referat: 999,
    mustaqil: 999,
    esse: 999,
    maxPages: 25,
  },
};

// Default COIN NARXLARI
// referat/mustaqil/esse uchun: basePrice + (perPage * sahifa_soni)
// slide uchun: basePrice + (perPage * slayd_soni)
// test uchun: basePrice (sahifaga bog'liq emas, lekin perPage ham hisobga olinadi - savol soniga)
const DEFAULT_PRICES = {
  slide: { basePrice: 2, perPage: 1 },      // 10 slayd = 2 + 10*1 = 12 coin
  test: { basePrice: 1, perPage: 0 },       // doim 1 coin (savol soniga bog'liq emas)
  referat: { basePrice: 2, perPage: 2 },    // 10 bet = 2 + 10*2 = 22 coin
  mustaqil: { basePrice: 2, perPage: 2 },   // 10 bet = 22 coin
  esse: { basePrice: 1, perPage: 1 },       // 10 bet = 1 + 10*1 = 11 coin
};

// ──────────────────────────────────────────────
// DATA DIR YARATISH
// ──────────────────────────────────────────────
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ──────────────────────────────────────────────
// JSON O'QISH / YOZISH
// ──────────────────────────────────────────────
function readJSON(filePath, defaultValue = {}) {
  ensureDataDir();
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
      return defaultValue;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (e) {
    console.error(`JSON o'qish xatosi (${filePath}):`, e.message);
    return defaultValue;
  }
}

function writeJSON(filePath, data) {
  ensureDataDir();
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error(`JSON yozish xatosi (${filePath}):`, e.message);
    return false;
  }
}

// ──────────────────────────────────────────────
// FOYDALANUVCHILAR
// ──────────────────────────────────────────────

function getUser(chatId) {
  const users = readJSON(USERS_FILE, {});
  const id = String(chatId);
  if (!users[id]) {
    users[id] = {
      chatId: id,
      name: "",
      username: "",
      isPremium: false,
      premiumExpiry: null,
      balance: 0, // 💰 COIN BALANSI
      joinedAt: new Date().toISOString(),
      usage: {},
      totalUsage: { slide: 0, test: 0, referat: 0, mustaqil: 0, esse: 0 },
      totalSpent: 0, // jami sarflangan coin
    };
    writeJSON(USERS_FILE, users);
  }
  // Eski userlarda balance bo'lmasligi mumkin
  if (users[id].balance === undefined) users[id].balance = 0;
  if (users[id].totalSpent === undefined) users[id].totalSpent = 0;
  return users[id];
}

function saveUser(chatId, userData) {
  const users = readJSON(USERS_FILE, {});
  const id = String(chatId);
  users[id] = { ...users[id], ...userData, chatId: id };
  return writeJSON(USERS_FILE, users);
}

function registerUser(chatId, info = {}) {
  const existing = getUser(chatId);
  if (!existing.name && info.name) {
    saveUser(chatId, { ...existing, ...info });
  }
  return getUser(chatId);
}

function getAllUsers() {
  return readJSON(USERS_FILE, {});
}

function getUserCount() {
  return Object.keys(readJSON(USERS_FILE, {})).length;
}

function getAllUserIds() {
  return Object.keys(readJSON(USERS_FILE, {})).map(Number);
}

// ──────────────────────────────────────────────
// PREMIUM
// ──────────────────────────────────────────────

function setPremium(chatId, days = 30) {
  const user = getUser(chatId);
  user.isPremium = true;
  if (days === 0) {
    user.premiumExpiry = null;
  } else {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + days);
    user.premiumExpiry = expiry.toISOString();
  }
  saveUser(chatId, user);
  return user;
}

function removePremium(chatId) {
  const user = getUser(chatId);
  user.isPremium = false;
  user.premiumExpiry = null;
  saveUser(chatId, user);
  return user;
}

function checkPremiumStatus(chatId) {
  const user = getUser(chatId);
  if (!user.isPremium) return false;
  if (user.premiumExpiry) {
    if (new Date() > new Date(user.premiumExpiry)) {
      removePremium(chatId);
      return false;
    }
  }
  return true;
}

// ──────────────────────────────────────────────
// 💰 COIN / BALANS BOSHQARUVI
// ──────────────────────────────────────────────

/**
 * Balansni olish
 */
function getBalance(chatId) {
  return getUser(chatId).balance || 0;
}

/**
 * Coin qo'shish (admin)
 * @param {number} chatId
 * @param {number} amount - musbat son
 */
function addCoins(chatId, amount) {
  const user = getUser(chatId);
  user.balance = (user.balance || 0) + Math.abs(parseInt(amount));
  saveUser(chatId, user);
  return user;
}

/**
 * Coin ayirish (admin)
 */
function removeCoins(chatId, amount) {
  const user = getUser(chatId);
  user.balance = Math.max(0, (user.balance || 0) - Math.abs(parseInt(amount)));
  saveUser(chatId, user);
  return user;
}

/**
 * Coin balansni to'g'ridan-to'g'ri o'rnatish (admin)
 */
function setBalance(chatId, amount) {
  const user = getUser(chatId);
  user.balance = Math.max(0, parseInt(amount));
  saveUser(chatId, user);
  return user;
}

/**
 * Coin sarflash (foydalanuvchi tugma bosganda)
 * @returns {boolean} - true bo'lsa muvaffaqiyatli yechildi
 */
function spendCoins(chatId, amount) {
  const user = getUser(chatId);
  if ((user.balance || 0) < amount) return false;
  user.balance -= amount;
  user.totalSpent = (user.totalSpent || 0) + amount;
  saveUser(chatId, user);
  return true;
}

// ──────────────────────────────────────────────
// 💵 NARXLAR (PRICES)
// ──────────────────────────────────────────────

function getPrices() {
  const saved = readJSON(PRICES_FILE, DEFAULT_PRICES);
  const merged = {};
  for (const key of Object.keys(DEFAULT_PRICES)) {
    merged[key] = { ...DEFAULT_PRICES[key], ...(saved[key] || {}) };
  }
  return merged;
}

function setPrice(action, basePrice, perPage) {
  const prices = getPrices();
  if (!prices[action]) prices[action] = { basePrice: 0, perPage: 0 };
  if (basePrice !== undefined) prices[action].basePrice = parseFloat(basePrice);
  if (perPage !== undefined) prices[action].perPage = parseFloat(perPage);
  writeJSON(PRICES_FILE, prices);
  return prices;
}

/**
 * Narxni hisoblash
 * @param {string} action - slide|test|referat|mustaqil|esse
 * @param {number} units - sahifa soni / slayd soni (test uchun e'tiborga olinmaydi agar perPage=0)
 */
function calculatePrice(action, units = 1) {
  const prices = getPrices();
  const p = prices[action] || { basePrice: 0, perPage: 0 };
  const total = p.basePrice + p.perPage * units;
  return Math.max(0, Math.round(total));
}

// ──────────────────────────────────────────────
// LIMITLAR
// ──────────────────────────────────────────────

function getLimits() {
  const saved = readJSON(LIMITS_FILE, DEFAULT_LIMITS);
  return {
    free: { ...DEFAULT_LIMITS.free, ...saved.free },
    premium: { ...DEFAULT_LIMITS.premium, ...saved.premium },
  };
}

function setLimits(newLimits) {
  const current = getLimits();
  const merged = {
    free: { ...current.free, ...(newLimits.free || {}) },
    premium: { ...current.premium, ...(newLimits.premium || {}) },
  };
  writeJSON(LIMITS_FILE, merged);
  return merged;
}

function setSingleLimit(tier, action, value) {
  const limits = getLimits();
  if (!limits[tier]) limits[tier] = {};
  limits[tier][action] = parseInt(value);
  writeJSON(LIMITS_FILE, limits);
  return limits;
}

// ──────────────────────────────────────────────
// ★ ASOSIY: FOYDALANISH TEKSHIRUVI (LIMIT + COIN)
// ──────────────────────────────────────────────

/**
 * Foydalanuvchi limit/coin holatini tekshirish (sarflamasdan, oldindan ko'rish uchun)
 * @returns {{ method: 'free'|'coin'|'blocked', used, limit, price, balance }}
 */
function previewUsage(chatId, action, units = 1) {
  const isPremium = checkPremiumStatus(chatId);
  const user = getUser(chatId);
  const limits = getLimits();
  const today = new Date().toISOString().split("T")[0];

  if (!user.usage) user.usage = {};
  if (!user.usage[today]) user.usage[today] = {};
  const used = user.usage[today][action] || 0;

  const tier = isPremium ? "premium" : "free";
  const limit = limits[tier]?.[action] ?? 0;
  const price = calculatePrice(action, units);
  const balance = user.balance || 0;

  if (used < limit) {
    return { method: "free", used, limit, price, balance, isPremium };
  }
  if (balance >= price) {
    return { method: "coin", used, limit, price, balance, isPremium };
  }
  return { method: "blocked", used, limit, price, balance, isPremium };
}

/**
 * Foydalanuvchi limitini tekshirish va ISHLATISH (bepul limit yoki coin sarflash)
 * @param {string} action - slide|test|referat|mustaqil|esse
 * @param {number} units - sahifa/slayd soni (narx hisoblash uchun)
 * @returns {{ allowed: boolean, method?: 'free'|'coin', message?: string, price?: number, balance?: number }}
 */
function checkAndUseLimit(chatId, action, units = 1) {
  const isPremium = checkPremiumStatus(chatId);
  const user = getUser(chatId);
  const limits = getLimits();
  const today = new Date().toISOString().split("T")[0];

  if (!user.usage) user.usage = {};
  if (!user.usage[today]) user.usage[today] = {};
  if (!user.usage[today][action]) user.usage[today][action] = 0;

  const used = user.usage[today][action];
  const tier = isPremium ? "premium" : "free";
  const limit = limits[tier]?.[action] ?? 0;
  const price = calculatePrice(action, units);
  const tierLabel = isPremium ? "Premium" : "Bepul";

  // 1. Bepul limit hali mavjud
  if (used < limit) {
    user.usage[today][action] = used + 1;
    if (!user.totalUsage) user.totalUsage = {};
    user.totalUsage[action] = (user.totalUsage[action] || 0) + 1;
    saveUser(chatId, user);
    updateStats(action);
    return { allowed: true, method: "free", used: used + 1, limit, price };
  }

  // 2. Coin bilan to'lash
  const balance = user.balance || 0;
  if (balance >= price) {
    user.balance = balance - price;
    user.totalSpent = (user.totalSpent || 0) + price;
    user.usage[today][action] = used + 1;
    if (!user.totalUsage) user.totalUsage = {};
    user.totalUsage[action] = (user.totalUsage[action] || 0) + 1;
    saveUser(chatId, user);
    updateStats(action);
    return {
      allowed: true,
      method: "coin",
      used: used + 1,
      limit,
      price,
      balanceLeft: user.balance,
    };
  }

  // 3. Bloklangan — limit ham tugadi, coin ham yetmaydi
  return {
    allowed: false,
    method: "blocked",
    used,
    limit,
    price,
    balance,
    message:
      `⛔ <b>Limit tugadi va coin yetarli emas!</b>\n\n` +
      `📊 Tarif: ${tierLabel}\n` +
      `🔢 ${actionLabel(action)}: kunlik bepul limit (${limit} marta) ishlatildi\n\n` +
      `💰 Sizning balansingiz: <b>${balance} coin</b>\n` +
      `💵 Bu amal narxi: <b>${price} coin</b>\n` +
      `❗️ Kerakli: <b>${price - balance} coin</b> yetishmaydi\n\n` +
      `📞 Coin to'ldirish uchun admin bilan bog'laning: @admin`,
  };
}

function actionLabel(action) {
  const labels = {
    slide: "Slayt", test: "Test", referat: "Referat",
    mustaqil: "Mustaqil ish", esse: "Esse",
  };
  return labels[action] || action;
}

// ──────────────────────────────────────────────
// STATISTIKA
// ──────────────────────────────────────────────

function updateStats(action) {
  const stats = readJSON(STATS_FILE, { total: {}, daily: {}, coinSpent: {} });
  const today = new Date().toISOString().split("T")[0];

  if (!stats.total[action]) stats.total[action] = 0;
  stats.total[action]++;

  if (!stats.daily[today]) stats.daily[today] = {};
  if (!stats.daily[today][action]) stats.daily[today][action] = 0;
  stats.daily[today][action]++;

  writeJSON(STATS_FILE, stats);
}

function getStats() {
  return readJSON(STATS_FILE, { total: {}, daily: {}, coinSpent: {} });
}

function getTodayStats() {
  const stats = getStats();
  const today = new Date().toISOString().split("T")[0];
  return stats.daily[today] || {};
}

function getLastDaysStats(days = 7) {
  const stats = getStats();
  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];
    result.push({ date: dateStr, data: stats.daily[dateStr] || {} });
  }
  return result;
}

// ──────────────────────────────────────────────
// ADMIN FUNKSIYALARI
// ──────────────────────────────────────────────

function getAdminDashboard() {
  const users = getAllUsers();
  const userList = Object.values(users);
  const stats = getStats();
  const limits = getLimits();
  const prices = getPrices();
  const today = new Date().toISOString().split("T")[0];

  const premiumUsers = userList.filter((u) => u.isPremium);
  const todayStats = stats.daily[today] || {};
  const totalActions = Object.values(stats.total || {}).reduce((a, b) => a + b, 0);
  const totalCoinsInCirculation = userList.reduce((sum, u) => sum + (u.balance || 0), 0);
  const totalCoinsSpent = userList.reduce((sum, u) => sum + (u.totalSpent || 0), 0);

  return {
    userCount: userList.length,
    premiumCount: premiumUsers.length,
    freeCount: userList.length - premiumUsers.length,
    todayStats,
    totalStats: stats.total || {},
    totalActions,
    limits,
    prices,
    totalCoinsInCirculation,
    totalCoinsSpent,
    recentUsers: userList
      .sort((a, b) => new Date(b.joinedAt) - new Date(a.joinedAt))
      .slice(0, 20),
  };
}

function getUserDetail(chatId) {
  const user = getUser(chatId);
  const isPremium = checkPremiumStatus(chatId);
  const limits = getLimits();
  const today = new Date().toISOString().split("T")[0];
  const todayUsage = user.usage?.[today] || {};
  const tier = isPremium ? "premium" : "free";

  return {
    ...user,
    isPremium,
    todayUsage,
    limits: limits[tier],
    totalUsage: user.totalUsage || {},
    balance: user.balance || 0,
  };
}

function searchUser(query) {
  const users = getAllUsers();
  const q = String(query).toLowerCase().replace("@", "");
  return Object.values(users).filter((u) => {
    return (
      String(u.chatId).includes(q) ||
      (u.username || "").toLowerCase().includes(q) ||
      (u.name || "").toLowerCase().includes(q)
    );
  });
}

function resetUserUsage(chatId) {
  const user = getUser(chatId);
  user.usage = {};
  saveUser(chatId, user);
  return user;
}

// ──────────────────────────────────────────────
// EKSPORT
// ──────────────────────────────────────────────
module.exports = {
  // Foydalanuvchilar
  getUser,
  saveUser,
  registerUser,
  getAllUsers,
  getAllUserIds,
  getUserCount,
  searchUser,
  getUserDetail,

  // Premium
  setPremium,
  removePremium,
  checkPremiumStatus,

  // 💰 Coin
  getBalance,
  addCoins,
  removeCoins,
  setBalance,
  spendCoins,

  // 💵 Narxlar
  getPrices,
  setPrice,
  calculatePrice,

  // Limitlar
  getLimits,
  setLimits,
  setSingleLimit,

  // Asosiy tekshiruv
  checkAndUseLimit,
  previewUsage,

  // Statistika
  getStats,
  getTodayStats,
  getLastDaysStats,
  updateStats,

  // Admin
  getAdminDashboard,
  resetUserUsage,
};
