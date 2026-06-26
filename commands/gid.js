module.exports = {
  config: { name: "gid", aliases: ["معرف_المجموعة", "threadid", "groupid"], version: "1.0.0", author: "sunken", countDown: 5, role: 0, shortDescription: { ar: "جلب معرف الدردشة أو المجموعة (GID)" }, category: "أدوات" },
  onStart: async ({ event, message }) => {
    const { threadID } = event;
    await message.reply(`✅ معرف هذه الدردشة/المجموعة:\n${threadID}`);
  }
};
