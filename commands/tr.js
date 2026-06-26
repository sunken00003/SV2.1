const axios = require("axios");

module.exports = {
  config: {
    name: "tr",
    description: "ترجمة النص إلى أي لغة",
    usage: "tr <رمز_اللغة> <النص> أو رد على رسالة واكتب tr <رمز_اللغة>",
    aliases: ["translate", "ترجمة"],
    category: "أدوات",
    role: 0,
    cooldown: 5,
    nonPrefix: true
  },
  onStart: async ({ api, event, args, message }) => {
    const { threadID, messageID, messageReply, body } = event;
    
    if (args.length === 0) {
      return api.sendMessage("❌ الاستخدام: tr <رمز_اللغة> <النص>\nأو: رد على رسالة واكتب tr <رمز_اللغة>", threadID, null, messageID);
    }

    const targetLang = args[0].toLowerCase();
    let textToTranslate = "";

    if (args.length > 1) {
      textToTranslate = args.slice(1).join(" ");
    } else if (messageReply && messageReply.body) {
      textToTranslate = messageReply.body;
    } else {
      return api.sendMessage("❌ الرجاء كتابة النص أو الرد على رسالة لترجمتها", threadID, null, messageID);
    }

    try {
      const response = await axios.get(
        `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(textToTranslate)}`,
        { timeout: 15000, headers: { "User-Agent": "Mozilla/5.0" } }
      );

      const result = response.data;

      // فحص دفاعي: لو أعاد الـ API ردًا غير متوقع (حظر/rate-limit)،
      // كان هذا يرمي TypeError غامض ("Cannot read properties of undefined")
      if (!Array.isArray(result) || !Array.isArray(result[0])) {
        throw new Error("استجابة غير متوقعة من خدمة الترجمة، حاول لاحقاً.");
      }

      let translatedText = "";
      result[0].forEach(item => {
        if (item?.[0]) translatedText += item[0];
      });

      if (!translatedText) throw new Error("لم تُرجع الترجمة أي نص.");

      await api.sendMessage(translatedText, threadID, null, messageID);

    } catch (error) {
      const msg = error.code === "ECONNABORTED" || error.message?.includes("timeout")
        ? "⏱️ انتهت مهلة الاتصال بخدمة الترجمة"
        : `❌ خطأ في الترجمة: ${error.message}`;
      await api.sendMessage(msg, threadID, null, messageID);
    }
  }
};
