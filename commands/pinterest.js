const axios = require("axios");
const fs    = require("fs-extra");
const os    = require("os");
const path  = require("path");

const FERDEV_API_KEY = process.env.FERDEV_API_KEY || "";

function react(api, msgID, emoji) {
  try { api.setMessageReaction(emoji, msgID, () => {}, true); } catch (_) {}
}

module.exports = {
  config: {
    name: "pinterest",
    aliases: ["pin", "بينتريست", "صورة"],
    version: "1.1.0",
    countDown: 5,
    role: 0,
    nonPrefix: true,
    shortDescription: { ar: "البحث عن صور من Pinterest" },
    category: "media"
  },

  onStart: async function ({ api, event, args, message }) {
    const { threadID, messageID } = event;
    const query = args.join(" ").trim();

    if (!query) return message.reply(
      "📌 البحث في Pinterest\n\n" +
      "📝 الاستخدام: pinterest [كلمة البحث]\n" +
      "💡 مثال: pinterest nature wallpaper\n\n" +
      "• يرسل 5 صور عشوائية بجودة عالية"
    );

    if (!FERDEV_API_KEY) return message.reply("⚠️ لم يتم تعيين FERDEV_API_KEY في Environment Variables");

    react(api, messageID, "🤖");

    try {
      const apiUrl = `https://api.ferdev.my.id/search/pinterest?query=${encodeURIComponent(query)}&apikey=${FERDEV_API_KEY}`;
      const response = await axios.get(apiUrl, { timeout: 30000, headers: { "User-Agent": "SunkenBot/2.0" } });

      if (!response.data?.result?.length) {
        react(api, messageID, "❌");
        return api.sendMessage("❌ لم أجد نتائج للبحث", threadID, null, messageID);
      }

      const images = response.data.result.slice(0, 5);
      let sentCount = 0;

      for (let i = 0; i < images.length; i++) {
        try {
          const imageUrl = images[i].url || images[i].image || images[i];
          const fileName = path.join(os.tmpdir(), `pin_${Date.now()}_${i}.jpg`);
          const imgResponse = await axios.get(imageUrl, {
            responseType: "arraybuffer", timeout: 30000,
            headers: { "User-Agent": "SunkenBot/2.0" }
          });
          await fs.writeFile(fileName, imgResponse.data);
          await api.sendMessage(
            { attachment: fs.createReadStream(fileName), body: `📌 ${query}\n${i + 1}/${images.length}` },
            threadID, null, messageID
          );
          sentCount++;
          await fs.remove(fileName).catch(() => {});
          if (i < images.length - 1) await new Promise(r => setTimeout(r, 1000));
        } catch (_) {}
      }

      react(api, messageID, sentCount > 0 ? "✅" : "❌");

    } catch (error) {
      react(api, messageID, "❌");
      api.sendMessage(`❌ فشل: ${error.message?.substring(0, 80)}`, threadID, null, messageID);
    }
  }
};
