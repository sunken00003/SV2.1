const axios = require("axios");
const BASE   = "https://free-goat-api.onrender.com";

// ─── طلب GET بسيط ────────────────────────────────────────────
async function apiFetch(endpoint, params = {}) {
  const query = new URLSearchParams(params).toString();
  const { data } = await axios.get(`${BASE}/${endpoint}?${query}`);
  return data;
}

// ─── استخرج أول رابط وسائط من استجابة الـ API ───────────────
// يدعم: حقول مسطّحة، كائن links{}، كائن data{}، مصفوفات
function extractUrl(data) {
  if (!data || typeof data !== "object") return null;

  // 1) حقول مسطّحة مباشرة
  const flat =
    data.videoUrl    || data.video     ||
    data.imageUrl    || data.image     ||
    data.audioUrl    || data.audio     ||
    data.url         || data.download  ||
    data.result      || data.directUrl ||
    data.hd          || data.sd        ||
    data.nowm        || data.shortUrl  ||
    data.tinyurl     || data.link      ||
    data.display_url || data.src       ||
    data.mp4        || data.mp3       || data.short_url || null;
  if (flat) return flat;

  // 2) كائن links{} — مثل { links: { mp3, mp4, video, hd, sd } }
  if (data.links && typeof data.links === "object" && !Array.isArray(data.links)) {
    const l = data.links;
    const url =
      l.video || l.mp4 || l.hd || l.sd ||
      l.mp3   || l.audio ||
      Object.values(l).find(v => typeof v === "string" && v.startsWith("http"));
    if (url) return url;
  }

  // 3) كائن data{} متداخل
  if (data.data && typeof data.data === "object") {
    return extractUrl(data.data);
  }

  // 4) مصفوفة — خذ أول عنصر
  if (Array.isArray(data) && data[0]) {
    return extractUrl(data[0]);
  }

  return null;
}

// ─── حذف رسالة الانتظار بأمان ────────────────────────────────
function safeUnsend(message, msgID) {
  const id = typeof msgID === "object" ? msgID?.messageID : msgID;
  if (!id) return;
  try {
    if (typeof message.unsend === "function") message.unsend(id);
    else if (global.botApi?.unsendMessage) global.botApi.unsendMessage(id);
  } catch (_) {}
}

// ─── رسالة انتظار ثم ترسل الملف أو النص ─────────────────────
async function sendMedia(message, waitMsg, data, body) {
  const url = extractUrl(data);

  if (!url) {
    safeUnsend(message, waitMsg.messageID);
    return message.reply("❌ لم يُعثر على محتوى.\n" + JSON.stringify(data).substring(0, 300));
  }

  safeUnsend(message, waitMsg.messageID);

  // روابط نصية (اختصار / رفع صورة)
  const isTextOnly =
    url.includes("tinyurl.com") ||
    url.includes("ibb.co") ||
    url.includes("imgbb.com");

  if (isTextOnly) {
    return message.reply(`${body}\n🔗 ${url}`);
  }

  try {
    const ext    = url.match(/\.(mp4|mp3|png|jpg|jpeg|gif|webp)/i)?.[1] || "mp4";
    // Use axios directly — global.utils is not guaranteed to exist
    const res    = await axios.get(url, { responseType: "stream", timeout: 60000 });
    return message.reply({ body, attachment: res.data });
  } catch (streamErr) {
    // إذا فشل تحميل الستريم، أرسل الرابط نصاً
    return message.reply(`${body}\n🔗 ${url}`);
  }
}

// ─── استخرج صورة من الرد أو المرفق ──────────────────────────
function getImageUrl(event) {
  const att =
    event.messageReply?.attachments?.[0] ||
    event.attachments?.[0];
  if (!att || !["photo", "sticker"].includes(att.type)) return null;
  return att.url || att.previewUrl;
}

module.exports = { apiFetch, extractUrl, sendMedia, safeUnsend, getImageUrl };
