const axios = require("axios");

// ⚠️ نفس التوكن العام المُستخدَم في adduser.js — جُمِّع في متغير بيئة
// واحد بدل تكراره مضمَّنًا في الكود المصدري عبر المشروع.
const FB_GRAPH_TOKEN = process.env.FB_GRAPH_ACCESS_TOKEN || "6628568379%7Cc1e620fa708a1d5696fb991c1bde5662";

module.exports = {
  config: { name: "uid", aliases: ["معرف", "ايدي", "id"], version: "3.0.0", author: "Raw ID Version", countDown: 3, role: 0, shortDescription: { ar: "جلب UID فقط" }, category: "أدوات" },
  onStart: async ({ api, event, args, message }) => {
    const { senderID, mentions, messageReply } = event;
    let targetUID = null;
    try {
      const mentionIDs = Object.keys(mentions);
      if (mentionIDs.length > 0) targetUID = mentionIDs[0];
      else if (messageReply && messageReply.senderID) targetUID = messageReply.senderID;
      else if (args[0]) {
        const input = args.join(" ").trim();
        if (/^\d{5,20}$/.test(input)) targetUID = input;
        else {
          const username = input.replace("@", "").trim().split(/[?#]/)[0].split("/").pop();
          if (username && /^[a-zA-Z0-9.]+$/.test(username)) {
            const res = await axios.get(`https://graph.facebook.com/${username}`, { params: { fields: "id", access_token: FB_GRAPH_TOKEN }, timeout: 10000 });
            if (res.data && res.data.id) targetUID = res.data.id;
          }
        }
      } else targetUID = senderID;      
      if (targetUID) message.reply(targetUID);
      else message.reply("❌");
    } catch (err) { message.reply("❌"); }
  }
};
