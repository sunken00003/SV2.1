const axios = require("axios");
const fs    = require("fs");
const path  = require("path");
const os    = require("os");

const TUMBLR_API_KEY = process.env.TUMBLR_API_KEY || "";

// بلوقات Tumblr مشهورة بالفيديوهات
const VIDEO_BLOGS = [
  "videohall", "gifak-net", "sizvideos", "pleatedjeans",
  "tastefullyoffensive", "humortrain", "best-of-tumblr-daily",
  "videogifs", "funnyordie", "motionaddicts",
  "catasters", "kittens", "there-is-always-hope",
  "awesome-picz", "thefrogman",
];

module.exports = {
  config: {
    name: "random",
    aliases: ["tb", "tumblr", "فيديو"],
    version: "1.1.0",
    author: "Sunken",
    countDown: 15,
    role: 0,
    shortDescription: { ar: "فيديو عشوائي من Tumblr" },
    category: "media",
    guide: { ar: "{pn}random ← فيديو عشوائي تماماً" }
  },

  onStart: async function ({ api, event }) {
    const { threadID, messageID } = event;

    if (!TUMBLR_API_KEY) {
      return api.sendMessage("⚠️ TUMBLR_API_KEY غير مضبوط", threadID, null, messageID);
    }

    let statusMsgId = null;
    try {
      const sent = await new Promise((resolve, reject) =>
        api.sendMessage(
          "🎬 جاري البحث عن فيديو عشوائي...",
          threadID, (err, info) => err ? reject(err) : resolve(info), messageID
        )
      );
      statusMsgId = sent?.messageID;
    } catch (_) {}

    const updateStatus = async (text) => {
      try { if (statusMsgId) await api.editMessage(text, statusMsgId); } catch (_) {}
    };

    const tmpFile = path.join(os.tmpdir(), `tumblr_${Date.now()}.mp4`);

    try {
      // ─── جرب بلوقات عشوائية حتى نجد فيديو ──────────────
      let videoUrl  = null;
      let postUrl   = null;
      let blogName  = null;
      let caption   = null;

      // خلط البلوقات عشوائياً
      const shuffled = [...VIDEO_BLOGS].sort(() => Math.random() - 0.5);

      for (const blog of shuffled) {
        try {
          const offset   = Math.floor(Math.random() * 20);
          const response = await axios.get(
            `https://api.tumblr.com/v2/blog/${blog}/posts/video`,
            {
              params: { api_key: TUMBLR_API_KEY, limit: 20, offset },
              timeout: 8000,
            }
          );

          const posts = response.data?.response?.posts || [];
          if (!posts.length) continue;

          // اختر بوست عشوائي
          const post = posts[Math.floor(Math.random() * posts.length)];

          // جرب الحصول على رابط الفيديو المباشر
          const url = post.video_url
            || post.player?.find(p => p.width >= 400)?.embed_code
            || post.player?.[0]?.embed_code;

          if (!url || !url.startsWith("http")) continue;

          videoUrl = url;
          postUrl  = post.post_url || "";
          blogName = blog;
          caption  = (post.summary || post.caption || "")
            .replace(/<[^>]*>/g, "").trim().substring(0, 100);

          console.log(`[RANDOM] ✅ وجد فيديو في @${blog}`);
          break;

        } catch (e) {
          console.log(`[RANDOM] ⚠️ ${blog}: ${e.message}`);
          continue;
        }
      }

      if (!videoUrl) {
        await updateStatus("❌ لم أجد فيديو الآن — حاول مرة أخرى");
        return;
      }

      await updateStatus(`⬇️ جاري التحميل...\n📺 @${blogName}`);

      // ─── تحميل الفيديو ───────────────────────────────────
      const dlResponse = await axios.get(videoUrl, {
        responseType: "stream",
        timeout:      60000,
        headers: { "User-Agent": "Mozilla/5.0" },
        validateStatus: () => true,
      });

      if (dlResponse.status !== 200) {
        // أرسل الرابط مباشرة إذا فشل التحميل
        try { await api.unsendMessage(statusMsgId, threadID); } catch (_) {}
        return api.sendMessage(
          `🎬 ${caption || "فيديو عشوائي"}\n📺 @${blogName}\n\n🔗 ${postUrl}`,
          threadID, null, messageID
        );
      }

      await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(tmpFile);
        dlResponse.data.pipe(writer);
        writer.on("finish", resolve);
        writer.on("error",  reject);
      });

      const sizeMB = fs.statSync(tmpFile).size / (1024 * 1024);

      if (sizeMB < 0.01) {
        await updateStatus("❌ الفيديو فارغ — حاول مرة أخرى");
        return;
      }

      // إذا كبير → أرسل الرابط
      if (sizeMB > 25) {
        try { await api.unsendMessage(statusMsgId, threadID); } catch (_) {}
        return api.sendMessage(
          `🎬 ${caption || "فيديو عشوائي"}\n📺 @${blogName}\n💾 ${sizeMB.toFixed(1)}MB\n\n🔗 ${postUrl}`,
          threadID, null, messageID
        );
      }

      await updateStatus(`✅ جاري الإرسال...\n📺 @${blogName}`);

      await new Promise((resolve, reject) => {
        api.sendMessage(
          {
            body:       `🎬 ${caption || "فيديو عشوائي"}\n📺 @${blogName}`,
            attachment: fs.createReadStream(tmpFile),
          },
          threadID,
          (err, info) => err ? reject(err) : resolve(info),
          messageID
        );
      });

      try { await api.unsendMessage(statusMsgId, threadID); } catch (_) {}
      console.log(`[RANDOM] ✅ أرسل من @${blogName} — ${sizeMB.toFixed(1)}MB`);

    } catch (error) {
      let errMsg = "❌ فشل جلب الفيديو\n\n";
      if (error.response?.status === 401) errMsg += "🔑 API Key غير صالح";
      else if (error.response?.status === 429) errMsg += "⚠️ تجاوزت حد الطلبات";
      else if (error.code === "ECONNABORTED") errMsg += "⏱ انتهت مهلة الانتظار";
      else errMsg += error.message?.substring(0, 150) || "خطأ غير معروف";
      await updateStatus(errMsg);
      console.error("[RANDOM ERROR]", error.message);
    } finally {
      try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (_) {}
    }
  }
};
