const axios = require('axios');

// ⚠️ توكن عام لـ Facebook Graph API (App ID/Secret القديم العام، ليس
// سرًّا فريدًا بهذا المشروع) — يُفضَّل وضعه في متغير بيئة بدل تثبيته
// في الكود المصدري كممارسة عامة سليمة.
const FB_GRAPH_TOKEN = process.env.FB_GRAPH_ACCESS_TOKEN || "6628568379%7Cc1e620fa708a1d5696fb991c1bde5662";

module.exports = {
  config: {
    name: "adduser",
    aliases: ["اضافة", "ادع", "invite"],
    version: "3.0.0",
    author: "Enhanced with Graph API",
    countDown: 5,
    // ← إصلاح حرج: كان role:0 يسمح لأي مستخدم عادي بإضافة أعضاء
    // للمجموعة بلا أي قيد. أصبح role:1 + فحص adminIDs فعلي بالأسفل
    // (نفس نمط kick.js).
    role: 1,
    shortDescription: { ar: "إضافة عضو عبر UID أو رابط فيسبوك" },
    category: "أدوات",
    guide: { ar: "{pn}adduser [UID أو رابط فيسبوك]" }
  },
  onStart: async function ({ api, event, args, message }) {
    const { threadID, messageID, senderID } = event;

    // ─── فحص صلاحية فعلي على مستوى فيسبوك (adminIDs) ───────────
    // role:1 في config.json يعني "مشرف من إعدادات البوت الداخلية"،
    // لكن هذا لا يضمن أن المنفّذ مشرف فعليًا في هذه المجموعة بالذات.
    let threadInfoCheck;
    try {
      threadInfoCheck = await api.getThreadInfo(threadID);
    } catch (e) {
      return api.sendMessage("❌ فشل في جلب معلومات المجموعة.", threadID, null, messageID);
    }
    if (!threadInfoCheck.adminIDs.some(admin => admin.id === senderID)) {
      return api.sendMessage("❌ هذا الأمر لمشرفي المجموعة فقط!", threadID, null, messageID);
    }

    const input = args.join(" ").trim();
    if (!input) {
      return api.sendMessage("❌ الاستخدام:\n/adduser [UID] أو [رابط فيسبوك]", threadID, null, messageID);
    }

    const waitMsg = await api.sendMessage("🔄 جاري المعالجة...", threadID, null, messageID);

    const editMsg = async (text) => {
      try {
        await api.editMessage(text, waitMsg.messageID, threadID);
      } catch (e) {
        console.error("[EditMsg Error]", e.message);
      }
    };

    try {
      let uid = null;
      let userName = "المستخدم";

      if (/^\d{5,20}$/.test(input)) {
        uid = input;
      } else if (input.includes("facebook.com") || input.includes("fb.com") || input.includes("fb.me")) {
        await editMsg("🔍 جاري استخراج UID من الرابط...");
        uid = await getUIDFromURL(input);
      } else if (/^[a-zA-Z0-9.]+$/.test(input)) {
        await editMsg("🔍 جاري البحث عن المستخدم...");
        uid = await getUIDFromUsername(input);
      }

      if (!uid) {
        return await editMsg("❌ فشل استخراج UID.\n💡 الحل: استخدم UID الرقمي مباشرة.");
      }

      if (threadInfoCheck.participantIDs.includes(uid)) {
        return await editMsg("⚠️ المستخدم موجود بالفعل في المجموعة.");
      }

      try {
        const info = await api.getUserInfo(uid);
        if (info && info[uid]) userName = info[uid].name || userName;
      } catch (e) {}

      await editMsg(`🔄 جاري إضافة ${userName}...`);
      try {
        await new Promise((resolve, reject) => {
          api.addUserToGroup(uid, threadID, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      } catch (addError) {
        let errorMsg = `❌ فشل في إضافة ${userName}\n`;
        if (addError.error === "Not enough members to add") errorMsg += "المجموعة تحتاج موافقة الأدمن.";
        else if (addError.error === "Privacy") errorMsg += "المستخدم لديه إعدادات خصوصية تمنع إضافته.";
        else errorMsg += addError.message || "سبب غير معروف";
        return await editMsg(errorMsg);
      }

      await editMsg(`✅ تمت الإضافة بنجاح!\n👤 الاسم: ${userName}\n🆔 UID: ${uid}`);
    } catch (error) {
      console.error("[AddUser Fatal]", error);
      await editMsg("❌ حدث خطأ غير متوقع.");
    }
  }
};

async function getUIDFromURL(url) {
  url = url.trim().split(/[?#]/)[0];
  const idMatch = url.match(/[?&]id=(\d+)/);
  if (idMatch) return idMatch[1];
  const numMatch = url.match(/facebook.com\/(\d{5,20})/);
  if (numMatch) return numMatch[1];

  const username = extractUsername(url);
  if (!username) return null;
  try {
    const res = await axios.get(`https://graph.facebook.com/${username}`, {
      params: { fields: "id,name", access_token: FB_GRAPH_TOKEN }, timeout: 10000
    });
    if (res.data && res.data.id) return res.data.id;
  } catch (e) {}
  return null;
}

function extractUsername(url) {
  try {
    let cleaned = url.replace(/^https?:\/\//, "").replace(/^(www\.|m\.|mbasic\.|web\.)/, "").replace(/^facebook\.com\//, "").replace(/^fb\.com\//, "").replace(/^fb\.me\//, "").replace(/\/$/, "");
    const ignorePaths = ["watch", "reel", "reels", "stories", "groups", "marketplace", "profile.php", "video.php", "photo.php"];
    if (ignorePaths.some(p => cleaned.startsWith(p))) return null;
    const parts = cleaned.split("/");
    const username = parts[0];
    if (username && /^[a-zA-Z0-9.]+$/.test(username) && username.length >= 3) return username;
    return null;
  } catch (e) { return null; }
}

async function getUIDFromUsername(username) {
  username = username.replace("@", "").trim();
  try {
    const res = await axios.get(`https://graph.facebook.com/${username}`, {
      params: { fields: "id,name", access_token: FB_GRAPH_TOKEN }, timeout: 10000
    });
    if (res.data && res.data.id) return res.data.id;
  } catch (e) {}
  return null;
}
