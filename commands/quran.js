const axios = require("axios");

module.exports = {
  config: {
    name: "quran",
    aliases: ["قران", "اية", "آية", "tafsir", "تفسير"],
    version: "2.1.0",
    author: "Shadow Garden",
    countDown: 5,
    role: 0,
    nonPrefix: true,
    shortDescription: { ar: "جلب آية قرآنية مع تفسيرها الميسر" },
    category: "أدوات",
    guide: { ar: "{pn}quran [رقم_السورة:رقم_الآية]\nمثال: quran 2:255" }
  },

  onStart: async function ({ api, event, args, message }) {
    const { threadID, messageID } = event;
    const input = args.join(" ").trim();

    if (!input) {
      return message.reply(
        "📖 **أمر القرآن والتفسير**\n\n" +
        "🔍 الاستخدام:\n" +
        "  quran [رقم_السورة:رقم_الآية]\n\n" +
        "💡 أمثلة:\n" +
        "  quran 2:255 (آية الكرسي)\n" +
        "  quran 1:1 (الفاتحة)\n" +
        "  quran 114:6 (الناس)\n\n" +
        "📊 عدد السور: 114"
      );
    }

    const quranRegex = /^(\d+):(\d+)$/;
    const match = input.match(quranRegex);

    if (!match) {
      return message.reply(
        "⚠️ **الصيغة خاطئة!**\n\n" +
        "📝 الاستخدام الصحيح:\n" +
        "  quran [رقم_السورة:رقم_الآية]\n\n" +
        "💡 أمثلة:\n" +
        "  quran 2:255\n" +
        "  quran 1:1"
      );
    }

    const surahNum = parseInt(match[1]);
    const ayahNum = parseInt(match[2]);
    if (surahNum < 1 || surahNum > 114) {
      return message.reply("❌ رقم السورة يجب أن يكون بين 1 و 114");
    }
    if (ayahNum < 1) {
      return message.reply("❌ رقم الآية يجب أن يكون أكبر من 0");
    }

    try {
      const apiUrl = `https://api.alquran.cloud/v1/ayah/${surahNum}:${ayahNum}/editions/quran-uthmani,ar.muyassar`;
      
      console.log(`[QURAN] 📖 السورة ${surahNum} - الآية ${ayahNum}`);

      const response = await axios.get(apiUrl, { 
        timeout: 15000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
      });

      if (!response.data || response.data.code !== 200 || !response.data.data) {
        throw new Error("استجابة غير صالحة من الخادم");
      }

      const data = response.data.data;

      if (!Array.isArray(data) || data.length < 2) {
        throw new Error("بيانات غير مكتملة من الخادم");
      }

      const ayahEdition = data[0];
      const tafsirEdition = data[1];

      if (!ayahEdition || !ayahEdition.text) {
        throw new Error("لم يتم العثور على نص الآية");
      }

      const surahName = ayahEdition.surah?.name || "غير معروف";
      const surahEnglishName = ayahEdition.surah?.englishName || "";
      const ayahText = ayahEdition.text;
      const tafsirText = tafsirEdition?.text || "تعذر جلب التفسير الميسر حالياً.";
      const revelationType = ayahEdition.surah?.revelationType === "Meccan" ? "مكية 🕋" : "مدنية 🕌";
      const juzNumber = ayahEdition.juz || "غير محدد";
      const page = ayahEdition.page || "غير محدد";

      const finalMessage = 
        `✨ **﴿ ${surahName} - الآية ${ayahNum} ﴾** \n` +
        `━─━─━─「◽」─━─━─━\n\n` +
        `۝ **الآية الكريمة:**\n` +
        `« ${ayahText} »\n\n` +
        `📖 **التفسير الميسر:**\n` +
        `${tafsirText}\n\n` +
        `━─━─━─「◽」─━─━─━\n` +
        `📋 **معلومات إضافية:**\n` +
        `🕌 السورة: ${surahName} (${surahEnglishName})\n` +
        `📥 نوع النزول: ${revelationType}\n` +
        `📚 الجزء: ${juzNumber}\n` +
        `📄 الصفحة: ${page}\n` +
        `━─━─━─「◽」─━─━─━`;

      // ✅ الحل: إرسال الرسالة مرة واحدة فقط بدون editMessage
      await api.sendMessage(finalMessage, threadID, null, messageID);

      console.log(`[QURAN] ✅ تم إرسال: ${surahName} - ${ayahNum}`);

    } catch (error) {
      console.error(`[QURAN] ❌ خطأ:`, {
        message: error.message,
        code: error.code,
        status: error.response?.status
      });

      let errorMsg = "حدث خطأ أثناء جلب الآية";
      
      if (error.response?.status === 404) {
        errorMsg = `❌ الآية ${surahNum}:${ayahNum} غير موجودة.\n💡 تأكد من أن الآية موجودة في هذه السورة.`;
      } else if (error.code === "ECONNABORTED") {
        errorMsg = "⏱️ انتهت مهلة الاتصال بالخادم";
      } else if (error.code === "ENOTFOUND") {
        errorMsg = "🌐 لا يوجد اتصال بالإنترنت";
      } else if (error.message) {
        errorMsg = `❌ ${error.message.substring(0, 100)}`;
      }

      await message.reply(errorMsg);
    }
  }
};
