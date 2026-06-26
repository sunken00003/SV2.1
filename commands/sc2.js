"use strict";

const play        = require("play-dl");
const axios       = require("axios");
const fs          = require("fs-extra");
const os          = require("os");
const path        = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const ffmpegPath   = require("ffmpeg-static");
const execFileAsync = promisify(execFile);

// ─── تهيئة play-dl ─────────────────────────────────────────────
let _initialized = false;
async function ensureInit() {
  if (_initialized) return;
  try {
    const clientID = await play.getFreeClientID();
    await play.setToken({ soundcloud: { client_id: clientID } });
  } catch {
    await play.setToken({ soundcloud: { client_id: "auto" } });
  }
  _initialized = true;
}

// ─── ستيكرز الرقص ──────────────────────────────────────────────
const STICKERS_DIR  = path.join(__dirname, "..", "assets", "dance_stickers");
const SUPPORTED_EXT = new Set([".gif", ".png", ".webp"]);
let _stickerCache   = null;

function getStickerFiles() {
  if (_stickerCache) return _stickerCache;
  try {
    const files = fs.readdirSync(STICKERS_DIR)
      .filter(f => SUPPORTED_EXT.has(path.extname(f).toLowerCase()))
      .map(f => path.join(STICKERS_DIR, f));
    _stickerCache = files.length ? files : [];
    return _stickerCache;
  } catch (_) { return []; }
}

async function sendDanceSticker(api, threadID) {
  const files = getStickerFiles();
  if (!files.length) return;
  const chosen = files[Math.floor(Math.random() * files.length)];
  try {
    await new Promise((res, rej) =>
      api.sendMessage({ attachment: fs.createReadStream(chosen) }, threadID,
        err => err ? rej(err) : res())
    );
  } catch (_) {}
}

// ─── تحويل الصوت الخام → mp3 عبر ffmpeg-static ─────────────────
async function toMp3(inputPath, outputPath) {
  await execFileAsync(ffmpegPath, [
    "-y",
    "-i", inputPath,
    "-vn",
    "-ar", "44100",
    "-ac", "2",
    "-b:a", "128k",
    "-f", "mp3",
    outputPath
  ], { timeout: 60000 });
}

// ─── البحث والتحميل ────────────────────────────────────────────
async function searchAndDownload(query) {
  await ensureInit();

  const results = await play.search(query, {
    source: { soundcloud: "tracks" },
    limit: 1,
  });
  if (!results?.length) throw new Error("لم تُوجد نتائج على SoundCloud");

  const track = results[0];

  const rawPath = path.join(os.tmpdir(), `sc2_raw_${Date.now()}`);
  const mp3Path = path.join(os.tmpdir(), `sc2_${Date.now()}.mp3`);

  // جلب stream من play-dl (HLS أو Opus أو أي صيغة)
  const streamData = await play.stream(track.url, { quality: 0 });

  // حفظ الـ raw stream كما هو
  await new Promise((res, rej) => {
    const timeout = setTimeout(() => {
      try { streamData.stream.destroy(); } catch (_) {}
      rej(new Error("انتهت مهلة التحميل"));
    }, 60000);

    const out = fs.createWriteStream(rawPath);
    streamData.stream.pipe(out);
    out.on("finish", () => { clearTimeout(timeout); res(); });
    out.on("error",  e  => { clearTimeout(timeout); rej(e); });
    streamData.stream.on("error", e => { clearTimeout(timeout); rej(e); });
  });

  const rawStat = await fs.stat(rawPath);
  if (rawStat.size < 1000) throw new Error("الملف الخام فارغ أو ناقص");

  // تحويل إلى mp3 حقيقي
  await toMp3(rawPath, mp3Path);
  await fs.remove(rawPath).catch(() => {});

  const mp3Stat = await fs.stat(mp3Path);
  if (mp3Stat.size < 1000) throw new Error("فشل تحويل الصوت إلى mp3");

  return {
    filePath:   mp3Path,
    title:      track.name || "بدون عنوان",
    artist:     track.publisher_metadata?.artist || track.user?.username || "",
    durationMs: (track.durationInSec || 0) * 1000,
  };
}

// ─── مساعدات ───────────────────────────────────────────────────
function fmtDuration(ms) {
  if (!ms) return "";
  const s = Math.round(ms / 1000), m = Math.floor(s / 60);
  return `⏱ ${m}:${String(s % 60).padStart(2, "0")}`;
}

async function cleanTemp(p) {
  try { if (p && await fs.pathExists(p)) await fs.remove(p); } catch (_) {}
}

// ═══════════════════════════════════════════════════════════════
module.exports = {
  config: {
    name:        "sc2",
    aliases:     ["بريفيو2"],
    version:     "4.0",
    role:        0,
    countDown:   10,
    category:    "media",
    description: "تحميل مقطع Preview من SoundCloud عبر مكتبة play-dl — بديل احتياطي لأمر sc",
    guide: { en: "{pn} <اسم الأغنية>  —  مقطع preview من SoundCloud عبر play-dl" }
  },

  onStart: async ({ api, message, args, event }) => {
    const { threadID, messageID } = event;

    if (!args[0]) return message.reply(
      "🎵 مقطع Preview من SoundCloud (play-dl)\n\n" +
      "الاستخدام:\n" +
      ".sc2 <اسم الأغنية>\n\n" +
      "مثال:\n" +
      ".sc2 after the dark mr kitty"
    );

    const query = args.join(" ").trim();

    let statusMsgId = null;
    try {
      const sent = await new Promise((res, rej) =>
        api.sendMessage(
          `🔍 جارٍ البحث عن "${query}" في SoundCloud...`,
          threadID,
          (err, info) => err ? rej(err) : res(info),
          messageID
        )
      );
      statusMsgId = sent?.messageID;
    } catch (_) {}

    const update = async (t) => {
      try { if (statusMsgId) await api.editMessage(t, statusMsgId); } catch (_) {}
    };

    let filePath = null;
    try {
      await update("🎵 جارٍ تحميل المقطع وتحويله...");

      const result = await searchAndDownload(query);
      filePath = result.filePath;

      const body =
        `🎵 ${result.title}` +
        `${result.artist     ? `\n👤 ${result.artist}`               : ""}` +
        `${result.durationMs ? `\n${fmtDuration(result.durationMs)}` : ""}` +
        `\n🔊 مقطع Preview — SoundCloud`;

      await new Promise((res, rej) =>
        api.sendMessage(
          { body, attachment: fs.createReadStream(filePath) },
          threadID,
          err => err ? rej(err) : res()
        )
      );

      try { if (statusMsgId) api.unsendMessage(statusMsgId, threadID); } catch (_) {}
      await sendDanceSticker(api, threadID);

    } catch (err) {
      console.error("[sc2] خطأ:", err.message);
      await update(`❌ ${err.message?.substring(0, 200) || "خطأ غير معروف"}`);
    } finally {
      await cleanTemp(filePath);
    }
  },
};
