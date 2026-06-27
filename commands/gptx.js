const OpenAI = require("openai").OpenAI;
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

const token = process.env.GITHUB_MODELS_TOKEN;
const openai = new OpenAI({ baseURL: "https://models.inference.ai.azure.com", apiKey: token });

// ✅ الجلسات الجماعية تُخزَّن بـ threadID
const sessionsDir = path.join(__dirname, '..', 'cache', 'ai_sessions_gptx');
fs.ensureDirSync(sessionsDir);

// ─── تنظيف دوري لملفات الجلسات القديمة ──────────────────────
// على عكس باقي أوامر الذكاء الاصطناعي (MongoDB مع slice)، هذا الملف
// يكتب ملف JSON دائم لكل محادثة جديدة ولا يحذفه إلا عند .up اليدوي.
// نُضيف تنظيفًا دوريًا (كل ساعة) يحذف ملفات الجلسات الأقدم من 24 ساعة
// بناءً على وقت آخر تعديل (mtime)، لتفادي تراكم مساحة التخزين.
if (!global.__gptxCleanupRegistered) {
  global.__gptxCleanupRegistered = true;
  setInterval(async () => {
    try {
      const files = await fs.readdir(sessionsDir);
      const now = Date.now();
      for (const f of files) {
        try {
          const fp = path.join(sessionsDir, f);
          const stat = await fs.stat(fp);
          if (now - stat.mtimeMs > 24 * 60 * 60 * 1000) await fs.remove(fp);
        } catch (_) {}
      }
    } catch (_) {}
  }, 60 * 60 * 1000);
}

const SYSTEM_PROMPT = `أنت مساعد ذكي اسمك "Sunken". أجب بإيجاز باللغة العربية (أقل من 150 كلمة). كن ودوداً ومهذباً.`;

// ─── تعقيم اسم المستخدم قبل حقنه في محتوى الذكاء الاصطناعي ────
function sanitizeName(name) {
  if (!name) return "مستخدم";
  const clean = String(name)
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[[\]{}<>`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
  return clean || "مستخدم";
}

const setReaction = (api, reaction, messageID, threadID) => {
  try {
    if (!reaction || !messageID || !threadID) return;
    if (String(messageID) === "undefined" || String(threadID) === "undefined") return;
    api.setMessageReaction({ reaction: String(reaction), messageID: String(messageID), threadID: String(threadID) }, () => {});
  } catch (e) {}
};

// ✅ مفتاح الجلسة = threadID (مشترك للكل في المجموعة)
async function loadSession(threadID) {
  const sessionFile = path.join(sessionsDir, `thread_${threadID}.json`);
  try {
    if (await fs.pathExists(sessionFile)) {
      let ctx = await fs.readJson(sessionFile);
      if (ctx.length > 20) ctx = ctx.slice(-20);
      return ctx;
    }
  } catch (e) {}
  return [];
}

async function saveSession(threadID, context) {
  const sessionFile = path.join(sessionsDir, `thread_${threadID}.json`);
  await fs.writeJson(sessionFile, context, { spaces: 0 }).catch(() => {});
}

async function clearSession(threadID) {
  const sessionFile = path.join(sessionsDir, `thread_${threadID}.json`);
  if (await fs.pathExists(sessionFile)) await fs.unlink(sessionFile);
}

async function downloadImageAsBase64(url) {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    const contentType = response.headers['content-type'] || 'image/jpeg';
    const base64 = Buffer.from(response.data).toString('base64');
    return { base64, contentType };
  } catch (e) { return null; }
}

async function callGPT(context, prompt, imageData = null) {
  let userContent = imageData ? [
    { type: "image_url", image_url: { url: `data:${imageData.contentType};base64,${imageData.base64}` } },
    { type: "text", text: prompt || "ما هذه الصورة؟ صفها بالتفصيل." }
  ] : prompt;

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...context.map(m => ({ role: m.role, content: m.content })),
    { role: "user", content: userContent }
  ];
  const response = await openai.chat.completions.create({ messages, model: "gpt-4o", temperature: 0.7, max_tokens: 2048 });
  if (!response?.choices?.length) throw new Error("لا توجد استجابة من GPT");
  return response.choices[0].message.content;
}

async function handleMessage(api, event, message, prompt) {
  // ✅ الجلسة الجماعية: نستخدم threadID
  const { threadID, messageID, senderID } = event;

  if (prompt.trim().toLowerCase() === "clear" || prompt.trim() === "مسح") {
    await clearSession(threadID);
    return message.reply("🧹 تم مسح ذاكرة المجموعة.");
  }

  // ✅ جلب اسم المرسل لإضافته للسياق
  let senderName = senderID;
  try {
    const userInfo = await new Promise((res, rej) =>
      api.getUserInfo(senderID, (err, data) => err ? rej(err) : res(data))
    );
    senderName = userInfo?.[senderID]?.name || senderID;
  } catch (_) {}
  senderName = sanitizeName(senderName);

  let imageData = null;
  const replyAtts = event.messageReply?.attachments || [];
  const directAtts = event.attachments || [];
  for (const att of [...replyAtts, ...directAtts]) {
    if (["photo", "sticker", "animated_image"].includes(att.type)) {
      const imgUrl = att.url || att.largePreviewUrl || att.previewUrl || att.thumbnailUrl;
      if (imgUrl) {
        imageData = await downloadImageAsBase64(imgUrl);
        if (imageData) break;
      }
    }
  }

  if (!prompt && !imageData) return message.reply("⚠️ اكتب سؤالاً أو ردّ على صورة.");

  setReaction(api, "⏳", messageID, threadID);
  const context = await loadSession(threadID);

  // ✅ نضيف اسم المرسل للرسالة
  const userText = imageData
    ? `[${senderName}]: [صورة] ${prompt || ""}`.trim()
    : `[${senderName}]: ${prompt}`;

  let reply = null;
  try {
    reply = await callGPT(context, imageData ? (userText || " ") : userText, imageData);
  } catch (error) {
    console.error("[GPTx Error]:", error.message);
    let errorMsg = "❌ خطأ:\n";
    if (error.status === 401) errorMsg += "🔑 المفتاح غير صالح.";
    else if (error.status === 404) errorMsg += "🤖 النموذج غير متاح.";
    else if (error.status === 429) errorMsg += "⏱️ تم تجاوز الحد اليومي.";
    else errorMsg += error.message || "خطأ غير معروف";
    setReaction(api, "❌", messageID, threadID);
    return message.reply(errorMsg);
  }

  if (!reply) { setReaction(api, "❌", messageID, threadID); return message.reply("❌ استجابة فارغة."); }

  setReaction(api, "🟢", messageID, threadID);
  const info = await message.reply(reply);
  message.registerReply(info.messageID, { threadID }, async ({ api, event, message }) => {
    const replyPrompt = event.body?.trim() || "";
    if (!replyPrompt && !(event.attachments?.length)) return;
    await handleMessage(api, event, message, replyPrompt);
  });

  context.push({ role: "user",      content: userText });
  context.push({ role: "assistant", content: reply });
  await saveSession(threadID, context);
}

module.exports = {
  config: {
    name: "gptx",
    version: "2.0.0",
    author: "Sunken",
    countDown: 3,
    role: 0,
    usePrefix: false,
    shortDescription: { ar: "GPT-4o | ذاكرة جماعية | ردود تلقائية | يفهم الصور" },
    category: "ذكاء اصطناعي",
    guide: { ar: "gptx [سؤالك] ← بدء محادثة\nردّ على رسالة البوت ← يكمل تلقائياً\nردّ على صورة ← يحللها\ngptx مسح ← مسح ذاكرة المجموعة" }
  },
  onStart: async ({ api, event, args, message }) => {
    let prompt = args.join(" ").trim();
    if (!prompt && event.messageReply) prompt = event.messageReply.body || "";
    await handleMessage(api, event, message, prompt);
  },
  onReply: async ({ api, event, message, Reply }) => {
    const prompt = event.body?.trim() || "";
    if (!prompt && !(event.attachments?.length)) return;
    await handleMessage(api, event, message, prompt);
  }
};
