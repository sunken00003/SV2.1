const fs = require("fs");
const path = require("path");

// ═══════════════════════════════════════════════════════════════
// خريطة التصنيفات الموحدة
// ═══════════════════════════════════════════════════════════════
const CATEGORY_MERGE = {
  "الذكاء الاصطناعي": [
    "ذكاء اصطناعي", "ai", "gemini", "gptx", "groq", "gpt", "hf", "cerebras"
  ],
  "الوسائط والتحميل": [
    "media", "وسائط", "download", "تحميل",
    "yt", "ydl", "yt2", "sc", "sc2", "sing",
    "img", "tts", "pinterest", "random"
  ],
  "الألعاب والترفيه": [
    "games", "fun", "chess", "catfact", "dogfact", "novel"
  ],
  "الإدارة والإشراف": [
    "admin", "إشراف", "إدارة",
    "kick", "adduser", "up"
  ],
  "الأدوات العامة": [
    "أدوات", "tools",
    "help", "tr", "gid", "uid", "decor", "quran",
    "profile", "unsend"
  ]
};

// ═══════════════════════════════════════════════════════════════
// وصف مدمج للأوامر التي لا تحمل description في config
// ═══════════════════════════════════════════════════════════════
const FALLBACK_DESC = {
  fb:     "تحميل الفيديوهات والريلز من فيسبوك",
  tts:    "تحويل النص إلى صوت بأصوات Gemini المتعددة",
  novel:  "قراءة فصول الروايات الإنجليزية مترجمة للعربية",
};

// ═══════════════════════════════════════════════════════════════
// أوامر مخفية لا تظهر في قائمة help
// ─────────────────────────────────────────────────────────────
// ✦ الطريقة 1: أضف اسم الأمر هنا مباشرة (الاسم وليس الـ alias)
//    مثال: HIDDEN_COMMANDS = ["fb", "tts", "novel"]
//
// ✦ الطريقة 2: من داخل ملف الأمر نفسه، أضف في config:
//    config: { name: "fb", ..., hidden: true }
//    (الطريقتان تعملان معًا — يكفي توفر إحداهما لإخفاء الأمر)
// ═══════════════════════════════════════════════════════════════
const HIDDEN_COMMANDS = ["fb","up","profile","help"];

module.exports = {
  config: {
    name:        "help",
    aliases:     ["مساعدة", "الاوامر"],
    version:     "5.0",
    role:        0,
    countDown:   3,
    category:    "أدوات",
    description: "عرض قائمة جميع الأوامر مصنفة، أو تفاصيل أمر محدد",
    guide: { en: "{pn} — قائمة الأوامر\n{pn} <اسم_الأمر> — تفاصيل أمر\n{pn} all — القائمة البسيطة" }
  },

  onStart: async ({ api, event, args }) => {
    const { threadID, messageID } = event;
    const commandsDir = path.join(__dirname);

    if (!fs.existsSync(commandsDir))
      return api.sendMessage("❌ مجلد الأوامر غير موجود", threadID, null, messageID);

    // ── تحميل الأوامر ──────────────────────────────────────────
    const commandFiles = fs.readdirSync(commandsDir).filter(f => f.endsWith(".js"));
    const loadedCommands = new Map();

    for (const file of commandFiles) {
      try {
        const mod = require(path.join(commandsDir, file));
        const cmd = mod.default || mod;
        if (!cmd.config?.name) continue;
        if (!(cmd.onStart || cmd.onChat || cmd.run || cmd.execute)) continue;

        const name = cmd.config.name.toLowerCase();
        if (loadedCommands.has(name)) continue;

        // ── تجاهل الأوامر المخفية (من القائمة أو من config الأمر نفسه) ──
        const isHiddenByConfig = cmd.config.hidden === true || cmd.config.isHidden === true;
        if (HIDDEN_COMMANDS.includes(name) || isHiddenByConfig) continue;

        loadedCommands.set(name, {
          name,
          category:    (cmd.config.category || "غير مصنف").trim(),
          description: cmd.config.shortDescription?.ar
                    || cmd.config.description
                    || FALLBACK_DESC[name]
                    || "لا يوجد وصف",
          aliases:     cmd.config.aliases || [],
          role:        cmd.config.role    ?? 0,
          countDown:   cmd.config.countDown || cmd.config.cooldown || 3,
        });
      } catch (_) {}
    }

    // ── تفاصيل أمر محدد ────────────────────────────────────────
    if (args.length > 0 && args[0].toLowerCase() !== "all") {
      const cmdName = args[0].toLowerCase();
      const cmd = loadedCommands.get(cmdName);
      if (!cmd) return api.sendMessage(`❌ الأمر "${cmdName}" غير موجود`, threadID, null, messageID);

      const info =
        `📌 الأمر: .${cmd.name}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📂 التصنيف : ${cmd.category}\n` +
        `📝 الوصف   : ${cmd.description}\n` +
        (cmd.aliases.length ? `🔗 البدائل  : ${cmd.aliases.join(" | ")}\n` : "") +
        `⏱ كولداون  : ${cmd.countDown} ثانية\n` +
        `🔐 الصلاحية: ${getRoleName(cmd.role)}`;

      return api.sendMessage(info, threadID, null, messageID);
    }

    // ── قائمة بسيطة (all) ──────────────────────────────────────
    if (args[0]?.toLowerCase() === "all") {
      const names = [...loadedCommands.keys()].sort();
      let msg = `📋 جميع الأوامر (${names.length}):\n━━━━━━━━━━━━━━━━━━━━\n`;
      names.forEach((n, i) => { msg += `${i + 1}. .${n}\n`; });
      return api.sendMessage(msg, threadID, null, messageID);
    }

    // ── القائمة الرئيسية المصنفة ───────────────────────────────
    const total = loadedCommands.size;
    const LINE  = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━";

    let message =
      `${LINE}\n` +
      `   قائمة الأوامر  (${total} أمر)\n` +
      `${LINE}`;

    const usedCommands = new Set();
    const otherCommands = [];

    for (const [sectionTitle, items] of Object.entries(CATEGORY_MERGE)) {
      const present = [];

      for (const item of items) {
        const key = item.toLowerCase();
        if (loadedCommands.has(key)) {
          const cmd = loadedCommands.get(key);
          if (!usedCommands.has(cmd.name)) present.push(cmd);
        } else {
          for (const cmd of loadedCommands.values()) {
            if (cmd.category.toLowerCase() === key && !usedCommands.has(cmd.name)) {
              present.push(cmd);
            }
          }
        }
      }

      if (!present.length) continue;

      message += `\n\n  ${sectionTitle}\n${LINE}\n`;
      for (const cmd of present) {
        if (usedCommands.has(cmd.name)) continue;
        message += ` .${cmd.name} — ${cmd.description}\n`;
        usedCommands.add(cmd.name);
      }
    }

    // أوامر لم تُدرج في أي تصنيف
    // ← ملاحظة: قد يحدث هذا بسبب خطأ إملائي بسيط في حقل category داخل
    // ملف الأمر (المطابقة هنا حرفية toLowerCase وليست عبر معرّف ثابت)،
    // نُحذِّر في console لمساعدة المطور على ملاحظة ذلك بسرعة.
    for (const cmd of loadedCommands.values()) {
      if (!usedCommands.has(cmd.name)) {
        otherCommands.push(cmd);
        console.warn(`[help] الأمر '${cmd.name}' لم يُطابق أي تصنيف في CATEGORY_MERGE (category الحالية: "${cmd.category}") — تأكد من عدم وجود خطأ إملائي.`);
      }
    }

    if (otherCommands.length) {
      message += `\n\n  أوامر أخرى\n${LINE}\n`;
      for (const cmd of otherCommands) {
        message += ` .${cmd.name} — ${cmd.description}\n`;
      }
    }

    message +=
      `\n${LINE}\n` +
      `  help <أمر>  ←  تفاصيل الأمر\n` +
      `  help all   ←  القائمة البسيطة\n` +
      `${LINE}`;

    return api.sendMessage(message, threadID, null, messageID);
  }
};

function getRoleName(role) {
  const roles = {
    0: "الجميع",
    1: "المشرفون",
    2: "المراقبون",
    3: "المميزون",
    4: "المطورون"
  };
  return roles[role] || "غير محدد";
}
