const axios = require("axios");
const fs    = require("fs-extra");
const os    = require("os");
const path  = require("path");

const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
].filter(k => k && k.length > 10);

const TTS_MODEL = "gemini-2.5-flash-preview-tts";

const ALL_VOICES = [
  "Achernar", "Achird", "Algenib", "Algieba", "Alnilam",
  "Aoede", "Autonoe", "Callirrhoe", "Charon", "Despina",
  "Enceladus", "Erinome", "Fenrir", "Gacrux", "Iapetus",
  "Kore", "Laomedeia", "Leda", "Orus", "Puck",
  "Pulcherrima", "Rasalgethi", "Sadachbia", "Sadaltager",
  "Schedar", "Sulafat", "Umbriel", "Vindemiatrix",
  "Zephyr", "Zubenelgenubi",
];

let _voicePool = [];
function nextVoice() {
  if (!_voicePool.length)
    _voicePool = [...ALL_VOICES].sort(() => Math.random() - 0.5);
  return _voicePool.pop();
}

function pcmToWav(pcmBuffer, sampleRate = 24000, channels = 1, bitDepth = 16) {
  const byteRate   = sampleRate * channels * (bitDepth / 8);
  const blockAlign = channels * (bitDepth / 8);
  const dataSize   = pcmBuffer.length;
  const wav        = Buffer.alloc(44 + dataSize);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(bitDepth, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataSize, 40);
  pcmBuffer.copy(wav, 44);
  return wav;
}

async function callGeminiTTS(text, voice) {
  if (!GEMINI_KEYS.length) throw new Error("لا توجد مفاتيح GEMINI_API_KEY في البيئة");
  const errors = [], publicErrors = [];
  for (let i = 0; i < GEMINI_KEYS.length; i++) {
    const key = GEMINI_KEYS[i];
    try {
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent?key=${key}`,
        { contents: [{ parts: [{ text }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } },
        { timeout: 60000 }
      );
      const part      = res.data?.candidates?.[0]?.content?.parts?.[0];
      const audioData = part?.inlineData?.data;
      const mimeType  = part?.inlineData?.mimeType || "";
      if (!audioData) { errors.push(`key[${key.slice(0,8)}]: استجابة فارغة`); publicErrors.push(`مفتاح #${i+1}: استجابة فارغة`); continue; }
      const rawBuffer = Buffer.from(audioData, "base64");
      if (mimeType.includes("pcm") || mimeType.includes("L16") || !mimeType.includes("wav"))
        return { buffer: pcmToWav(rawBuffer), ext: "wav" };
      return { buffer: rawBuffer, ext: "wav" };
    } catch (e) {
      const msg = e.response?.data?.error?.message || e.message;
      errors.push(`key[${key.slice(0,8)}]: ${msg}`); publicErrors.push(`مفتاح #${i+1}: ${msg}`);
      const status = e.response?.status;
      if (status !== 429 && status !== 503) { console.error("[TTS] فشل:\n" + errors.join("\n")); throw new Error(msg); }
    }
  }
  throw new Error("كل مفاتيح Gemini فشلت:\n" + publicErrors.join("\n"));
}

// ─── helper: تفاعل على رسالة ────────────────────────────────
function react(api, msgID, threadID, emoji) {
  try { api.setMessageReaction(emoji, msgID, () => {}, true); } catch (_) {}
}

module.exports = {
  config: {
    name:      "tts",
    aliases:   ["speak", "voice", "صوت"],
    version:   "2.3",
    role:      0,
    countDown: 10,
    category:  "media",
    guide: { en:
      "{pn} <نص>               — تحويل النص لصوت عشوائي\n" +
      "{pn} voice <اسم> <نص>  — اختيار صوت معين\n" +
      "{pn} voices             — عرض الأصوات المتاحة"
    }
  },

  onStart: async ({ api, message, args, event }) => {
    const { threadID, messageID } = event;

    if (!args[0]) return message.reply(
      "🎙️ تحويل النص إلى صوت (Gemini TTS)\n\n" +
      "• tts <نص>              — صوت عشوائي\n" +
      "• tts voice <اسم> <نص> — صوت محدد\n" +
      "• tts voices            — قائمة الأصوات الـ 30"
    );

    if (args[0].toLowerCase() === "voices") {
      return message.reply(
        `🎙️ الأصوات المتاحة (${ALL_VOICES.length}):\n\n` +
        ALL_VOICES.join("، ") +
        `\n\n📌 النموذج: ${TTS_MODEL}`
      );
    }

    let voice, text;
    if (args[0].toLowerCase() === "voice") {
      const candidate = args[1] || "";
      voice = ALL_VOICES.find(v => v.toLowerCase() === candidate.toLowerCase()) || nextVoice();
      text  = args.slice(2).join(" ").trim();
    } else {
      voice = nextVoice();
      text  = args.join(" ").trim();
    }

    if (!text)              return message.reply("❌ أرسل النص المراد تحويله.");
    if (text.length > 3000) return message.reply("❌ النص طويل جداً (3000 حرف كحد أقصى).");

    // 🤖 تفاعل "جاري المعالجة"
    react(api, messageID, threadID, "🤖");

    try {
      const { buffer, ext } = await callGeminiTTS(text, voice);
      const filePath = path.join(os.tmpdir(), `tts_${Date.now()}.${ext}`);
      await fs.writeFile(filePath, buffer);

      await new Promise((resolve, reject) =>
        api.sendMessage(
          { body: `🎙️ الصوت: ${voice}`, attachment: fs.createReadStream(filePath) },
          threadID,
          err => err ? reject(err) : resolve()
        )
      );

      react(api, messageID, threadID, "✅");
      try { await fs.remove(filePath); } catch (_) {}

    } catch (e) {
      react(api, messageID, threadID, "❌");
      message.reply(`❌ ${e.message}`);
    }
  }
};
