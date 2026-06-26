// commands/up.js — إعادة تحميل + تنظيف + إحصاءات (يدمج reload)
const fs   = require("fs-extra");
const path = require("path");

const CACHE_ROOT = path.join(__dirname, "..", "cache");
// ← إصلاح: القائمة القديمة كانت تتضمن مجلدات لا يكتب فيها أي أمر
// فعليًا في المشروع الحالي ("ai_sessions", "ai2_sessions", "sing",
// "tiktok", "ytdl")، بينما المجلد النشط الوحيد فعليًا (cache/pinterest
// الذي يكتب فيه pinterest.js) كان غير مُدرَج إطلاقًا فلا يُنظَّف عبر
// .up أبدًا. تم تحديث القوائم لتعكس الاستخدام الفعلي الحالي.
const AI_DIRS    = ["ai_sessions_gptx"];
const MEDIA_DIRS = ["pinterest"];
const GLOBAL_SESSIONS = [
    "soundcloudSearchSessions",
    "mediaSearchSessions",
    "youtubeSearchSessions",
    "audioSearchSessions",
];

function formatBytes(b) {
    if (b <= 0)      return "0 B";
    if (b < 1024)    return `${b} B`;
    if (b < 1048576) return `${(b/1024).toFixed(1)} KB`;
    return `${(b/1048576).toFixed(2)} MB`;
}

function formatUptime(sec) {
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (d > 0) return `${d}ي ${h}س ${m}د`;
    if (h > 0) return `${h}س ${m}د ${s}ث`;
    if (m > 0) return `${m}د ${s}ث`;
    return `${s}ث`;
}

async function clearDir(dirPath) {
    let deleted = 0, freed = 0;
    try {
        if (!await fs.pathExists(dirPath)) return { deleted: 0, freed: 0 };
        const files = await fs.readdir(dirPath);
        for (const f of files) {
            if (["Readme.me","empty.txt",".gitkeep"].includes(f)) continue;
            const fp = path.join(dirPath, f);
            try {
                const st = await fs.stat(fp);
                if (st.isFile()) { await fs.unlink(fp); deleted++; freed += st.size; }
            } catch (_) {}
        }
    } catch (_) {}
    return { deleted, freed };
}

async function dirStats(dirPath) {
    let count = 0, size = 0;
    try {
        if (!await fs.pathExists(dirPath)) return { count: 0, size: 0 };
        const files = await fs.readdir(dirPath);
        for (const f of files) {
            if (["Readme.me","empty.txt",".gitkeep"].includes(f)) continue;
            try {
                const st = await fs.stat(path.join(dirPath, f));
                if (st.isFile()) { count++; size += st.size; }
            } catch (_) {}
        }
    } catch (_) {}
    return { count, size };
}

function clearGlobalSessions() {
    let total = 0;
    for (const key of GLOBAL_SESSIONS) {
        if (global[key] && typeof global[key] === "object") {
            total += Object.keys(global[key]).length;
            global[key] = {};
        }
    }
    return total;
}

function countCommandFiles() {
    try {
        return fs.readdirSync(path.join(__dirname, "..", "commands"))
            .filter(f => f.endsWith(".js")).length;
    } catch (_) { return 0; }
}

// ─── دالة Hot Reload المباشرة ────────────────────────────────
function doReload() {
    // global.reloadCommands معرّفة في index.js كـ loadCommands
    if (typeof global.reloadCommands === "function") {
        global.reloadCommands();
        return { ok: true };
    }
    // fallback يدوي: امسح require.cache لكل أوامر
    try {
        const dir = path.join(__dirname, "..", "commands");
        const files = fs.readdirSync(dir).filter(f => f.endsWith(".js"));
        global.commands?.clear?.();
        global.nonPrefixCommands?.clear?.();
        global.eventCommands = [];
        for (const file of files) {
            try {
                const p = path.join(dir, file);
                delete require.cache[require.resolve(p)];
                const cmd = require(p);
                const mod = cmd.default || cmd;
                if (mod.config?.name && (mod.onStart || mod.run || mod.execute)) {
                    const name = mod.config.name.toLowerCase();
                    global.commands?.set(name, mod);
                    global.nonPrefixCommands?.set(name, mod);
                    (mod.config.aliases || []).forEach(a => {
                        global.commands?.set(a.toLowerCase(), mod);
                        global.nonPrefixCommands?.set(a.toLowerCase(), mod);
                    });
                }
                if (mod.onChat || mod.handleEvent) global.eventCommands?.push(mod);
            } catch (_) {}
        }
        return { ok: true };
    } catch (e) {
        return { ok: false, err: e.message };
    }
}

module.exports = {
    config: {
        name: "up",
        aliases: ["reload", "r", "تحديث", "status"],
        version: "3.0.0",
        author: "SunkenBot Developer",
        countDown: 10,
        role: 2,
        shortDescription: { ar: "إعادة تحميل + تنظيف + إحصاءات" },
        category: "admin",
        guide: { ar: "{pn}up" }
    },

    onStart: async function ({ message }) {
        const t0 = Date.now();

        // ── 1. Hot Reload ────────────────────────────────────
        const { ok: reloadOk, err: reloadErr } = doReload();
        const fileCount   = countCommandFiles();
        const eventsCount = global.eventCommands?.length || 0;

        // ── 2. تنظيف الكاش ──────────────────────────────────
        let totalDeleted = 0, totalFreed = 0;
        const cleanLines = [];

        for (const dir of [...AI_DIRS, ...MEDIA_DIRS]) {
            const { deleted, freed } = await clearDir(path.join(CACHE_ROOT, dir));
            if (deleted > 0) {
                const label = AI_DIRS.includes(dir) ? "🤖" : "🎬";
                cleanLines.push(`  ${label} ${dir}: ${deleted} ملف (${formatBytes(freed)})`);
                totalDeleted += deleted;
                totalFreed   += freed;
            }
        }

        const clearedSessions = clearGlobalSessions();

        let remFiles = 0, remSize = 0;
        for (const dir of [...AI_DIRS, ...MEDIA_DIRS]) {
            const { count, size } = await dirStats(path.join(CACHE_ROOT, dir));
            remFiles += count; remSize += size;
        }

        // ── 3. ذاكرة العملية ────────────────────────────────
        const mem  = process.memoryUsage();
        const rss  = (mem.rss      / 1048576).toFixed(1);
        const heap = (mem.heapUsed / 1048576).toFixed(1);
        const ext  = (mem.external / 1048576).toFixed(1);

        // ── 4. Event Loop Lag ────────────────────────────────
        const pingMs = await new Promise(resolve => {
            const start = process.hrtime.bigint();
            setImmediate(() => resolve(Math.round(Number(process.hrtime.bigint() - start) / 1_000_000)));
        });

        // ── 5. وقت التشغيل ──────────────────────────────────
        const uptimeStr = formatUptime(Math.floor(process.uptime()));
        const elapsed   = Date.now() - t0;

        // ── بناء الرسالة ─────────────────────────────────────
        const L = [];
        L.push("╔══════════════════════╗");
        L.push("║   ⚡ SunkenBot — UP   ║");
        L.push("╚══════════════════════╝");
        L.push("");

        L.push(reloadOk ? "✅ Hot Reload نجح" : `❌ فشل Reload: ${reloadErr?.slice(0,60)}`);
        L.push(`   📂 أوامر: ${fileCount} ملف | أحداث: ${eventsCount}`);
        L.push("");

        L.push("🗑️ التنظيف:");
        if (cleanLines.length > 0) {
            cleanLines.forEach(l => L.push(l));
            L.push(`  ✅ ${totalDeleted} ملف — ${formatBytes(totalFreed)} محررة`);
        } else {
            L.push("  ✅ الكاش نظيف");
        }
        if (clearedSessions > 0)
            L.push(`  🧠 جلسات RAM: ${clearedSessions} جلسة محذوفة`);
        L.push(`  💾 متبقٍ: ${remFiles} ملف (${formatBytes(remSize)})`);
        L.push("");

        L.push("🖥️ ذاكرة العملية:");
        L.push(`  • RSS:      ${rss} MB`);
        L.push(`  • Heap:     ${heap} MB`);
        L.push(`  • External: ${ext} MB`);
        L.push("");

        L.push("📊 الأداء:");
        L.push(`  • Loop Lag: ${pingMs}ms`);
        L.push(`  • Uptime:   ${uptimeStr}`);
        L.push(`  • زمن العملية: ${elapsed}ms`);

        message.reply(L.join("\n"));
    }
};
