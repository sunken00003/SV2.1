"use strict";
/**
 * utlis/danceSticker.js
 * ══════════════════════════════════════════════════════════════
 * دالة مشتركة لإرسال "ستيكر رقص" بعد نجاح تحميل ميديا.
 *
 * ⚠️ تغيير مهم: الستيكرز لم تعد مخزّنة محلياً داخل ريبو Sv2
 * (لم نعد نقرأ من assets/dance_stickers هنا) — أصبحت مخزّنة في
 * HF Space (الفضاء الموازي) ويتم جلبها عبر HTTP عند الحاجة فقط.
 *
 * المتطلب: متغيّر البيئة HF_SPACE_URL يجب أن يشير لعنوان HF Space
 * مثلاً: HF_SPACE_URL=https://username-spacename.hf.space
 *
 * يستخدمها: yt.js, yt2.js, ydl.js, sc.js, sc2.js
 * ══════════════════════════════════════════════════════════════
 */

const axios = require("axios");

const HF_SPACE_URL = (process.env.HF_SPACE_URL || "").replace(/\/+$/, "");
const STICKER_ENDPOINT = "/stickers/random";
const MOOD_ENDPOINT    = "/stickers/mood";

// لا نعيد المحاولة بشراسة إن كان HF Space واقعاً — نسكت لمدة قصيرة
const FAIL_COOLDOWN_MS = 60 * 1000; // دقيقة واحدة
let _lastFailureAt = 0;

/**
 * يجلب ستيكر رقص عشوائي من HF Space ويرسله كمرفق في المحادثة.
 * فاشلة بصمت دائماً — الستيكر اختياري ولا يجب أن يوقف تنفيذ الأمر الأساسي.
 *
 * @param {object} api - واجهة fca (api.sendMessage...)
 * @param {string} threadID
 */
async function sendDanceSticker(api, threadID) {
  if (!HF_SPACE_URL) {
    // لم يُضبط HF_SPACE_URL — لا شيء نفعله، بصمت
    return;
  }

  // تجنّب قصف HF Space بطلبات متكررة وقت تعطّله
  if (Date.now() - _lastFailureAt < FAIL_COOLDOWN_MS) return;

  try {
    const res = await axios.get(`${HF_SPACE_URL}${STICKER_ENDPOINT}`, {
      responseType: "arraybuffer",
      timeout:      15000,
      validateStatus: (s) => s === 200,
    });

    const buffer = Buffer.from(res.data);
    if (!buffer.length) return;

    const contentType = res.headers["content-type"] || "image/gif";
    const ext =
      contentType.includes("png")  ? "png"  :
      contentType.includes("webp") ? "webp" : "gif";

    await new Promise((resolve, reject) =>
      api.sendMessage(
        {
          attachment: bufferToStream(buffer),
        },
        threadID,
        (err) => (err ? reject(err) : resolve())
      )
    );

    void ext; // محفوظة للتشخيص المستقبلي إن احتجنا اسم/امتداد الملف
  } catch (err) {
    _lastFailureAt = Date.now();
    console.warn(
      "[STICKER] فشل جلب/إرسال ستيكر الرقص من HF Space:",
      err.message
    );
    // لا نرمي الخطأ — الستيكر اختياري، لا يجب أن يوقف الأمر الأساسي
  }
}

/**
 * يصنّف عنوان الأغنية عبر الذكاء الاصطناعي (في hf-space) ويجلب GIF
 * مناسب للمزاج من Giphy، ثم يرسله كمرفق في المحادثة.
 *
 * يطلب من hf-space البايتات جاهزة مباشرة (binary) — طلب HTTP واحد
 * فقط من جهة Sv2، وهذا أسرع من جلب رابط ثم تحميله بطلب ثانٍ.
 *
 * عند أي فشل (HF Space واقع، Giphy فاشل، AI فاشل...) تتراجع تلقائياً
 * إلى sendDanceSticker (الستيكر الثابت العشوائي) كخيار احتياطي.
 *
 * @param {object} api - واجهة fca (api.sendMessage...)
 * @param {string} threadID
 * @param {string} title - عنوان الأغنية/الفيديو المراد تصنيف مزاجه
 */
async function sendMoodSticker(api, threadID, title) {
  if (!HF_SPACE_URL || !title) {
    return sendDanceSticker(api, threadID);
  }

  if (Date.now() - _lastFailureAt < FAIL_COOLDOWN_MS) {
    return sendDanceSticker(api, threadID);
  }

  try {
    const res = await axios.get(`${HF_SPACE_URL}${MOOD_ENDPOINT}`, {
      params:         { title },
      responseType:   "arraybuffer",
      timeout:        20000,
      validateStatus: (s) => s === 200,
    });

    const buffer = Buffer.from(res.data);
    if (!buffer.length) return sendDanceSticker(api, threadID);

    await new Promise((resolve, reject) =>
      api.sendMessage(
        { attachment: bufferToStream(buffer) },
        threadID,
        (err) => (err ? reject(err) : resolve())
      )
    );
  } catch (err) {
    console.warn(
      "[STICKER] فشل جلب/إرسال ستيكر المزاج (mood) من HF Space:",
      err.message
    );
    // تراجع للستيكر الثابت العشوائي بدل عدم إرسال أي شيء
    await sendDanceSticker(api, threadID);
  }
}

/**
 * يحوّل Buffer إلى Readable stream متوافق مع ما تتوقعه fca (api.sendMessage)
 * بدون الحاجة لكتابة الملف على القرص (/tmp) أصلاً.
 */
function bufferToStream(buffer) {
  const { Readable } = require("stream");
  return Readable.from(buffer);
}

module.exports = { sendDanceSticker, sendMoodSticker };
