"use strict";

const axios = require("axios");
const fs    = require("fs-extra");
const os    = require("os");
const path  = require("path");

const API_BASE = "https://ccproject.serv00.net/ytdl2.php";

// 🕺 ستيكرز الرقص تُجلب من HF Space (الفضاء الموازي) عبر HTTP
// انظر utils/danceSticker.js
const { sendMoodSticker } = require("../utils/danceSticker.js");

const EMOJI_PAIRS = [
  ["👍", "❤️"], ["😆", "😮"], ["😢", "😡"],
  ["🥰", "👏"], ["🔥", "💯"], ["😍", "😭"], ["🤔", "👀"],
];

// ═══════════════════════════════════════════════════════════════
// جلب معلومات + رابط التحميل من API
// ═══════════════════════════════════════════════════════════════
async function fetchInfo(youtubeUrl, type = "mp3") {
  const res = await axios.get(API_BASE, {
    params:  { url: youtubeUrl, type },
    timeout: 30000,
  });
  const data = res.data;
  if (!data || typeof data !== "object") {
    throw new Error("استجابة غير متوقعة من الـ API الخارجي");
  }
  const { title, download } = data;
  if (!download) throw new Error(data.error || "لم يُرجع الـ API رابط تحميل");
  return { title: title || "بدون عنوان", downloadUrl: download };
}

// ═══════════════════════════════════════════════════════════════
// تحميل الملف وإرساله
// ═══════════════════════════════════════════════════════════════
async function downloadAndSend(statusMsgId, youtubeUrl, wantMp4, api, threadID, updateStatus) {
  const type = wantMp4 ? "mp4" : "mp3";

  let title, downloadUrl;
  try {
    ({ title, downloadUrl } = await fetchInfo(youtubeUrl, type));
  } catch (e) {
    return updateStatus("❌ " + (e.response?.data?.error || e.message));
  }

  await updateStatus(`⏳ جارٍ تحميل: ${title}...`);

  const ext      = type;
  const filePath = path.join(os.tmpdir(), `ydl_${Date.now()}.${ext}`);

  try {
    const res = await axios.get(downloadUrl, {
      responseType:     "arraybuffer",
      timeout:          120000,
      maxContentLength: 50 * 1024 * 1024,
    });

    const buffer = Buffer.from(res.data);
    if (buffer.length === 0)      throw new Error("الملف فارغ");
    if (buffer.length > 26214400) throw new Error("الملف أكبر من 25MB");

    await fs.writeFile(filePath, buffer);

    await new Promise((resolve, reject) =>
      api.sendMessage(
        {
          body:       `${wantMp4 ? "🎬" : "🎵"} ${title}`,
          attachment: fs.createReadStream(filePath),
        },
        threadID,
        err => err ? reject(err) : resolve()
      )
    );

    try { await api.unsendMessage(statusMsgId, threadID); } catch (_) {}

    // 🕺 ستيكر رقص — فقط عند تحميل mp3 (الصوت)، تماشياً مع باقي أوامر التحميل
    if (!wantMp4) await sendMoodSticker(api, threadID, title);

  } catch (e) {
    await updateStatus("❌ " + (e.response?.data?.error || e.message));
  } finally {
    try { await fs.remove(filePath); } catch (_) {}
  }
}

// ═══════════════════════════════════════════════════════════════
// البحث عبر yt-dlp-stream (v3 — بحث فقط)
// ═══════════════════════════════════════════════════════════════
async function searchYT(query, limit = 7) {
  const url = `https://yt-dlp-stream.onrender.com/api/v3/q?=${encodeURIComponent(query)}&?=${limit}`;
  const res  = await axios.get(url, { timeout: 25000 });
  const data = res.data;
  if (Array.isArray(data))             return data;
  if (Array.isArray(data?.results))    return data.results;
  if (Array.isArray(data?.data))       return data.data;
  return [];
}

// ═══════════════════════════════════════════════════════════════
module.exports = {
  config: {
    name:        "ydl",
    aliases:     ["ytdl2"],
    version:     "1.0",
    role:        0,
    countDown:   15,
    category:    "download",
    description: "تحميل من يوتيوب عبر API خارجي (ccproject) — بديل احتياطي لأمر yt — يدعم MP3 وMP4",
    guide: { en:
      "{pn} <اسم>        — بحث وعرض قائمة\n" +
      "{pn} mp4 <اسم>    — بحث (فيديو)\n" +
      "{pn} <رابط>       — تحميل مباشر MP3\n" +
      "{pn} mp4 <رابط>  — تحميل مباشر MP4"
    }
  },

  onStart: async ({ api, message, args, event }) => {
    const { threadID, messageID } = event;

    if (!args[0]) return message.reply(
      "📥 يوتيوب دونلودر\n\n" +
      "🎵 ydl <اسم أغنية>   — بحث وقائمة\n" +
      "🎬 ydl mp4 <اسم>     — بحث فيديو\n" +
      "🔗 ydl <رابط>        — تحميل مباشر"
    );

    const sub     = args[0].toLowerCase();
    const wantMp4 = sub === "mp4";
    const hasFlag = ["mp4", "mp3"].includes(sub);
    const query   = (hasFlag ? args.slice(1) : args).join(" ").trim();
    if (!query) return message.reply("❌ أرسل اسم الأغنية أو الرابط.");

    // ── رابط مباشر ───────────────────────────────────────────
    const isUrl = query.startsWith("http://") || query.startsWith("https://");
    if (isUrl) {
      let statusMsgId = null;
      try {
        const sent = await new Promise((resolve, reject) =>
          api.sendMessage(
            `⏳ ${wantMp4 ? "🎬 جارٍ تحميل الفيديو..." : "🎵 جارٍ تحميل الصوت..."}`,
            threadID, (err, info) => err ? reject(err) : resolve(info), messageID
          )
        );
        statusMsgId = sent?.messageID;
      } catch (_) {}

      const updateStatus = async (t) => {
        try { if (statusMsgId) await api.editMessage(t, statusMsgId); } catch (_) {}
      };

      await downloadAndSend(statusMsgId, query, wantMp4, api, threadID, updateStatus);
      return;
    }

    // ── بحث ─────────────────────────────────────────────────
    let statusMsgId = null;
    try {
      const sent = await new Promise((resolve, reject) =>
        api.sendMessage(
          `🔍 جارٍ البحث عن "${query}"...`,
          threadID, (err, info) => err ? reject(err) : resolve(info), messageID
        )
      );
      statusMsgId = sent?.messageID;
    } catch (_) {}

    const updateStatus = async (t) => {
      try { if (statusMsgId) await api.editMessage(t, statusMsgId); } catch (_) {}
    };

    try {
      const results = await searchYT(query, 7);
      if (!results.length) return updateStatus("❌ لم تُعثر على نتائج.");

      const list = results.slice(0, 7);
      let text = `🎵 نتائج البحث:\n─────────────────\n`;
      list.forEach((v, i) => {
        const [mp3E, mp4E] = EMOJI_PAIRS[i];
        text += `${i + 1}. ${v.title}\n   ⏱ ${v.duration || "--"}\n   ${mp3E} mp3  |  ${mp4E} mp4\n─────────────────\n`;
      });
      text += `🔢 رُد بالرقم (مثال: 1 أو 1 mp4)\n⏳ تنتهي بعد دقيقتين.`;

      await updateStatus(text);

      if (statusMsgId) {
        global.Kagenou.replies[statusMsgId] = {
          commandName: "ydl",
          author:      event.senderID,
          results:     list,
          wantMp4,
          statusMsgId,
          timestamp:   Date.now(),
        };

        global.client.reactionListener[statusMsgId] = {
          author: event.senderID,
          callback: async ({ api, event: re }) => {
            const idx = EMOJI_PAIRS.findIndex(([a, b]) => re.reaction === a || re.reaction === b);
            if (idx === -1 || idx >= list.length) return;

            const wantMp4R = re.reaction === EMOJI_PAIRS[idx][1];
            const chosen   = list[idx];

            delete global.client.reactionListener[statusMsgId];
            delete global.Kagenou.replies[statusMsgId];

            await updateStatus(`⏳ جارٍ تحميل: ${chosen.title}...`);
            await downloadAndSend(statusMsgId, chosen.url || chosen.short_url, wantMp4R, api, threadID, updateStatus);
          }
        };

        setTimeout(() => { delete global.client.reactionListener[statusMsgId]; }, 120000);
      }
    } catch (e) {
      await updateStatus("❌ " + (e.response?.data?.error || e.message));
    }
  },

  onReply: async ({ api, event, Reply }) => {
    if (event.senderID !== Reply.author || !Reply.results) return;

    const { threadID } = event;
    const parts   = event.body?.trim().split(/\s+/) || [];
    const idx     = parseInt(parts[0]) - 1;
    const wantMp4 = parts[1]?.toLowerCase() === "mp4" ? true
                  : parts[1]?.toLowerCase() === "mp3" ? false
                  : Reply.wantMp4 ?? false;

    if (isNaN(idx) || idx < 0 || idx >= Reply.results.length)
      return api.sendMessage(`❌ أرسل رقماً من 1 إلى ${Reply.results.length}`, threadID);

    const chosen      = Reply.results[idx];
    const statusMsgId = Reply.statusMsgId;

    delete global.client.reactionListener[statusMsgId];
    delete global.Kagenou.replies[statusMsgId];

    const updateStatus = async (t) => {
      try { if (statusMsgId) await api.editMessage(t, statusMsgId); } catch (_) {}
    };

    await updateStatus(`⏳ جارٍ تحميل: ${chosen.title}...`);
    await downloadAndSend(statusMsgId, chosen.url || chosen.short_url, wantMp4, api, threadID, updateStatus);
  }
};
