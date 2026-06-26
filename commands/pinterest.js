const axios = require("axios");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");

const FERDEV_API_KEY = process.env.FERDEV_API_KEY || "";
// ← إصلاح: Render لا يسمح بالكتابة الدائمة إلا في /tmp (نفس القيد
// الموثَّق بتعليق صريح في ydl.js و sing.js). os.tmpdir() يعمل محليًا
// وعلى Render، ولا يحتاج تنظيفًا يدويًا إضافيًا عبر up.js.

module.exports = {
  config: {
    name: "pinterest",
    aliases: ["pin", "بينتريست", "صورة"],
    version: "1.0.0-FerDev",
    author: "Shadow Garden",
    countDown: 5,
    role: 0,
    nonPrefix: true,
    shortDescription: { ar: "البحث عن صور من Pinterest" },
    category: "media"
  },

  onStart: async function ({ api, event, args, message }) {
    const { threadID, messageID } = event;
    const query = args.join(" ").trim();

    if (!query) {
      return message.reply(
        "📌 البحث في Pinterest\n\n" +
        "📝 الاستخدام: pinterest [كلمة البحث]\n" +
        "💡 مثال: pinterest nature wallpaper\n\n" +
        "⚠️ ملاحظات:\n" +
        "  • يرسل 5 صور عشوائية\n" +
        "  • جودة عالية\n" +
        "  • سريع جداً"
      );
    }

    if (!FERDEV_API_KEY) {
      return message.reply("⚠️ لم يتم تعيين FERDEV_API_KEY في Environment Variables");
    }

    const statusMsg = await message.reply("🔍 جاري البحث في Pinterest...");

    try {
      // GET request مع apikey في query string
      const apiUrl = `https://api.ferdev.my.id/search/pinterest?query=${encodeURIComponent(query)}&apikey=${FERDEV_API_KEY}`;
      
      console.log(`[PINTEREST] 🔍 Searching: ${query}`);
      
      const response = await axios.get(apiUrl, { 
        timeout: 30000,
        headers: { "User-Agent": "SunkenBot/2.0" }
      });

      if (!response.data || !response.data.result || response.data.result.length === 0) {
        await api.unsendMessage(statusMsg.messageID, threadID).catch(() => {});
        return api.sendMessage("❌ لم أجد نتائج للبحث", threadID, null, messageID);
      }

      const images = response.data.result.slice(0, 5);
      await api.unsendMessage(statusMsg.messageID, threadID).catch(() => {});

      let sentCount = 0;
      for (let i = 0; i < images.length; i++) {
        try {
          const img = images[i];
          const imageUrl = img.url || img.image || img;
          const fileName = path.join(os.tmpdir(), `pin_${Date.now()}_${i}.jpg`);

          console.log(`[PINTEREST] 📥 Downloading image ${i + 1}/${images.length}`);

          const imgResponse = await axios.get(imageUrl, {
            responseType: "arraybuffer",
            timeout: 30000,
            headers: { "User-Agent": "SunkenBot/2.0" }
          });

          await fs.writeFile(fileName, imgResponse.data);

          await api.sendMessage({
            attachment: fs.createReadStream(fileName),
            body: `📌 ${query}\n${i + 1}/${images.length}`
          }, threadID, null, messageID);

          sentCount++;

          // ← إصلاح: حذف فوري بعد تأكد الإرسال بدل setTimeout(10s) —
          // الانتظار 10 ثوانٍ كان يترك الملف على القرص للأبد إن أُعيد
          // تشغيل العملية (نشر جديد/انهيار/إعادة تشغيل) قبل انقضائها.
          await fs.remove(fileName).catch(() => {});
          
          // تأخير بين الصور
          if (i < images.length - 1) {
            await new Promise(r => setTimeout(r, 1000));
          }
        } catch (imgError) {
          console.error(`[PINTEREST] ❌ Failed to download image ${i + 1}:`, imgError.message);
        }
      }

      console.log(`[PINTEREST] ✅ Sent ${sentCount}/${images.length} images`);

    } catch (error) {
      console.error("[PINTEREST ERROR]", error.message);
      await api.unsendMessage(statusMsg.messageID, threadID).catch(() => {});
      api.sendMessage(`❌ فشل: ${error.message?.substring(0, 80)}`, threadID, null, messageID);
    }
  }
};
