const axios = require('axios');

const FB_GRAPH_TOKEN = process.env.FB_GRAPH_ACCESS_TOKEN || "6628568379%7Cc1e620fa708a1d5696fb991c1bde5662";

function react(api, msgID, emoji) {
  try { api.setMessageReaction(emoji, msgID, () => {}, true); } catch (_) {}
}

module.exports = {
  config: {
    name: "adduser",
    aliases: ["اضافة", "ادع", "invite"],
    version: "3.1.0",
    countDown: 5,
    role: 1,
    shortDescription: { ar: "إضافة عضو عبر UID أو رابط فيسبوك" },
    category: "أدوات",
    guide: { ar: "{pn}adduser [UID أو رابط فيسبوك]" }
  },

  onStart: async function ({ api, event, args, message }) {
    const { threadID, messageID, senderID } = event;

    let threadInfoCheck;
    try {
      threadInfoCheck = await api.getThreadInfo(threadID);
    } catch (e) {
      return message.reply("❌ فشل في جلب معلومات المجموعة.");
    }
    if (!threadInfoCheck.adminIDs.some(admin => admin.id === senderID))
      return message.reply("❌ هذا الأمر لمشرفي المجموعة فقط!");

    const input = args.join(" ").trim();
    if (!input) return message.reply("❌ الاستخدام:\nadduser [UID] أو [رابط فيسبوك]");

    react(api, messageID, "🤖");

    try {
      let uid = null, userName = "المستخدم";

      if (/^\d{5,20}$/.test(input)) {
        uid = input;
      } else if (input.includes("facebook.com") || input.includes("fb.com") || input.includes("fb.me")) {
        uid = await getUIDFromURL(input);
      } else if (/^[a-zA-Z0-9.]+$/.test(input)) {
        uid = await getUIDFromUsername(input);
      }

      if (!uid) {
        react(api, messageID, "❌");
        return message.reply("❌ فشل استخراج UID.\n💡 الحل: استخدم UID الرقمي مباشرة.");
      }

      if (threadInfoCheck.participantIDs.includes(uid)) {
        react(api, messageID, "❌");
        return message.reply("⚠️ المستخدم موجود بالفعل في المجموعة.");
      }

      try {
        const info = await api.getUserInfo(uid);
        if (info?.[uid]) userName = info[uid].name || userName;
      } catch (_) {}

      await new Promise((resolve, reject) =>
        api.addUserToGroup(uid, threadID, err => err ? reject(err) : resolve())
      );

      react(api, messageID, "✅");
      message.reply(`✅ تمت إضافة ${userName} بنجاح!\n🆔 UID: ${uid}`);

    } catch (error) {
      react(api, messageID, "❌");
      let errMsg = "❌ فشل في الإضافة\n";
      if (error.error === "Not enough members to add") errMsg += "المجموعة تحتاج موافقة الأدمن.";
      else if (error.error === "Privacy") errMsg += "المستخدم لديه إعدادات خصوصية تمنع إضافته.";
      else errMsg += error.message || "سبب غير معروف";
      message.reply(errMsg);
    }
  }
};

async function getUIDFromURL(url) {
  url = url.trim().split(/[?#]/)[0];
  const idMatch  = url.match(/[?&]id=(\d+)/);
  if (idMatch) return idMatch[1];
  const numMatch = url.match(/facebook\.com\/(\d{5,20})/);
  if (numMatch) return numMatch[1];
  const username = extractUsername(url);
  if (!username) return null;
  try {
    const res = await axios.get(`https://graph.facebook.com/${username}`, {
      params: { fields: "id,name", access_token: FB_GRAPH_TOKEN }, timeout: 10000
    });
    if (res.data?.id) return res.data.id;
  } catch (_) {}
  return null;
}

function extractUsername(url) {
  try {
    let cleaned = url.replace(/^https?:\/\//, "").replace(/^(www\.|m\.|mbasic\.|web\.)/, "")
      .replace(/^facebook\.com\//, "").replace(/^fb\.(com|me)\//, "").replace(/\/$/, "");
    const ignorePaths = ["watch","reel","reels","stories","groups","marketplace","profile.php","video.php","photo.php"];
    if (ignorePaths.some(p => cleaned.startsWith(p))) return null;
    const username = cleaned.split("/")[0];
    if (username && /^[a-zA-Z0-9.]+$/.test(username) && username.length >= 3) return username;
    return null;
  } catch (_) { return null; }
}

async function getUIDFromUsername(username) {
  username = username.replace("@", "").trim();
  try {
    const res = await axios.get(`https://graph.facebook.com/${username}`, {
      params: { fields: "id,name", access_token: FB_GRAPH_TOKEN }, timeout: 10000
    });
    if (res.data?.id) return res.data.id;
  } catch (_) {}
  return null;
}
