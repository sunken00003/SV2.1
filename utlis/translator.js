// utils/translator.js
const axios = require("axios");

async function translateToArabic(text) {
  if (!text?.trim()) return text;

  if (/[\u0600-\u06FF]/.test(text) && text.match(/[\u0600-\u06FF]/g).length > text.length * 0.3) {
    return text;
  }

  try {
    const url = `https://translate.googleapis.com/translate_a/single` +
                `?client=gtx&sl=auto&tl=ar&dt=t&q=${encodeURIComponent(text)}`;

    const res = await axios.get(url, {
      timeout: 10000,
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    if (res.data?.[0]) {
      return res.data[0].map(x => x[0]).filter(Boolean).join("").trim();
    }
  } catch (e) {
    console.warn("[TRANSLATOR] فشل:", e.message?.substring(0, 50));
  }

  return text;
}

module.exports = { translateToArabic };
