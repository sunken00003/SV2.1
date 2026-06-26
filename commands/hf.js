"use strict";
const axios    = require("axios");
const mongoose = require("mongoose");

const HF_BASE = process.env.HF_SPACE_URL || "";

// ─── Schema للجلسات ──────────────────────────────────────────
const sessionSchema = new mongoose.Schema({
  _id:      String,
  messages: { type: Array, default: [] },
  model:    { type: String, default: "llama4" },
  updatedAt:{ type: Date,   default: Date.now },
});
const Session = mongoose.models.HFSession
  || mongoose.model("HFSession", sessionSchema);

async function loadCtx(id) {
  try {
    if (!global.db) return { messages: [], model: "llama4" };
    const doc = await Session.findById(id).lean();
    return {
      messages: doc?.messages?.slice(-10) || [],
      model:    doc?.model || "llama4",
    };
  } catch (_) { return { messages: [], model: "llama4" }; }
}

async function saveCtx(id, messages, model) {
  try {
    if (!global.db) return;
    await Session.findByIdAndUpdate(
      id,
      { messages: messages.slice(-10), model, updatedAt: new Date() },
      { upsert: true }
    );
  } catch (_) {}
}

// ─── حذف رسائل التفكير من الرد ───────────────────────────────
function cleanReply(text) {
  // حذف وسوم التفكير
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  text = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "");
  text = text.replace(/<analysis>[\s\S]*?<\/analysis>/gi, "");
  text = text.replace(/<reflection>[\s\S]*?<\/reflection>/gi, "");

  // إذا فيه "الجواب:" → خذ ما بعده فقط
  const match = text.match(/(?:الجواب|الإجابة|Answer)\s*:\s*/i);
  if (match) text = text.slice(text.indexOf(match[0]) + match[0].length);

  return text.trim();
}

// ─── تحميل الوسائط وتحويلها base64 ──────────────────────────
async function downloadAsBase64(url) {
  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 15000,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const contentType = response.headers["content-type"] || "image/jpeg";
    const base64 = Buffer.from(response.data).toString("base64");
    return { base64, contentType };
  } catch (e) {
    console.warn("[HF] فشل تحميل الوسيط:", e.message?.substring(0, 60));
    return null;
  }
}

// ─── كشف المرفق من event (FCA) ───────────────────────────────
function detectAttachment(event) {
  const sources = [
    ...(event.attachments               || []),
    ...(event.messageReply?.attachments || []),
  ];

  for (const att of sources) {
    if (!att) continue;
    const type = (att.type || att.attachmentType || "").toLowerCase();

    if (["photo","image","sticker","animated_image","share"].includes(type)) {
      const url =
        att.largePreviewUrl || att.previewUrl ||
        att.largePreviewUri || att.previewUri ||
        att.uri || att.url  || att.thumbnailUrl ||
        att.image?.uri;
      if (url) return { kind: "image", url };
    }
    if (type === "audio" || type === "voice_message") {
      const url = att.url || att.audioUrl || att.uri;
      if (url) return { kind: "audio", url };
    }
    if (type === "video" || type === "video_inline") {
      const url = att.url || att.uri || att.previewUrl;
      if (url) return { kind: "video", url };
    }
    if (type === "file" || type === "document") {
      const ext = (att.filename || att.name || "").split(".").pop().toLowerCase();
      const url = att.url || att.uri;
      if (!url) continue;
      if (["jpg","jpeg","png","gif","webp","bmp"].includes(ext))
        return { kind: "image", url };
      if (["mp3","m4a","ogg","wav","flac","aac"].includes(ext))
        return { kind: "audio", url };
      if (["mp4","mov","avi","mkv","webm"].includes(ext))
        return { kind: "video", url };
    }
  }
  return null;
}

// ─── استدعاء HF Space ────────────────────────────────────────
async function callHF(messages, model) {
  if (!HF_BASE) throw new Error("HF_SPACE_URL غير مضبوط في متغيرات Render");

  const { data } = await axios.post(
    `${HF_BASE.replace(/\/+$/, "")}/hf`,
    { messages, model, max_tokens: 512 },
    { timeout: 65000, headers: { "Content-Type": "application/json" } }
  );

  if (data.error) throw new Error(data.error);
  if (!data.reply) throw new Error("استجابة فارغة من الخادم");

  return { reply: cleanReply(data.reply), model_used: data.model_used || model };
}

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

// ─── المعالج الرئيسي ─────────────────────────────────────────
async function handle(api, event, args, registerReply) {
  const { threadID, messageID, senderID } = event;

  const firstArg = args[0]?.toLowerCase() || "";

  // ✅ الجلسة الجماعية: threadID بدل senderID
  const sessionKey = threadID;

  // ─── مسح الذاكرة ─────────────────────────────────────────
  if (["مسح", "clear", "reset"].includes(firstArg)) {
    try { await Session.findByIdAndDelete(sessionKey); } catch (_) {}
    return api.sendMessage("🧹 تم مسح ذاكرة المجموعة.", threadID, null, messageID);
  }

  // ─── عرض النماذج ─────────────────────────────────────────
  if (["نماذج", "models", "list"].includes(firstArg)) {
    return api.sendMessage(
      `🤖 النماذج المتاحة في HF AI:\n\n` +
      `━━━━━ Llama (Meta) ━━━━━\n` +
      `• llama4 ← الافتراضي ✅ يدعم الصور\n` +
      `• llama / llama8 → Llama-3.1-8B ✅\n` +
      `• llama70 → Llama-3.3-70B\n\n` +
      `━━━━━ Qwen (Alibaba) ━━━━━\n` +
      `• qwen7 → Qwen2.5-7B ✅\n` +
      `• qwen / qwen72 → Qwen2.5-72B\n` +
      `• qwen3 → Qwen3-235B\n\n` +
      `━━━━━ Mistral ━━━━━\n` +
      `• mistral → Mistral-7B ✅\n` +
      `• mistral22 → Mistral-Small-22B ✅ يدعم الصور\n` +
      `• mixtral → Mixtral-8x7B\n\n` +
      `━━━━━ Google ━━━━━\n` +
      `• gemma → Gemma-3-27B ✅ يدعم الصور\n` +
      `• gemma4 → Gemma-3-4B ✅ يدعم الصور\n\n` +
      `━━━━━ DeepSeek ━━━━━\n` +
      `• deepseek7 → DeepSeek-R1-7B ✅\n` +
      `• deepseek → DeepSeek-R1-32B\n\n` +
      `━━━━━ أخرى ━━━━━\n` +
      `• phi / phi4 → Microsoft Phi ✅\n` +
      `• zephyr → Zephyr-7B ✅\n` +
      `• command → Cohere Command-R\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📸 النماذج التي تدعم الصور:\n` +
      `llama4، mistral22، gemma، gemma4\n\n` +
      `💡 معرّف كامل:\n` +
      `.hf meta-llama/Llama-4-Scout-17B-16E-Instruct سؤال\n\n` +
      `🧹 .hf مسح — مسح الذاكرة`,
      threadID, null, messageID
    );
  }

  // ─── تحديد النموذج والسؤال ───────────────────────────────
  const { messages: savedCtx, model: savedModel } = await loadCtx(sessionKey);

  let model, promptArgs;

  const looksLikeModel = firstArg &&
    !firstArg.includes(" ") &&
    !/^[\u0600-\u06FF]/.test(firstArg) &&
    (firstArg.includes("/") || firstArg.length <= 15);

  if (looksLikeModel && args.length > 1) {
    model      = args[0];
    promptArgs = args.slice(1);
  } else if (looksLikeModel && args.length === 1) {
    model      = args[0];
    promptArgs = [];
  } else {
    model      = savedModel;
    promptArgs = args;
  }

  let prompt = promptArgs.join(" ").trim();

  if (!prompt && event.messageReply?.body)
    prompt = event.messageReply.body.trim();

  // ─── جلب اسم المرسل للسياق الجماعي ──────────────────────
  let senderName = senderID;
  try {
    const userInfo = await new Promise((res, rej) =>
      api.getUserInfo(senderID, (err, data) => err ? rej(err) : res(data))
    );
    senderName = userInfo?.[senderID]?.name || senderID;
  } catch (_) {}
  senderName = sanitizeName(senderName);

  // ─── كشف الوسائط ─────────────────────────────────────────
  const attachment = detectAttachment(event);

  if (!prompt && !attachment) {
    return api.sendMessage(
      `🤖 HF AI — النموذج الحالي: ${model}\n\n` +
      `📝 الاستخدام:\n` +
      `.hf [نموذج] [سؤالك]\n\n` +
      `💡 أمثلة:\n` +
      `.hf ما هو الذكاء الاصطناعي؟  ← llama4 افتراضي\n` +
      `.hf qwen7 اشرح لي البرمجة\n` +
      `.hf gemma + صورة — تحليل الصورة\n\n` +
      `📋 .hf نماذج — كل النماذج المتاحة\n` +
      `🧹 .hf مسح — مسح الذاكرة`,
      threadID, null, messageID
    );
  }

  if (!HF_BASE)
    return api.sendMessage("❌ HF_SPACE_URL غير مضبوط في متغيرات Render", threadID, null, messageID);

  // ─── رسالة واحدة قابلة للتعديل ───────────────────────────────
  let statusMsgId = null;
  try {
    const sent = await new Promise((resolve, reject) =>
      api.sendMessage(
        attachment
          ? `⏳ جاري تحليل ${attachment.kind === "image" ? "الصورة 🖼️" : attachment.kind === "audio" ? "الصوت 🎵" : "الفيديو 🎬"} لـ ${model}...`
          : `⏳ جاري السؤال لـ ${model}...`,
        threadID,
        (err, info) => err ? reject(err) : resolve(info),
        messageID
      )
    );
    statusMsgId = sent?.messageID;
  } catch (_) {}

  const updateStatus = async (text) => {
    try { if (statusMsgId) await api.editMessage(text, statusMsgId); } catch (_) {}
  };

  // ─── تحضير رسالة المستخدم مع الوسيط ─────────────────────
  let userMsg;

  if (attachment?.kind === "image") {
    const imgData = await downloadAsBase64(attachment.url);
    if (imgData) {
      userMsg = {
        role: "user",
        content: `[${senderName}]: ${prompt || "وصف هذه الصورة"}`,
        attachment: {
          kind:        "image",
          base64:      imgData.base64,
          contentType: imgData.contentType,
        },
      };
    } else {
      userMsg = { role: "user", content: `[${senderName}]: ${prompt || "وصف هذه الصورة"}` };
      await updateStatus("⚠️ تعذّر تحميل الصورة، سأجيب على النص فقط...");
    }
  } else if (attachment) {
    userMsg = {
      role: "user",
      content: `[${senderName}]: ${prompt || (attachment.kind === "audio" ? "فرّغ هذا الصوت" : "حلل هذا الفيديو")}`,
      attachment: { kind: attachment.kind, url: attachment.url },
    };
  } else {
    userMsg = { role: "user", content: `[${senderName}]: ${prompt}` };
  }

  const messages = [...savedCtx, userMsg];

  try {
    const { reply, model_used } = await callHF(messages, model);

    await updateStatus(reply);

    if (statusMsgId && registerReply) {
      registerReply(statusMsgId, { author: senderID }, async ({ api, event }) => {
        await handle(api, event, [model, event.body?.trim() || ""].filter(Boolean), registerReply);
      });
    }

    await saveCtx(sessionKey, [
      ...savedCtx,
      { role: "user",      content: userMsg.content },
      { role: "assistant", content: reply },
    ], model_used);

  } catch (err) {
    let msg = "❌ خطأ: ";
    if (err.code === "ECONNABORTED" || err.message?.includes("timeout"))
      msg += "⏱️ انتهت مهلة الاتصال — جرب نموذجاً أصغر مثل: llama أو gemma4";
    else if (err.message?.includes("HF_SPACE_URL"))
      msg += err.message;
    else
      msg += (err.message || "فشل الاتصال").substring(0, 120);

    await updateStatus(msg);
  }
}

module.exports = {
  config: {
    name:             "hf",
    aliases:          ["huggingface", "hfai"],
    version:          "3.1.0",
    author:           "Sunken",
    countDown:        5,
    role:             0,
    shortDescription: { ar: "ذكاء اصطناعي — llama4 افتراضي + دعم الصور" },
    longDescription: {
      ar:
        "تحدث مع أي نموذج من HuggingFace\n" +
        "النموذج الافتراضي: llama4 (يدعم الصور ✅)\n\n" +
        "النماذج المجانية:\n" +
        "• llama4 ← افتراضي، يدعم الصور\n" +
        "• llama / llama8 — Llama-3.1-8B\n" +
        "• qwen7 — Qwen2.5-7B\n" +
        "• mistral — Mistral-7B\n" +
        "• gemma / gemma4 — Google Gemma (يدعم الصور)\n" +
        "• mistral22 — Mistral-Small (يدعم الصور)\n" +
        "• deepseek7 — DeepSeek-R1-7B\n" +
        "• phi / phi4 — Microsoft Phi\n" +
        "• zephyr — Zephyr-7B",
    },
    category: "ذكاء اصطناعي",
    guide: {
      ar:
        "{pn}hf [سؤالك]  ← llama4 افتراضي\n" +
        "{pn}hf qwen7 اشرح البرمجة\n" +
        "{pn}hf gemma + صورة — تحليل الصورة\n" +
        "{pn}hf نماذج — عرض كل النماذج\n" +
        "{pn}hf مسح — مسح الذاكرة",
    },
  },

  onStart: async ({ api, event, args, message }) => {
    await handle(api, event, args, message?.registerReply);
  },

  onReply: async ({ api, event, message }) => {
    await handle(api, event, [event.body?.trim() || ""], message?.registerReply);
  },
};
