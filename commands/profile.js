"use strict";

/**
 * commands/profile.js
 *
 * مثال عملي على أمر يستخدم MongoDB (Mongoose) بدلاً من SQLite
 *
 * يعرض ملف المستخدم: الاسم، المال، XP، المستوى، عدد الرسائل
 * ويدعم تحديث البيانات من نفس الأمر.
 *
 * الاستخدام:
 *   profile                ← عرض ملف المستخدم الحالي
 *   profile @شخص          ← عرض ملف شخص آخر (بالرد على رسالته)
 */

// ─── استيراد الموديل من ملف الـ Schemas ───────────────────────
const { UserModel } = require("../db/schemas");

// ─── دالة مساعدة: جلب أو إنشاء مستخدم ───────────────────────
// هذه الدالة هي بديل مباشر لـ getUser() القديم في SQLite
async function getOrCreateUser(facebookId, name) {
  // findOneAndUpdate بـ upsert:true = إذا موجود يُعيده، إذا لا يُنشئه
  const user = await UserModel.findOneAndUpdate(
    { facebookId },                           // شرط البحث
    {
      $setOnInsert: { facebookId, name },     // يُطبَّق فقط عند الإنشاء الأول
      $set:         { lastSeen: new Date() }, // يُطبَّق دائماً
      $inc:         { messageCount: 1 },      // زيادة عداد الرسائل
    },
    {
      new:    true,   // إرجاع الوثيقة بعد التعديل
      upsert: true,   // إنشاؤها إن لم تكن موجودة
    }
  );
  return user;
}

// ─── دالة مساعدة: رسم شريط التقدم ────────────────────────────
function progressBar(current, max, length = 10) {
  const filled = Math.round((current / max) * length);
  const empty  = length - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

module.exports = {
  config: {
    name:             "profile",
    aliases:          ["بروفايل", "ملف", "حساب"],
    version:          "2.0.0",
    author:           "Sunken",
    countDown:        5,
    role:             0,
    nonPrefix:        true,
    shortDescription: { ar: "عرض ملف المستخدم (MongoDB)" },
    category:         "أدوات",
    guide:            { ar: "{pn}profile أو {pn}profile @شخص" },
  },

  onStart: async function ({ api, event, args, message }) {
    const { threadID, messageID, senderID, messageReply } = event;

    // ─── تحديد المستخدم المستهدف ─────────────────────────────
    // إذا رد المستخدم على رسالة شخص آخر → اعرض ملف ذلك الشخص
    const targetId   = messageReply?.senderID || senderID;
    const targetName = messageReply?.senderName || event.senderName || "مستخدم";

    // ─── التحقق من وجود اتصال بـ MongoDB ──────────────────────
    if (!global.db) {
      return message.reply(
        "❌ قاعدة البيانات غير متصلة.\n" +
        "تأكد من إضافة MONGO_URI في متغيرات البيئة."
      );
    }

    try {
      // ─── جلب أو إنشاء بيانات المستخدم ─────────────────────
      // هذا هو البديل المباشر لـ:
      //   db.get("SELECT * FROM users WHERE id = ?", [targetId], ...)
      const user = await getOrCreateUser(targetId, targetName);

      // ─── حساب XP المطلوب للمستوى التالي ───────────────────
      const xpForNextLevel = Math.pow(user.level, 2) * 100;
      const xpProgress     = user.xp - Math.pow(user.level - 1, 2) * 100;
      const xpNeeded       = xpForNextLevel - Math.pow(user.level - 1, 2) * 100;
      const bar            = progressBar(xpProgress, xpNeeded, 12);

      // ─── بناء الرسالة ───────────────────────────────────────
      const roleEmoji = ["👤", "🛡️", "⚔️", "👑", "🔧"][user.role] || "👤";

      const reply =
        `━━━━━━━━━━━━━━━━\n` +
        `👤 ملف: ${user.name}\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `${roleEmoji} الدور: ${getRoleName(user.role)}\n` +
        `💰 المال: ${user.money.toLocaleString("ar")} عملة\n` +
        `⭐ XP: ${user.xp.toLocaleString("ar")}\n` +
        `🏆 المستوى: ${user.level}\n` +
        `📊 التقدم: [${bar}]\n` +
        `    ${xpProgress}/${xpNeeded} XP للمستوى ${user.level + 1}\n` +
        `💬 الرسائل: ${user.messageCount.toLocaleString("ar")}\n` +
        `📅 الانضمام: ${user.createdAt.toLocaleDateString("ar")}\n` +
        `━━━━━━━━━━━━━━━━`;

      return message.reply(reply);

    } catch (err) {
      console.error("[profile] ❌ خطأ في MongoDB:", err.message);
      return message.reply("❌ حدث خطأ أثناء جلب البيانات، حاول مرة أخرى.");
    }
  },
};

function getRoleName(role) {
  return ["عادي", "مشرف", "مودراتور", "VIP", "مطور"][role] || "عادي";
}

// ══════════════════════════════════════════════════════════════
//
//  📖 دليل التحويل من SQLite إلى MongoDB (Mongoose)
//
//  ┌─────────────────────────┬──────────────────────────────────┐
//  │ SQLite (القديم)          │ Mongoose (الجديد)                │
//  ├─────────────────────────┼──────────────────────────────────┤
//  │ db.get("SELECT ...")    │ UserModel.findOne({...})         │
//  │ db.run("INSERT ...")    │ new UserModel({...}).save()      │
//  │ db.run("UPDATE ...")    │ UserModel.findOneAndUpdate(...)  │
//  │ db.run("DELETE ...")    │ UserModel.deleteOne({...})       │
//  │ db.all("SELECT ...")    │ UserModel.find({...})            │
//  └─────────────────────────┴──────────────────────────────────┘
//
//  أمثلة سريعة:
//
//  ✅ إضافة مال:
//     await UserModel.findOneAndUpdate(
//       { facebookId: senderID },
//       { $inc: { money: 500 } },
//       { upsert: true, new: true }
//     );
//
//  ✅ خصم مال:
//     await UserModel.findOneAndUpdate(
//       { facebookId: senderID, money: { $gte: 100 } },
//       { $inc: { money: -100 } }
//     );
//
//  ✅ جلب أغنى 10 مستخدمين:
//     const top = await UserModel
//       .find({})
//       .sort({ money: -1 })
//       .limit(10);
//
//  ✅ حذف مستخدم:
//     await UserModel.deleteOne({ facebookId: userId });
//
// ══════════════════════════════════════════════════════════════
