const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

// ─── إدارة الجلسات ───────────────────────────────────────────
if (!global.soundcloudSearchSessions) global.soundcloudSearchSessions = {};
if (!global.__singCleanupRegistered) {
    global.__singCleanupRegistered = true;
    setInterval(() => {
        const now = Date.now();
        for (const uid in global.soundcloudSearchSessions) {
            if (now - global.soundcloudSearchSessions[uid].timestamp > 120000)
                delete global.soundcloudSearchSessions[uid];
        }
    }, 60000);
}

function getApiKey() {
    const keys = [
        process.env.FERDEV_API_KEY,
        process.env.FERDEV_API_KEY2,
        process.env.FERDEV_API_KEY3
    ].filter(Boolean);
    return keys.length === 0 ? "FREE" : keys[Math.floor(Math.random() * keys.length)];
}

// Render لا يسمح بالكتابة إلا في /tmp — os.tmpdir() يعمل محلياً وعلى Render
function getTempPath(senderID) {
    return path.join(os.tmpdir(), `sing_${Date.now()}_${senderID}.mp3`);
}

module.exports = {
    config: {
        name: "sing",
        version: "4.5.0",
        author: "SunkenBot Developer",
        countDown: 5,
        role: 0,
        description: "بحث وتحميل أغاني كاملة من SoundCloud عبر API ferdev — يعرض قائمة نتائج للاختيار منها",
        category: "media",
        guides: "sing [اسم الأغنية]"
    },

    onChat: async function({ api, event, message }) {
        const { threadID, senderID, body, messageID } = event;
        if (!body) return;

        const trimmed = body.trim();
        const lower   = trimmed.toLowerCase();
        const TRIGGERS = ['sing ', 'mp3 ', 'song ', 'اغنية ', 'أغنية '];
        const trigger  = TRIGGERS.find(t => lower.startsWith(t));

        // ─── 1️⃣ البحث ───────────────────────────────────────────
        if (trigger) {
            const songName = trimmed.slice(trigger.length).trim();
            if (!songName) return message.reply("❌ مثال: sing shape of you");

            let statusMsgId = null;
            try {
                const sent = await new Promise((resolve, reject) =>
                    api.sendMessage("🔍 جاري البحث في SoundCloud...", threadID, (err, info) => err ? reject(err) : resolve(info), messageID)
                );
                statusMsgId = sent?.messageID;
            } catch (_) {}

            const updateStatus = async (text) => {
                try { if (statusMsgId) await api.editMessage(text, statusMsgId); } catch (_) {}
            };

            try {
                const res = await axios.get('https://api.ferdev.my.id/search/soundcloud', {
                    params: { query: songName, apikey: getApiKey() },
                    timeout: 20000
                });

                const items = res.data?.result || [];
                if (items.length === 0) return updateStatus("❌ لم يتم العثور على نتائج.");

                const resultsArray = [];
                let msg = "🎵 نتائج البحث:\n─────────────────\n";

                items.slice(0, 7).forEach((track) => {
                    const title = track.title || `أغنية ${resultsArray.length + 1}`;
                    const url   = track.url || track.permalink_url || track.link;
                    if (url) {
                        resultsArray.push({ title, url });
                        msg += `${resultsArray.length}. 📝 ${title}\n─────────────────\n`;
                    }
                });

                if (resultsArray.length === 0)
                    return updateStatus("❌ فشل استخراج الروابط من نتائج البحث.");

                global.soundcloudSearchSessions[senderID] = {
                    results:   resultsArray,
                    timestamp: Date.now(),
                    statusMsgId,
                };

                msg += `🔢 أرسل رقم الأغنية (1-${resultsArray.length}) للتحميل.\n⏳ تنتهي بعد دقيقتين.`;
                return updateStatus(msg);

            } catch (error) {
                console.error("[SING] Search error:", error.message);
                if (error.code === 'ECONNABORTED' || error.message.includes('timeout'))
                    return updateStatus("❌ انتهت مهلة البحث، حاول مرة أخرى.");
                return updateStatus("❌ خطأ أثناء البحث.");
            }
        }

        // ─── 2️⃣ التحميل ─────────────────────────────────────────
        // نتحقق أولاً من وجود جلسة بحث نشطة لهذا المستخدم تحديدًا قبل
        // تطبيق فحص /^\d+$/ — هذا يقلّل احتمال تعارض onChat هذا مع أمر
        // آخر يستخدم onChat برسائل أرقام مشابهة من مستخدمين بلا جلسة.
        const session = global.soundcloudSearchSessions[senderID];
        if (session && /^\d+$/.test(lower)) {
            if (Date.now() - session.timestamp > 120000) {
                delete global.soundcloudSearchSessions[senderID];
                return message.reply("⏳ انتهت الجلسة، ابحث مجدداً.");
            }

            const index = parseInt(lower) - 1;
            if (index < 0 || index >= session.results.length)
                return message.reply(`❌ اختر رقماً من 1 إلى ${session.results.length}`);

            const chosenTrack = session.results[index];
            const statusMsgId = session.statusMsgId;
            delete global.soundcloudSearchSessions[senderID];

            const updateStatus = async (text) => {
                try { if (statusMsgId) await api.editMessage(text, statusMsgId); } catch (_) {}
            };

            await updateStatus(`📥 جاري تحميل: ${chosenTrack.title}`);

            // ✅ /tmp بدل cache/sing — متوافق مع Render ephemeral filesystem
            const filePath = getTempPath(senderID);

            try {
                const dlRes = await axios.get('https://api.ferdev.my.id/downloader/soundcloud', {
                    params: { link: chosenTrack.url, apikey: getApiKey() },
                    timeout: 20000
                });

                const downloadUrl = dlRes.data?.result?.downloadUrl
                    || dlRes.data?.result?.url
                    || dlRes.data?.result?.download_url;

                if (!downloadUrl) throw new Error("لم يُرجع الـ API رابط تحميل.");

                const streamRes = await axios({
                    url: downloadUrl,
                    method: 'GET',
                    responseType: 'arraybuffer',
                    timeout: 90000,
                    maxContentLength: 26214400,  // 25MB
                    maxBodyLength: 26214400,     // ✅ مطلوب في axios v1+
                });

                const buffer = Buffer.from(streamRes.data);

                if (buffer.length === 0) throw new Error("الملف فارغ.");
                if (buffer.length > 26214400)
                    return updateStatus("⚠️ الملف أكبر من 25MB، لا يمكن إرساله عبر ماسنجر.");

                await fs.writeFile(filePath, buffer);

                const stat = await fs.stat(filePath);
                if (stat.size === 0) throw new Error("الملف فارغ بعد الحفظ.");

                // أرسل الملف كمرفق، ثم احذف رسالة الحالة المؤقتة
                await new Promise((resolve, reject) => {
                    api.sendMessage(
                        {
                            body:       `✅ ${chosenTrack.title}`,
                            attachment: fs.createReadStream(filePath)
                        },
                        threadID,
                        (err) => err ? reject(err) : resolve(),
                        messageID
                    );
                });

                if (statusMsgId) {
                    try { await api.unsendMessage(statusMsgId, threadID); } catch (_) {}
                }

            } catch (error) {
                console.error("[SING] error:", error.message);
                let msg;
                if (error.message.includes("25MB"))
                    msg = "⚠️ الملف أكبر من 25MB.";
                else if (error.code === 'ECONNABORTED' || error.message.includes('timeout'))
                    msg = "❌ انتهت مهلة التحميل، الأغنية قد تكون طويلة جداً.";
                else if (error.message.includes("لم يُرجع"))
                    msg = "❌ فشل الـ API في إرجاع رابط التحميل، حاول أغنية أخرى.";
                else
                    msg = "❌ فشل التحميل أو الإرسال. قد يكون المحتوى محمياً.";
                await updateStatus(msg);
            } finally {
                try {
                    if (await fs.pathExists(filePath)) await fs.remove(filePath);
                } catch (_) {}
            }
        }
    }
};
