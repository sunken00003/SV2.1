const axios = require("axios");
const { translateToArabic } = require("../utils/translator");

module.exports = {
  config: {
    name: "dogfact",
    aliases: ["كلب", "dogfacts"],
    version: "1.0.0",
    author: "Sunken",
    countDown: 5,
    role: 0,
    shortDescription: { ar: "حقيقة عشوائية عن الكلاب 🐶" },
    category: "fun",
    guide: { ar: "{pn}dogfact" }
  },

  onStart: async function ({ api, event }) {
    const { threadID, messageID } = event;
    try {
      const res  = await axios.get("https://dogapi.dog/api/v2/facts", { timeout: 8000 });
      const fact = res.data?.data?.[0]?.attributes?.body;
      if (!fact) throw new Error("لا توجد بيانات");

      const translated = await translateToArabic(fact);

      api.sendMessage(`🐶 حقيقة عن الكلاب\n\n${translated}`, threadID, null, messageID);
    } catch {
      api.sendMessage("❌ فشل جلب الحقيقة — حاول مرة أخرى", threadID, null, messageID);
    }
  }
};
