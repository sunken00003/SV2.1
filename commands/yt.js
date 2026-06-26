"use strict";
/**
 * yt.js v6.0 — يعمل محلياً على نفس منفذ Render (Node.js 22)
 * ══════════════════════════════════════════════════════════════
 * التدفق الكامل:
 *
 *   المستخدم (فيسبوك)
 *       ↓ أمر بحث
 *   yt.js  →  POST http://localhost:PORT/yt/search  {"query":"..."}
 *       ↓
 *   index.js (نفس العملية)  →  @vreden/youtube_scraper  →  YouTube
 *       ↓ نتائج JSON
 *   yt.js  →  يعرض قائمة 10 نتائج
 *       ↓ المستخدم يختار (رقم أو إيموجي)
 *   yt.js  →  POST http://localhost:PORT/yt/audio|video  {"url":"..."}
 *       ↓
 *   index.js  →  ytmp3/ytmp4 (@vreden/youtube_scraper)  →  YouTube
 *       ↓ Stream (MP3/MP4)
 *   yt.js  →  يرسل الملف + ستيكر للمستخدم
 *
 * لا حاجة لمتغيرات بيئة خارجية — كل شيء يعمل داخل نفس عملية Node.js
 * على نفس منفذ Render (process.env.PORT).
 * ══════════════════════════════════════════════════════════════
 */

const axios = require("axios");
const fs    = require("fs-extra");
const os    = require("os");
const path  = require("path");

// 🕺 ستيكرز الرقص أصبحت تُجلب من HF Space (الفضاء الموازي) عبر HTTP
// بدل تخزينها محلياً في ريبو Sv2 — انظر utils/danceSticker.js
const { sendMoodSticker } = require("../utils/danceSticker.js");

// ─── عنوان السيرفر المحلي داخل Render (نفس المنفذ) ──────────
const HF = `http://localhost:${process.env.PORT || 10000}`;

// ─── 10 أزواج إيموجي (mp3 | mp4) ────────────────────────────
const EMOJI_PAIRS = [
  ["👍", "❤️"], ["😆", "😮"], ["😢", "😡"],
  ["🥰", "👏"], ["🔥", "💯"], ["😍", "😭"],
  ["🤔", "👀"], ["🎉", "🎊"], ["💙", "💜"], ["🌟", "⭐"],
];

// ═══════════════════════════════════════════════════════════════
// 🔍  البحث — يُرسَل لـ yt.py الذي يُوجّهه لـ CF Worker
// yt.js  →  POST {HF}/yt/search  →  yt.py  →  CF Worker  →  YouTube
// ═══════════════════════════════════════════════════════════════
async function ytSearch(query, limit = 10) {

  const { data } = await axios.post(
    `${HF}/yt/search`,
    { query, limit },
    { timeout: 30000, headers: { "Content-Type": "application/json" } }
  );

  if (!data.results?.length) throw new Error("لا توجد نتائج");
  return data.results;  // [{title, url, duration, uploader, id}, ...]
}

// ═══════════════════════════════════════════════════════════════
// ⬇️  تحميل — يُرسَل الرابط المختار لـ yt.py الذي يُحمّله عبر CF Worker
// yt.js  →  POST {HF}/yt/audio|video  →  yt.py  →  CF proxy  →  YouTube
// ═══════════════════════════════════════════════════════════════
async function downloadFromHF(ytUrl, wantMp4) {

  const endpoint = wantMp4 ? "/yt/video" : "/yt/audio";
  const ext      = wantMp4 ? "mp4" : "mp3";
  const filePath = path.join(os.tmpdir(), `yt_${Date.now()}.${ext}`);

  const res = await axios.post(
    `${HF}${endpoint}`,
    { url: ytUrl },
    {
      responseType:     "arraybuffer",
      timeout:          5 * 60 * 1000,           // 5 دقائق
      maxContentLength: 45 * 1024 * 1024,
      maxBodyLength:    45 * 1024 * 1024,
      headers: { "Content-Type": "application/json" },
    }
  );

  // تحقق: هل الرد JSON خطأ من yt.py؟
  const ct = res.headers["content-type"] || "";
  if (ct.includes("application/json")) {
    const errText = Buffer.from(res.data).toString();
    let errMsg = "خطأ غير معروف من HF Space";
    try { errMsg = JSON.parse(errText).error || errMsg; } catch (_) {}
    throw new Error(errMsg);
  }

  const buf = Buffer.from(res.data);
  if (!buf.length) throw new Error("الملف فارغ");

  await fs.writeFile(filePath, buf);

  return {
    stream:   fs.createReadStream(filePath),
    filePath,
    title:    decodeHeader(res.headers["x-title"])    || "media",
    duration: res.headers["x-duration"]               || "0",
    uploader: decodeHeader(res.headers["x-uploader"]) || "",
  };
}

function decodeHeader(h) {
  if (!h) return "";
  try { return decodeURIComponent(h); } catch (_) { return h; }
}

async function cleanTemp(p) {
  try { if (p && await fs.pathExists(p)) await fs.remove(p); } catch (_) {}
}

// ═══════════════════════════════════════════════════════════════
// 📤  تحميل + إرسال الملف + ستيكر رقص
// ═══════════════════════════════════════════════════════════════
async function downloadAndSend(api, threadID, statusMsgId, ytUrl, wantMp4) {
  const update = async (t) => {
    try { if (statusMsgId) await api.editMessage(t, statusMsgId); } catch (_) {}
  };

  let filePath = null;
  try {
    const dl = await downloadFromHF(ytUrl, wantMp4);
    filePath  = dl.filePath;

    const fmtDur = (sec) => {
      const s = parseInt(sec) || 0;
      if (!s) return "";
      const m = Math.floor(s / 60), ss = s % 60;
      return ` ⏱ ${m}:${String(ss).padStart(2, "0")}`;
    };

    const body =
      `${wantMp4 ? "🎬" : "🎵"} ${dl.title}` +
      `${fmtDur(dl.duration)}` +
      `${dl.uploader ? `\n📺 ${dl.uploader}` : ""}` +
      `\n🎚 ${wantMp4 ? "360p" : "128kbps"}`;

    await new Promise((res, rej) =>
      api.sendMessage(
        { body, attachment: dl.stream },
        threadID,
        err => err ? rej(err) : res()
      )
    );

    // احذف رسالة الانتظار
    try { if (statusMsgId) api.unsendMessage(statusMsgId, threadID); } catch (_) {}

    // 🕺 ستيكر رقص — فقط عند تحميل mp3 (الصوت)
    if (!wantMp4) await sendMoodSticker(api, threadID, dl.title);

  } catch (err) {
    let msg = err.message || "خطأ غير معروف";
    if (err.response?.data) {
      try {
        const t = Buffer.isBuffer(err.response.data)
          ? err.response.data.toString()
          : JSON.stringify(err.response.data);
        msg = JSON.parse(t).error || msg;
      } catch (_) {}
    }
    await update(`❌ ${msg.substring(0, 160)}`);
  } finally {
    await cleanTemp(filePath);
  }
}

// ═══════════════════════════════════════════════════════════════
// 📋  بناء نص قائمة البحث
// ═══════════════════════════════════════════════════════════════
function buildListText(results) {
  let text = `🎵 نتائج البحث:\n${"─".repeat(22)}\n`;
  results.forEach((v, i) => {
    const [mp3E, mp4E] = EMOJI_PAIRS[i];
    text +=
      `${i + 1}. ${v.title}\n` +
      `   ⏱ ${v.duration || "--"}  📺 ${v.uploader || ""}\n` +
      `   ${mp3E} mp3  |  ${mp4E} mp4\n` +
      `${"─".repeat(22)}\n`;
  });
  text += `🔢 رُد بالرقم (مثال: 3 mp4)\nأو تفاعل بالإيموجي\n⏳ تنتهي بعد دقيقتين`;
  return text;
}

// ═══════════════════════════════════════════════════════════════
module.exports = {
  config: {
    name:        "yt",
    aliases:     ["يوتيوب"],
    version:     "5.0",
    role:        0,
    countDown:   15,
    category:    "download",
    description: "تحميل الصوت والفيديو من يوتيوب — بحث بالاسم أو تحميل مباشر برابط (MP3 128kbps | MP4 360p)",
    guide: { en:
      "{pn} <اسم>        — بحث + قائمة 10 نتائج\n" +
      "{pn} mp4 <اسم>    — بحث + قائمة (فيديو)\n" +
      "{pn} <رابط>       — تحميل مباشر MP3 128k\n" +
      "{pn} mp4 <رابط>   — تحميل مباشر MP4 360p"
    }
  },

  // ─────────────────────────────────────────────────────────────
  onStart: async ({ api, message, args, event }) => {
    const { threadID, messageID } = event;

    if (!args[0]) return message.reply(
      "📥 يوتيوب دونلودر\n\n" +
      "🎵 .yt <اسم أغنية>    — بحث وقائمة\n" +
      "🎬 .yt mp4 <اسم>      — بحث وقائمة فيديو\n" +
      "🔗 .yt <رابط>         — تحميل مباشر MP3\n" +
      "🎬 .yt mp4 <رابط>     — تحميل مباشر MP4\n\n" +
      "🎚 الجودة: صوت 128kbps | فيديو 360p"
    );

    const sub     = args[0].toLowerCase();
    const wantMp4 = sub === "mp4";
    const hasFlag = ["mp4", "mp3"].includes(sub);
    const query   = (hasFlag ? args.slice(1) : args).join(" ").trim();

    if (!query) return message.reply("❌ أرسل اسم الأغنية أو الرابط.");

    const isUrl = /^https?:\/\//i.test(query);

    // ── تحميل مباشر برابط ───────────────────────────────────
    if (isUrl) {
      let statusMsgId = null;
      try {
        const sent = await new Promise((res, rej) =>
          api.sendMessage(
            `⏳ ${wantMp4 ? "🎬 جارٍ تحميل الفيديو 360p..." : "🎵 جارٍ تحميل الصوت 128k..."}`,
            threadID,
            (err, info) => err ? rej(err) : res(info),
            messageID
          )
        );
        statusMsgId = sent?.messageID;
      } catch (_) {}
      await downloadAndSend(api, threadID, statusMsgId, query, wantMp4);
      return;
    }

    // ── بحث بالاسم ──────────────────────────────────────────
    let statusMsgId = null;
    try {
      const sent = await new Promise((res, rej) =>
        api.sendMessage(
          `🔍 جارٍ البحث عن "${query}"...`,
          threadID,
          (err, info) => err ? rej(err) : res(info),
          messageID
        )
      );
      statusMsgId = sent?.messageID;
    } catch (_) {}

    const update = async (t) => {
      try { if (statusMsgId) await api.editMessage(t, statusMsgId); } catch (_) {}
    };

    try {
      const results = await ytSearch(query, 10);
      await update(buildListText(results));

      if (statusMsgId) {
        // onReply
        if (global.Kagenou?.replies) {
          global.Kagenou.replies[statusMsgId] = {
            commandName: "yt",
            author:      event.senderID,
            results,
            wantMp4,
            statusMsgId,
            timestamp:   Date.now(),
          };
        }

        // reactionListener (إيموجي)
        if (global.client?.reactionListener) {
          global.client.reactionListener[statusMsgId] = {
            author: event.senderID,
            callback: async ({ api, event: re }) => {
              const reaction = re.reaction;
              const idx = EMOJI_PAIRS.findIndex(([m3, m4]) => reaction === m3 || reaction === m4);
              if (idx < 0 || idx >= results.length) return;

              const wantMp4R = reaction === EMOJI_PAIRS[idx][1];
              const chosen   = results[idx];

              delete global.client.reactionListener[statusMsgId];
              if (global.Kagenou?.replies) delete global.Kagenou.replies[statusMsgId];

              await update(`⏳ جارٍ تحميل: ${chosen.title}...`);
              // ✅ يُرسَل الرابط المختار لـ yt.py → CF Worker → YouTube
              await downloadAndSend(api, threadID, statusMsgId, chosen.url, wantMp4R);
            }
          };

          setTimeout(() => {
            if (global.client.reactionListener?.[statusMsgId])
              delete global.client.reactionListener[statusMsgId];
          }, 120000);
        }
      }
    } catch (e) {
      await update(`❌ ${e.message?.substring(0, 150) || "خطأ في البحث"}`);
    }
  },

  // ─────────────────────────────────────────────────────────────
  onReply: async ({ api, event, Reply, message }) => {
    if (!Reply?.results || event.senderID !== Reply.author) return;

    const { threadID }  = event;
    const parts         = event.body?.trim().split(/\s+/) || [];
    const idx           = parseInt(parts[0]) - 1;
    const wantMp4       = parts[1]?.toLowerCase() === "mp4"
      ? true
      : parts[1]?.toLowerCase() === "mp3"
        ? false
        : Reply.wantMp4 ?? false;

    if (isNaN(idx) || idx < 0 || idx >= Reply.results.length)
      return message.reply(`❌ أرسل رقماً من 1 إلى ${Reply.results.length}\nمثال: 3 mp4`);

    const chosen      = Reply.results[idx];
    const statusMsgId = Reply.statusMsgId;

    if (global.client?.reactionListener?.[statusMsgId])
      delete global.client.reactionListener[statusMsgId];
    if (global.Kagenou?.replies?.[statusMsgId])
      delete global.Kagenou.replies[statusMsgId];

    const update = async (t) => {
      try { if (statusMsgId) await api.editMessage(t, statusMsgId); } catch (_) {}
    };

    await update(`⏳ جارٍ تحميل: ${chosen.title}...`);
    // ✅ يُرسَل الرابط المختار لـ yt.py → CF Worker → YouTube
    await downloadAndSend(api, threadID, statusMsgId, chosen.url, wantMp4);
  },
};
