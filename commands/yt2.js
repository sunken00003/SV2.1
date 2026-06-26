"use strict";

const axios = require("axios");
const fs    = require("fs-extra");
const os    = require("os");
const path  = require("path");

const BASE = "https://yt-dlp-stream.onrender.com/api";

// 🕺 ستيكرز الرقص أصبحت تُجلب من HF Space (الفضاء الموازي) عبر HTTP
// بدل تخزينها محلياً في ريبو Sv2 — انظر utils/danceSticker.js
const { sendMoodSticker } = require("../utils/danceSticker.js");

// ─── 7 أزواج إيموجي ────────────────────────────────────────────
const EMOJI_PAIRS = [
  ["👍", "❤️"], ["😆", "😮"], ["😢", "😡"],
  ["🥰", "👏"], ["🔥", "💯"], ["😍", "😭"], ["🤔", "👀"],
];

// ═══════════════════════════════════════════════════════════════
// تحميل الملف على /tmp ثم إرساله كـ ReadStream
// ═══════════════════════════════════════════════════════════════
async function getStream(url) {
  const ext      = url.match(/\.(mp4|mp3|webm|m4a)/i)?.[1] || "mp3";
  const filePath = path.join(os.tmpdir(), `yt_${Date.now()}.${ext}`);

  const res = await axios.get(url, {
    responseType:     "arraybuffer",
    timeout:          120000,
    maxContentLength: 50 * 1024 * 1024,
    maxBodyLength:    50 * 1024 * 1024,
  });

  const buffer = Buffer.from(res.data);
  if (buffer.length === 0)      throw new Error("الملف فارغ.");
  if (buffer.length > 26214400) throw new Error("الملف أكبر من 25MB.");

  await fs.writeFile(filePath, buffer);
  return { stream: fs.createReadStream(filePath), filePath };
}

async function cleanTemp(filePath) {
  try { if (await fs.pathExists(filePath)) await fs.remove(filePath); } catch (_) {}
}

// ─── v2 ────────────────────────────────────────────────────────
async function v2(query) {
  const url  = `${BASE}/v2/q?=${encodeURIComponent(query)}`;
  const res  = await axios.get(url, { timeout: 30000 });
  const data = res.data;
  if (Array.isArray(data)) return data[0] || {};
  if (!data || typeof data !== "object") return {};
  return data;
}

// ─── v3 ────────────────────────────────────────────────────────
async function v3(query, limit = 8) {
  const url  = `${BASE}/v3/q?=${encodeURIComponent(query)}&?=${limit}`;
  const res  = await axios.get(url, { timeout: 25000 });
  const data = res.data;
  if (Array.isArray(data))               return { results: data };
  if (!data || typeof data !== "object") return { results: [] };
  if (Array.isArray(data.results))       return data;
  if (Array.isArray(data.data))          return { results: data.data };
  return { results: [] };
}

// ─── استخرج روابط من v2 ────────────────────────────────────────
function parse(d) {
  if (!d || typeof d !== "object") return {
    title: "بدون عنوان", author: "", mp4Url: null, mp3Url: null
  };
  const m = (d.media && typeof d.media === "object" && !Array.isArray(d.media)) ? d.media : {};
  function getUrl(f) {
    if (!f) return null;
    if (typeof f === "string") return f;
    if (typeof f === "object" && typeof f.url === "string") return f.url;
    return null;
  }
  return {
    title:  d.title  || "بدون عنوان",
    author: d.author || d.channel || "",
    mp4Url: getUrl(m.mp4) || getUrl(d.mp4) || null,
    mp3Url: getUrl(m.mp3) || getUrl(d.mp3) || null,
  };
}

// ═══════════════════════════════════════════════════════════════
// تحميل وإرسال + ستيكر رقص
// ═══════════════════════════════════════════════════════════════
async function downloadAndSend(message, statusMsgId, query, wantMp4, api, threadID) {
  const updateStatus = async (text) => {
    try { if (statusMsgId) await api.editMessage(text, statusMsgId); } catch (_) {}
  };

  const p   = parse(await v2(query));
  const url = wantMp4 ? p.mp4Url : p.mp3Url;

  if (!url) {
    return updateStatus(`❌ الرابط غير متاح.\n💡 جرّب النوع الآخر.`);
  }

  const { stream, filePath } = await getStream(url);
  try {
    // ── إرسال الملف ────────────────────────────────────────
    await new Promise((resolve, reject) => {
      api.sendMessage(
        {
          body:       `${wantMp4 ? "🎬" : "🎵"} ${p.title}\n📺 ${p.author}`.trim(),
          attachment: stream
        },
        threadID,
        (err) => err ? reject(err) : resolve()
      );
    });

    // ── حذف رسالة الانتظار (إصلاح: threadID مطلوب) ────────
    if (statusMsgId) {
      try { await api.unsendMessage(statusMsgId, threadID); } catch (_) {}
    }

    // 🕺 ستيكر رقص من المجلد المحلي
    await sendMoodSticker(api, threadID, p.title);

  } finally {
    await cleanTemp(filePath);
  }
}

// ═══════════════════════════════════════════════════════════════
module.exports = {
  config: {
    name:        "yt2",
    aliases:     ["يوتيوب2"],
    version:     "4.0",
    role:        0,
    countDown:   15,
    category:    "download",
    description: "تحميل من يوتيوب عبر yt-dlp-stream — بديل احتياطي لأمر yt — بحث بالاسم أو تحميل برابط",
    guide: { en:
      "{pn} <اسم>         — بحث وعرض قائمة\n" +
      "{pn} mp4 <اسم>     — بحث وعرض قائمة (فيديو)\n" +
      "{pn} <رابط>        — تحميل مباشر MP3\n" +
      "{pn} mp4 <رابط>   — تحميل مباشر MP4"
    }
  },

  onStart: async ({ api, message, args, event }) => {
    const { threadID, messageID } = event;

    if (!args[0]) return message.reply(
      "📥 يوتيوب دونلودر\n\n" +
      "🎵 yt <اسم أغنية>    — بحث وقائمة\n" +
      "🎬 yt mp4 <اسم>      — بحث وقائمة فيديو\n" +
      "🔗 yt <رابط>         — تحميل مباشر"
    );

    const sub     = args[0].toLowerCase();
    const wantMp4 = sub === "mp4";
    const hasFlag = ["mp4", "mp3"].includes(sub);
    const query   = (hasFlag ? args.slice(1) : args).join(" ").trim();

    if (!query) return message.reply("❌ أرسل اسم الأغنية أو الرابط.");

    const isUrl = query.startsWith("http://") || query.startsWith("https://");
    if (isUrl) {
      let statusMsgId = null;
      try {
        const sent = await new Promise((resolve, reject) =>
          api.sendMessage(
            `⏳ ${wantMp4 ? "🎬 جارٍ تحميل الفيديو..." : "🎵 جارٍ تحميل الصوت..."}`,
            threadID,
            (err, info) => err ? reject(err) : resolve(info),
            messageID
          )
        );
        statusMsgId = sent?.messageID;
      } catch (_) {}

      try {
        await downloadAndSend(message, statusMsgId, query, wantMp4, api, threadID);
      } catch (e) {
        try { if (statusMsgId) await api.editMessage("❌ " + (e.response?.data?.error || e.message), statusMsgId); } catch (_) {}
      }
      return;
    }

    let statusMsgId = null;
    try {
      const sent = await new Promise((resolve, reject) =>
        api.sendMessage(
          `🔍 جارٍ البحث عن "${query}"...`,
          threadID,
          (err, info) => err ? reject(err) : resolve(info),
          messageID
        )
      );
      statusMsgId = sent?.messageID;
    } catch (_) {}

    const updateStatus = async (text) => {
      try { if (statusMsgId) await api.editMessage(text, statusMsgId); } catch (_) {}
    };

    try {
      const res = await v3(query, 7);
      if (!res.results?.length) return updateStatus("❌ لم تُعثر على نتائج.");

      const results = res.results.slice(0, 7);
      let text = `🎵 نتائج البحث:\n─────────────────\n`;
      results.forEach((v, i) => {
        const [mp3Emoji, mp4Emoji] = EMOJI_PAIRS[i];
        text += `${i + 1}. ${v.title}\n   ⏱ ${v.duration || "--"}\n   ${mp3Emoji} mp3  |  ${mp4Emoji} mp4\n─────────────────\n`;
      });
      text += `🔢 رُد بالرقم، أو تفاعل بإيموجي مناسب (mp3/mp4)\n⏳ تنتهي بعد دقيقتين.`;

      await updateStatus(text);

      if (statusMsgId) {
        global.Kagenou.replies[statusMsgId] = {
          commandName: "yt2",
          author:      event.senderID,
          results,
          wantMp4,
          statusMsgId,
          timestamp:   Date.now()
        };

        global.client.reactionListener[statusMsgId] = {
          author: event.senderID,
          callback: async ({ api, event: reactEvent }) => {
            const reaction = reactEvent.reaction;
            const idx = EMOJI_PAIRS.findIndex(([mp3, mp4]) => reaction === mp3 || reaction === mp4);
            if (idx === -1 || idx >= results.length) return;

            const wantMp4Reaction = reaction === EMOJI_PAIRS[idx][1];
            const chosen = results[idx];

            delete global.client.reactionListener[statusMsgId];
            delete global.Kagenou.replies[statusMsgId];

            await updateStatus(`⏳ جارٍ تحميل: ${chosen.title}...`);
            try {
              await downloadAndSend(message, statusMsgId, chosen.url || chosen.short_url, wantMp4Reaction, api, threadID);
            } catch (e) {
              await updateStatus("❌ " + (e.response?.data?.error || e.message));
            }
          }
        };

        setTimeout(() => {
          if (global.client.reactionListener[statusMsgId])
            delete global.client.reactionListener[statusMsgId];
        }, 120000);
      }
    } catch (e) {
      await updateStatus("❌ " + (e.response?.data?.error || e.message));
    }
  },

  onReply: async ({ api, event, Reply, message }) => {
    if (event.senderID !== Reply.author || !Reply.results) return;

    const { threadID } = event;
    const parts   = event.body?.trim().split(/\s+/) || [];
    const idx     = parseInt(parts[0]) - 1;
    const wantMp4 = parts[1]?.toLowerCase() === "mp4"
      ? true
      : parts[1]?.toLowerCase() === "mp3"
        ? false
        : Reply.wantMp4 ?? false;

    if (isNaN(idx) || idx < 0 || idx >= Reply.results.length)
      return message.reply(`❌ أرسل رقماً من 1 إلى ${Reply.results.length}`);

    const chosen      = Reply.results[idx];
    const statusMsgId = Reply.statusMsgId;

    delete global.client.reactionListener[statusMsgId];
    delete global.Kagenou.replies[statusMsgId];

    const updateStatus = async (text) => {
      try { if (statusMsgId) await api.editMessage(text, statusMsgId); } catch (_) {}
    };

    await updateStatus(`⏳ جارٍ تحميل: ${chosen.title}...`);

    try {
      await downloadAndSend(message, statusMsgId, chosen.url || chosen.short_url, wantMp4, api, threadID);
    } catch (e) {
      await updateStatus("❌ " + (e.response?.data?.error || e.message));
    }
  }
};