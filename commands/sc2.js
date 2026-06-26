"use strict";
/**
 * sc2.js — مقطع Preview من SoundCloud
 * ════════════════════════════════════════════════════
 * الإصلاحات:
 *   - استخدام `which ffmpeg` للعثور على ffmpeg النظام بدل ffmpeg-static
 *   - fallback لـ /usr/bin/ffmpeg إن فشل which
 *   - التحقق من حجم الـ raw stream قبل التحويل
 *   - timeout صريح على pipe
 * ════════════════════════════════════════════════════
 */

const play          = require("play-dl");
const axios         = require("axios");
const fs            = require("fs-extra");
const os            = require("os");
const path          = require("path");
const { execFile, exec } = require("child_process");
const { promisify }      = require("util");

const execFileAsync = promisify(execFile);
const execAsync     = promisify(exec);

// ─── العثور على ffmpeg النظام ─────────────────────────────────
let _ffmpegPath = null;

async function getFfmpegPath() {
  if (_ffmpegPath) return _ffmpegPath;

  // 1. جرب which
  try {
    const { stdout } = await execAsync("which ffmpeg");
    const p = stdout.trim();
    if (p) { _ffmpegPath = p; return p; }
  } catch (_) {}

  // 2. مسارات شائعة
  const candidates = [
    "/usr/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/opt/homebrew/bin/ffmpeg",
  ];
  for (const p of candidates) {
    if (await fs.pathExists(p)) { _ffmpegPath = p; return p; }
  }

  throw new Error(
    "ffmpeg غير مثبت على هذا السيرفر\n" +
    "أضف buildCommand في Render: apt-get install -y ffmpeg"
  );
}

// ─── تهيئة play-dl ────────────────────────────────────────────
let _initialized = false;
async function ensureInit() {
  if (_initialized) return;
  try {
    const clientID = await play.getFreeClientID();
    await play.setToken({ soundcloud: { client_id: clientID } });
    console.log("[sc2] ✅ SoundCloud client_id:", clientID?.substring(0, 8) + "...");
  } catch (e) {
    console.warn("[sc2] getFreeClientID فشل، استخدام auto:", e.message);
    await play.setToken({ soundcloud: { client_id: "auto" } });
  }
  _initialized = true;
}

// ─── ستيكرز الرقص ────────────────────────────────────────────
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
      api.sendMessage(
        { attachment: fs.createReadStream(chosen) },
        threadID,
        err => err ? rej(err) : res()
      )
    );
  } catch (_) {}
}

// ─── تحويل raw → mp3 باستخدام ffmpeg النظام ─────────────────
async function toMp3(inputPath, outputPath) {
  const ffmpeg = await getFfmpegPath();
  console.log(`[sc2] ffmpeg: ${ffmpeg}`);

  await execFileAsync(ffmpeg, [
    "-y",
    "-i",  inputPath,
    "-vn",
    "-ar", "44100",
    "-ac", "2",
    "-b:a", "128k",
    "-f",  "mp3",
    outputPath,
  ], { timeout: 90000 });
}

// ─── حفظ stream مع timeout ────────────────────────────────────
function pipeWithTimeout(readable, writePath, timeoutMs = 60000) {
  return new Promise((res, rej) => {
    const out = fs.createWriteStream(writePath);

    const timer = setTimeout(() => {
      try { readable.destroy(); } catch (_) {}
      try { out.destroy();      } catch (_) {}
      rej(new Error("انتهت مهلة تحميل الصوت (60ث)"));
    }, timeoutMs);

    out.on("finish", () => { clearTimeout(timer); res(); });
    out.on("error",  e  => { clearTimeout(timer); rej(e); });
    readable.on("error", e => { clearTimeout(timer); rej(e); });
    readable.pipe(out);
  });
}

// ─── البحث والتحميل ──────────────────────────────────────────
async function searchAndDownload(query) {
  await ensureInit();

  // 1. بحث
  const results = await play.search(query, {
    source: { soundcloud: "tracks" },
    limit: 3,
  });
  if (!results?.length) throw new Error("لم تُوجد نتائج على SoundCloud");

  const track = results[0];
  console.log(`[sc2] وُجدت: ${track.name} | ${track.url}`);

  // 2. جلب stream
  let streamData;
  try {
    streamData = await play.stream(track.url, { quality: 0 });
  } catch (e) {
    throw new Error(`فشل جلب stream: ${e.message}`);
  }

  if (!streamData?.stream) throw new Error("stream فارغ من play-dl");

  // 3. حفظ الـ raw stream
  const rawPath = path.join(os.tmpdir(), `sc2_raw_${Date.now()}`);
  const mp3Path = path.join(os.tmpdir(), `sc2_${Date.now()}.mp3`);

  await pipeWithTimeout(streamData.stream, rawPath, 60000);

  // 4. التحقق من حجم الـ raw قبل التحويل
  const rawStat = await fs.stat(rawPath);
  console.log(`[sc2] raw size: ${rawStat.size} bytes`);

  if (rawStat.size < 5000) {
    await fs.remove(rawPath).catch(() => {});
    throw new Error(
      `الملف الخام صغير جداً (${rawStat.size} bytes) — ` +
      "SoundCloud ربما يحجب الطلب من هذا IP"
    );
  }

  // 5. تحويل إلى mp3
  try {
    await toMp3(rawPath, mp3Path);
  } catch (e) {
    // اقرأ أول 16 byte للتشخيص
    let magic = "";
    try {
      const buf = Buffer.alloc(16);
      const fd  = await fs.open(rawPath, "r");
      await fs.read(fd, buf, 0, 16, 0);
      await fs.close(fd);
      magic = buf.toString("hex");
    } catch (_) {}
    await fs.remove(rawPath).catch(() => {});
    throw new Error(`فشل تحويل الصوت — magic: ${magic} | ${e.message?.substring(0, 100)}`);
  }

  await fs.remove(rawPath).catch(() => {});

  // 6. التحقق من ملف mp3
  const mp3Stat = await fs.stat(mp3Path);
  if (mp3Stat.size < 1000) throw new Error("ملف mp3 فارغ بعد التحويل");

  return {
    filePath:   mp3Path,
    title:      track.name || "بدون عنوان",
    artist:     track.publisher_metadata?.artist || track.user?.username || "",
    durationMs: (track.durationInSec || 0) * 1000,
  };
}

// ─── مساعدات ─────────────────────────────────────────────────
function fmtDuration(ms) {
  if (!ms) return "";
  const s = Math.round(ms / 1000), m = Math.floor(s / 60);
  return `⏱ ${m}:${String(s % 60).padStart(2, "0")}`;
}

async function cleanTemp(p) {
  try { if (p && await fs.pathExists(p)) await fs.remove(p); } catch (_) {}
}

// ════════════════════════════════════════════════════════════
module.exports = {
  config: {
    name:        "sc2",
    aliases:     ["بريفيو2"],
    version:     "5.0",
    role:        0,
    countDown:   10,
    category:    "media",
    description: "مقطع Preview من SoundCloud عبر play-dl + ffmpeg النظام",
    guide: { en: "{pn} <اسم الأغنية>" },
  },

  onStart: async ({ api, message, args, event }) => {
    const { threadID, messageID } = event;

    if (!args[0]) return message.reply(
      "🎵 مقطع Preview من SoundCloud\n\n" +
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

      try { if (statusMsgId) api.unsendMessage(statusMsgId, () => {}); } catch (_) {}
      await sendDanceSticker(api, threadID);

    } catch (err) {
      console.error("[sc2] خطأ:", err.message);
      await update(`❌ ${err.message?.substring(0, 200) || "خطأ غير معروف"}`);
    } finally {
      await cleanTemp(filePath);
    }
  },
};
