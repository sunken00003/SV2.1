"use strict";
/**
 * utlis/danceSticker.js
 * ══════════════════════════════════════════════════════════════
 * دالة مشتركة لإرسال "ستيكر مزاج" (GIF) بعد نجاح تحميل ميديا.
 *
 * الستيكر يُصنَّف عبر الذكاء الاصطناعي بناءً على عنوان الأغنية
 * (حزينة/سعيدة/راب/آسيوية...)، ثم يُجلب GIF مناسب من Giphy —
 * كل هذا يحدث داخل HF Space (الفضاء الموازي)، و Sv2 يستقبل
 * البايتات (binary) جاهزة مباشرة بطلب HTTP واحد فقط.
 *
 * لا يوجد أي ملف ستيكر محلي أو خيار احتياطي ثابت: إن فشل جلب
 * الـ GIF لأي سبب (HF Space واقع، Giphy فشل، AI فشل...) فلا
 * يُرسَل أي ستيكر إطلاقاً، بصمت، دون التأثير على الأمر الأساسي.
 *
 * المتطلب: متغيّر البيئة HF_SPACE_URL يجب أن يشير لعنوان HF Space
 * مثلاً: HF_SPACE_URL=https://username-spacename.hf.space
 *
 * يستخدمها: yt.js, yt2.js, ydl.js, sc.js
 * ══════════════════════════════════════════════════════════════
 */

const axios = require("axios");

const HF_SPACE_URL = (process.env.HF_SPACE_URL || "").replace(/\/+$/, "");
const MOOD_ENDPOINT = "/stickers/mood";

// لا نعيد المحاولة بشراسة إن كان HF Space واقعاً — نسكت لمدة قصيرة
const FAIL_COOLDOWN_MS = 60 * 1000; // دقيقة واحدة
let _lastFailureAt = 0;

/**
 * يصنّف عنوان الأغنية عبر الذكاء الاصطناعي (في hf-space) ويجلب GIF
 * مناسب للمزاج من Giphy، ثم يرسله كمرفق في المحادثة.
 *
 * يطلب من hf-space البايتات جاهزة مباشرة (binary) — طلب HTTP واحد
 * فقط من جهة Sv2، وهذا أسرع من جلب رابط ثم تحميله بطلب ثانٍ.
 *
 * فاشلة بصمت دائماً — الستيكر اختياري ولا يجب أن يوقف تنفيذ الأمر الأساسي.
 *
 * @param {object} api - واجهة fca (api.sendMessage...)
 * @param {string} threadID
 * @param {string} title - عنوان الأغنية/الفيديو المراد تصنيف مزاجه
 */
async function sendMoodSticker(api, threadID, title) {
  if (!HF_SPACE_URL || !title) return;

  // تجنّب قصف HF Space بطلبات متكررة وقت تعطّله
  if (Date.now() - _lastFailureAt < FAIL_COOLDOWN_MS) return;

  try {
    const res = await axios.get(`${HF_SPACE_URL}${MOOD_ENDPOINT}`, {
      params:         { title },
      responseType:   "arraybuffer",
      timeout:        20000,
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
        { attachment: bufferToStream(buffer, ext) },
        threadID,
        (err) => (err ? reject(err) : resolve())
      )
    );
  } catch (err) {
    _lastFailureAt = Date.now();
    console.warn(
      "[STICKER] فشل جلب/إرسال ستيكر المزاج (mood) من HF Space:",
      err.message
    );
    // لا نرمي الخطأ — الستيكر اختياري، لا يجب أن يوقف الأمر الأساسي
  }
}

/**
 * يحوّل Buffer إلى Readable stream متوافق مع ما تتوقعه fca (api.sendMessage)
 * بدون الحاجة لكتابة الملف على القرص (/tmp) أصلاً.
 *
 * ⚠️ مهم: معظم تطبيقات fca (fca-unofficial وما شابهها) تعتمد على
 * خاصية `.path` الموجودة على الـ stream (كما يحدث تلقائياً مع
 * fs.createReadStream("اسم.gif")) لتحديد امتداد/نوع المرفق المُرسَل
 * لفيسبوك. بدون هذه الخاصية يُرسَل الملف بدون امتداد، فيعرضه
 * ماسنجر كملف عام بدل صورة متحركة. لذلك نضيف `path` وهمياً صريحاً
 * ينتهي بالامتداد الصحيح.
 */
function bufferToStream(buffer, ext = "gif") {
  const { Readable } = require("stream");
  const stream = Readable.from(buffer);
  stream.path = `sticker_${Date.now()}.${ext}`;
  return stream;
}

module.exports = { sendMoodSticker };
