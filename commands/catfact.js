const axios = require("axios");
const { translateToArabic } = require("../utils/translator");

module.exports = {
  config: {
    name: "catfact",
    aliases: ["قط", "قطة", "catfacts"],
    version: "1.0.0",
    author: "Sunken",
    countDown: 5,
    role: 0,
    shortDescription: { ar: "حقيقة عشوائية عن القطط 🐱" },
    category: "fun",
    guide: { ar: "{pn}catfact" }
  },

  onStart: async function ({ api, event }) {
    const { threadID, messageID } = event;
    try {
      const res  = await axios.get("https://catfact.ninja/fact", { timeout: 8000 });
      const fact = res.data?.fact;
      if (!fact) throw new Error("لا توجد بيانات");

      const translated = await translateToArabic(fact);

      api.sendMessage(`🐱 حقيقة عن القطط\n\n${translated}`, threadID, null, messageID);
    } catch {
      api.sendMessage("❌ فشل جلب الحقيقة — حاول مرة أخرى", threadID, null, messageID);
    }
  }
};
