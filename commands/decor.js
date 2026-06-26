// ==========================================
// 📄 ملف: decor.js
// زخرفة النصوص العربية والإنجليزية
// ==========================================

const EN_MAPS = {
  // Bold Mathematical (U+1D5D4 - U+1D5ED لأحرف كبيرة, U+1D5EE - U+1D607 لصغيرة, U+1D7CE للأرقام)
  bold: {},
  // Italic Mathematical (U+1D608 - U+1D621 لأحرف كبيرة, U+1D622 - U+1D63B لصغيرة)
  italic: {},
  // Monospace Mathematical (U+1D670 - U+1D689 لأحرف كبيرة, U+1D68A - U+1D6A3 لصغيرة, U+1D7F6 للأرقام)
  mono: {},
};

// بناء خرائط الاستبدال للأحرف الإنجليزية
const buildEnMaps = () => {
  for (let i = 0; i < 26; i++) {
    const upper = String.fromCharCode(65 + i);   // A-Z
    const lower = String.fromCharCode(97 + i);   // a-z

    // Bold
    EN_MAPS.bold[upper] = String.fromCodePoint(0x1D5D4 + i);
    EN_MAPS.bold[lower] = String.fromCodePoint(0x1D5EE + i);

    // Italic (مع استثناءات I و K و h و i غير موجودة في Italic Math)
    if (upper === 'I' || upper === 'K') {
      EN_MAPS.italic[upper] = upper; // نتركها كما هي
    } else {
      EN_MAPS.italic[upper] = String.fromCodePoint(0x1D608 + i);
    }
    if (lower === 'h' || lower === 'i') {
      EN_MAPS.italic[lower] = lower;
    } else {
      EN_MAPS.italic[lower] = String.fromCodePoint(0x1D622 + i);
    }

    // Monospace
    EN_MAPS.mono[upper] = String.fromCodePoint(0x1D670 + i);
    EN_MAPS.mono[lower] = String.fromCodePoint(0x1D68A + i);
  }

  // أرقام 0-9
  for (let i = 0; i < 10; i++) {
    EN_MAPS.bold[String(i)]   = String.fromCodePoint(0x1D7CE + i);
    EN_MAPS.mono[String(i)]   = String.fromCodePoint(0x1D7F6 + i);
    EN_MAPS.italic[String(i)] = String(i); // italic ليس للأرقام
  }
};
buildEnMaps();

// ==========================================
// 🔤 دوال الزخرفة الإنجليزية
// ==========================================
const applyMap = (text, map) =>
  text.split('').map(ch => map[ch] || ch).join('');

const toBold      = (text) => applyMap(text, EN_MAPS.bold);
const toItalic    = (text) => applyMap(text, EN_MAPS.italic);
const toMonospace = (text) => applyMap(text, EN_MAPS.mono);

// ==========================================
// 🌙 دالة الزخرفة العربية
// ==========================================
const ARABIC_DIACRITICS = ['َ', 'ُ', 'ِ', 'ْ']; // فتحة، ضمة، كسرة، سكون

const decorateArabic = (text) => {
  let result = '';
  let diacriticIndex = 0;
  const letters = text.split('');

  letters.forEach((ch, idx) => {
    const isLast = idx === letters.length - 1;

    // كشيدة قبل الحرف
    result += 'ـ';
    // الحرف نفسه
    result += ch;

    // تشكيل خفيف (ليس على كل حرف لتجنب الإزعاج)
    if (idx % 2 === 0 && !isLast) {
      result += ARABIC_DIACRITICS[diacriticIndex % ARABIC_DIACRITICS.length];
      diacriticIndex++;
    }

    // كشيدة بعد الحرف (ما عدا الأخير)
    if (!isLast) {
      result += 'ـ';
    }
  });

  return result;
};

// ==========================================
// 🔍 دالة كشف اللغة
// ==========================================
const isArabicText = (text) => /[\u0600-\u06FF]/.test(text);
// ==========================================
//  دالة بناء قائمة الخيارات
// ==========================================
const buildOptions = (text) => {
  if (isArabicText(text)) {
    const decorated = decorateArabic(text);
    return [
      `❶ ${text}`,
      `❷ ${decorated}`,
      `❸ ─── ${decorated} ───`,
      `❹ ✦ ${text} ✦ ${decorated} ✦`,
    ];
  } else {
    return [
      `❶ Bold:      ${toBold(text)}`,
      `❷ Italic:    ${toItalic(text)}`,
      `❸ Mono:      ${toMonospace(text)}`,
      `❹ Mix:       ${toBold(text)} • ${toItalic(text)} • ${toMonospace(text)}`,
    ];
  }
};

// ==========================================
// 🎯 تصدير الأمر (صيغة GoatBot V2)
// ==========================================
module.exports = {
  config: {
    name: "decor",
    aliases: ["زخرفة", "زخرف", "stylize"],
    version: "1.0.0",
    author: "Shadow Garden",
    countDown: 5,
    role: 0,
    nonPrefix: true,
    shortDescription: { ar: "زخرفة النصوص العربية والإنجليزية" },
    category: "أدوات",
    guide: { ar: "decor <نص> أو زخرفة <نص>" },
  },

  onStart: async function ({ api, event, args, message }) {
    const { threadID, messageID, messageReply } = event;
    // ← إصلاح: رسالة المساعدة كانت تَعِد بدعم "الرد على رسالة" لكن لم
    // يكن هناك كود فعلي يقرأ messageReply.body — أصبح الآن يُستخدَم
    // كبديل عندما لا يُكتب نص مباشرة بعد الأمر.
    const text = args.join(" ").trim() || messageReply?.body?.trim() || "";

    if (!text) {
      return message.reply(
        "✦ زخرفة النصوص ✦\n\n" +
        "🔤 إنجليزي:\n" +
        "  decor hello\n\n" +
        "🌙 عربي:\n" +
        "  زخرفة مرحبا\n\n" +
        "💡 الرد على رسالة يعمل أيضاً."
      );
    }

    // دعم الرد على رسالة
    const targetText = text;
    const options = buildOptions(targetText);

    const output =
      `✦ زخرفة: ${targetText}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      options.join("\n") +
      `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `💡 اضغط على السطر لنسخه`;

    await api.sendMessage(output, threadID, null, messageID);
  },
};
