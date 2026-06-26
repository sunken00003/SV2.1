module.exports = {
  config: { name: "kick", aliases: ["طرد", "اخرج", "remove"], version: "1.0.0", author: "sunken", countDown: 5, role: 1, shortDescription: { ar: "طرد عضو من المجموعة" }, category: "إشراف" },
  onStart: async ({ api, event, message }) => {
    const { threadID, messageID, senderID, mentions, messageReply } = event;
    const threadInfo = await api.getThreadInfo(threadID);
    if (!threadInfo.adminIDs.some(admin => admin.id === senderID)) return message.reply("❌ هذا الأمر للمشرفين فقط!");
    
    let targetID = null, targetName = "المستخدم";
    const mentionIDs = Object.keys(mentions);
    if (mentionIDs.length > 0) { targetID = mentionIDs[0]; targetName = mentions[targetID].replace(/@/g, " ").trim(); }
    else if (messageReply) { targetID = messageReply.senderID; targetName = "صاحب الرسالة"; }
    
    if (!targetID) return message.reply("❌ الرجاء تحديد المستخدم المراد طرده (منشن أو رد).");
    const botID = api.getCurrentUserID();
    if (targetID === botID) return message.reply("🤣 لا يمكنني طرد نفسي!");
    if (threadInfo.adminIDs.some(admin => admin.id === targetID)) return message.reply("⚠️ لا يمكن طرد مشرف آخر!");
    
    try {
      await api.removeUserFromGroup(targetID, threadID);
      await message.reply(`♻️ ${targetName} إلى القمامة! 👋`);
    } catch (error) {
      return message.reply("❌ فشل في طرد المستخدم. تأكد أن البوت مشرف.");
    }
  }
};
