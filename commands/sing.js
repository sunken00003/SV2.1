const axios = require('axios');
const fs    = require('fs-extra');
const path  = require('path');
const os    = require('os');

if (!global.soundcloudSearchSessions) global.soundcloudSearchSessions = {};
if (!global.__singCleanupRegistered) {
    global.__singCleanupRegistered = true;
    setInterval(() => {
        const now = Date.now();
        for (const uid in global.soundcloudSearchSessions)
            if (now - global.soundcloudSearchSessions[uid].timestamp > 120000)
                delete global.soundcloudSearchSessions[uid];
    }, 60000);
}

function getApiKey() {
    const keys = [process.env.FERDEV_API_KEY, process.env.FERDEV_API_KEY2, process.env.FERDEV_API_KEY3].filter(Boolean);
    return keys.length === 0 ? "FREE" : keys[Math.floor(Math.random() * keys.length)];
}

function getTempPath(senderID) {
    return path.join(os.tmpdir(), `sing_${Date.now()}_${senderID}.mp3`);
}

function react(api, msgID, emoji) {
    try { api.setMessageReaction(emoji, msgID, () => {}, true); } catch (_) {}
}

module.exports = {
    config: {
        name: "sing",
        version: "4.6.0",
        countDown: 5,
        role: 0,
        description: "بحث وتحميل أغاني من SoundCloud — يعرض قائمة نتائج للاختيار",
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

        // ─── 1️⃣ البحث ────────────────────────────────────────────
        if (trigger) {
            const songName = trimmed.slice(trigger.length).trim();
            if (!songName) return message.reply("❌ مثال: sing shape of you");

            react(api, messageID, "🤖");

            try {
                const res = await axios.get('https://api.ferdev.my.id/search/soundcloud', {
                    params: { query: songName, apikey: getApiKey() },
                    timeout: 20000
                });

                const items = res.data?.result || [];
                if (items.length === 0) {
                    react(api, messageID, "❌");
                    return api.sendMessage("❌ لم يتم العثور على نتائج.", threadID, null, messageID);
                }

                const resultsArray = [];
                let msg = "🎵 نتائج البحث:\n─────────────────\n";

                items.slice(0, 7).forEach((track) => {
                    const title = track.title || `أغنية ${resultsArray.length + 1}`;
                    const url   = track.url || track.permalink_url || track.link;
                    if (url) {
                        resultsArray.push({ title, url, originMsgID: messageID });
                        msg += `${resultsArray.length}. 📝 ${title}\n─────────────────\n`;
                    }
                });

                if (resultsArray.length === 0) {
                    react(api, messageID, "❌");
                    return api.sendMessage("❌ فشل استخراج الروابط.", threadID, null, messageID);
                }

                global.soundcloudSearchSessions[senderID] = {
                    results: resultsArray, timestamp: Date.now(), originMsgID: messageID,
                };

                msg += `🔢 أرسل رقم الأغنية (1-${resultsArray.length}) للتحميل.\n⏳ تنتهي بعد دقيقتين.`;
                api.sendMessage(msg, threadID, null, messageID);
                react(api, messageID, "✅");

            } catch (error) {
                react(api, messageID, "❌");
                if (error.code === 'ECONNABORTED' || error.message.includes('timeout'))
                    return api.sendMessage("❌ انتهت مهلة البحث، حاول مرة أخرى.", threadID, null, messageID);
                api.sendMessage("❌ خطأ أثناء البحث.", threadID, null, messageID);
            }
            return;
        }

        // ─── 2️⃣ التحميل ──────────────────────────────────────────
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
            const originMsgID = session.originMsgID;
            delete global.soundcloudSearchSessions[senderID];

            react(api, originMsgID, "🤖");
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
                    url: downloadUrl, method: 'GET', responseType: 'arraybuffer',
                    timeout: 90000, maxContentLength: 26214400, maxBodyLength: 26214400,
                });

                const buffer = Buffer.from(streamRes.data);
                if (!buffer.length)           throw new Error("الملف فارغ.");
                if (buffer.length > 26214400) throw new Error("الملف أكبر من 25MB.");

                await fs.writeFile(filePath, buffer);
                if ((await fs.stat(filePath)).size === 0) throw new Error("الملف فارغ بعد الحفظ.");

                await new Promise((resolve, reject) =>
                    api.sendMessage(
                        { body: `🎵 ${chosenTrack.title}`, attachment: fs.createReadStream(filePath) },
                        threadID, err => err ? reject(err) : resolve(), messageID
                    )
                );

                react(api, originMsgID, "✅");

            } catch (error) {
                react(api, originMsgID, "❌");
                let msg;
                if (error.message.includes("25MB"))       msg = "⚠️ الملف أكبر من 25MB.";
                else if (error.code === 'ECONNABORTED')   msg = "❌ انتهت مهلة التحميل.";
                else if (error.message.includes("يُرجع")) msg = "❌ فشل الـ API في إرجاع رابط التحميل.";
                else                                       msg = "❌ فشل التحميل، قد يكون المحتوى محمياً.";
                api.sendMessage(msg, threadID, null, messageID);
            } finally {
                try { if (await fs.pathExists(filePath)) await fs.remove(filePath); } catch (_) {}
            }
        }
    }
};
