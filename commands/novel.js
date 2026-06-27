const axios = require("axios");
const cheerio = require("cheerio");

const HF_SCRAPER_URL = process.env.HF_SCRAPER_URL || "";

const cache = new Map();
const CACHE_TTL = 3600 * 1000;
const cacheGet = (k) => {
  const i = cache.get(k);
  if (!i) return undefined;
  if (Date.now() > i.expires) { cache.delete(k); return undefined; }
  return i.value;
};
const cacheSet = (k, v) => cache.set(k, { value: v, expires: Date.now() + CACHE_TTL });

// ─── تنظيف دوري فعلي (لا يعتمد فقط على التنظيف الكسول عند الطلب) ──
// بدون هذا، أي مفتاح لم يُطلب مجددًا يبقى في الذاكرة للأبد حتى بعد
// انتهاء صلاحيته الفعلية.
if (!global.__novelCacheCleanupRegistered) {
  global.__novelCacheCleanupRegistered = true;
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of cache.entries()) {
      if (now > v.expires) cache.delete(k);
    }
  }, CACHE_TTL);
}

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
};

const FALLBACK_SITES = [
  {
    name: "MtlNovel",
    // يحتاج جلب slug الفصل من صفحة الفهرس أولاً
    buildUrl: (slug, ch) => `https://www.mtlnovel.me/read/${slug}/chapter-${ch}-`,
    indexUrl: (slug) => `https://www.mtlnovel.me/${slug}/`,
    selectors: [".cha-content", ".chapter-content", "#chapter-content", "article .content", ".entry-content"],
    titleSel: [".novel-title", "h1.title", ".post-title", "title"],
    slugify: (n) => n.toLowerCase().replace(/'/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    buildChapter: (ch) => String(ch),
    needsSlugLookup: true,
  },
  {
    name: "AllNovelFull",
    buildUrl: (slug, ch) => `https://allnovelfull.net/${slug}/chapter-${ch}.html`,
    selectors: ["#chapter-content", ".chapter-content", ".text-content"],
    titleSel: [".truyen-title", "h3.title", "title"],
    slugify: (n) => n.toLowerCase().replace(/'/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    buildChapter: (ch) => String(ch),
    needsSlugLookup: false,
  },
  {
    name: "NovelFull",
    buildUrl: (slug, ch) => `https://novelfull.com/${slug}/chapter-${ch}.html`,
    selectors: ["#chapter-content", ".chapter-content", ".text-left"],
    titleSel: [".truyen-title", "h3.title", "title"],
    slugify: (n) => n.toLowerCase().replace(/'/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    buildChapter: (ch) => String(ch),
    needsSlugLookup: false,
  },
  {
    name: "NovelFire",
    buildUrl: (slug, ch) => `https://novelfire.net/novel/${slug}/chapter-${ch}`,
    selectors: [".chapter-content", "#chapter-content", ".novel-body", ".text-content"],
    titleSel: [".novel-title", "h1.title", ".book-name", "title"],
    slugify: (n) => n.toLowerCase().replace(/'/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    buildChapter: (ch) => String(ch),
    needsSlugLookup: false,
  },
];

const PROXIES = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
];

const FILTER_WORDS = [
  "novelfull.com", "boxnovel", "novelmt.com", "mtlnovel.me",
  "advertisement", "report chapter", "next chapter", "prev chapter",
  "table of contents", "access denied", "just a moment", "cloudflare",
  "enable javascript", "read more at",
];
const isFiltered = (t) => FILTER_WORDS.some(w => t.toLowerCase().includes(w));

async function translateBatch(paragraphs) {
  if (!paragraphs?.length) return [];
  const arabicChars = paragraphs.join("").match(/[\u0600-\u06FF]/g);
  if (arabicChars && arabicChars.length > 50) return paragraphs;

  const SEP = " ||| ";
  const chunks = [];
  let current = "";
  for (const p of paragraphs) {
    const candidate = current ? current + SEP + p : p;
    if (candidate.length > 3800 && current) { chunks.push(current); current = p; }
    else current = candidate;
  }
  if (current) chunks.push(current);

  console.log(`[TRANSLATE] ${paragraphs.length} فقرة → ${chunks.length} chunk`);

  const out = [];
  for (let i = 0; i < chunks.length; i++) {
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ar&dt=t&q=${encodeURIComponent(chunks[i])}`;
      const res = await axios.get(url, { timeout: 15000, headers: { "User-Agent": "Mozilla/5.0" } });
      if (res.data?.[0]) out.push(res.data[0].map(x => x[0]).filter(Boolean).join(""));
      else out.push(chunks[i]);
    } catch { out.push(chunks[i]); }
    if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 300));
  }

  const result = out.join(SEP).split("|||").map(p => p.trim()).filter(Boolean);
  return result.length > 0 ? result : paragraphs;
}

function splitMessage(text, maxLen = 8000) {
  const chunks = [];
  let current = "";
  for (const para of text.split("\n\n")) {
    if ((current + para + "\n\n").length > maxLen) {
      if (current.trim()) chunks.push(current.trim());
      current = para + "\n\n";
    } else {
      current += para + "\n\n";
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text];
}

async function fetchHTML(url) {
  const attempts = [
    { url, headers: BROWSER_HEADERS },
    ...PROXIES.map(p => ({ url: p(url), headers: { "User-Agent": BROWSER_HEADERS["User-Agent"] } }))
  ];
  for (const a of attempts) {
    try {
      const res = await axios.get(a.url, { timeout: 20000, headers: a.headers, validateStatus: () => true });
      if (res.status >= 400) continue;
      const html = typeof res.data === "string" ? res.data : String(res.data);
      if (html.length < 500) continue;
      const lower = html.substring(0, 3000).toLowerCase();
      if (lower.includes("just a moment") || lower.includes("cloudflare")) continue;
      return html;
    } catch (_) {}
  }
  throw new Error("فشلت جميع المحاولات");
}

function extractContent($, selectors) {
  let container = null;
  for (const sel of selectors) {
    const el = $(sel).first();
    if (el.length) { container = el; break; }
  }
  if (!container) return null;
  container.find("script,style,ins,.ads,.ad,noscript").remove();
  let paras = [];
  container.find("p").each((_, el) => {
    const t = $(el).text().trim();
    if (t.length > 15 && !isFiltered(t)) paras.push(t);
  });
  if (paras.length < 3) {
    paras = container.text().trim().split(/\n+/).map(p => p.trim()).filter(p => p.length > 15 && !isFiltered(p));
  }
  return paras.length > 0 ? paras : null;
}

// ─── جلب slug الفصل من MtlNovel ──────────────────────────────
async function getMtlNovelChapterUrl(novelSlug, chapterNum) {
  const cacheKey = `mtlnovel_chapters:${novelSlug}`;
  let chapters = cacheGet(cacheKey);

  if (!chapters) {
    // جلب صفحة الفهرس للحصول على روابط الفصول
    const indexUrl = `https://www.mtlnovel.me/${novelSlug}/`;
    try {
      const html = await fetchHTML(indexUrl);
      const $ = cheerio.load(html);
      chapters = {};
      // ابحث عن روابط الفصول
      $("a[href*='chapter']").each((_, el) => {
        const href = $(el).attr("href") || "";
        const text = $(el).text().trim();
        const m = href.match(/chapter-(\d+)/i);
        if (m) chapters[parseInt(m[1])] = href;
      });
      if (Object.keys(chapters).length > 0) cacheSet(cacheKey, chapters);
    } catch (_) {}
  }

  // إذا وجدنا رابط الفصل المحدد استخدمه
  if (chapters && chapters[chapterNum]) {
    const href = chapters[chapterNum];
    return href.startsWith("http") ? href : `https://www.mtlnovel.me${href}`;
  }

  // fallback: بناء الرابط بشكل تقريبي
  return `https://www.mtlnovel.me/read/${novelSlug}/chapter-${chapterNum}/`;
}

async function fetchFromWTRLab(novelName, chapterNum) {
  if (!HF_SCRAPER_URL) throw new Error("HF_SCRAPER_URL غير مضبوط");

  const cacheKey = `wtrlab:${novelName}:${chapterNum}`;
  const cached = cacheGet(cacheKey);
  if (cached) { console.log(`[NOVEL] كاش WTR-Lab ✅`); return cached; }

  const url = `${HF_SCRAPER_URL.replace(/\/$/, "")}/novel/fetch?name=${encodeURIComponent(novelName)}&chapter=${chapterNum}`;
  console.log(`[NOVEL] WTR-Lab ← ${novelName} فصل ${chapterNum}`);

  const res = await axios.get(url, { timeout: 90000, headers: { "User-Agent": "SunkenBot/1.0" } });
  if (!res.data.success) throw new Error(res.data.error || "فشل سيرفر HF");

  const { novel, chapter } = res.data;
  const result = {
    title: novel.title,
    chapterTitle: chapter.title,
    paragraphs: chapter.paragraphs,
    url: chapter.url,
    siteName: "WTR-Lab ✨"
  };
  cacheSet(cacheKey, result);
  return result;
}

async function fetchFromFallback(site, novelName, chapterNum) {
  const cacheKey = `${site.name}:${novelName}:${chapterNum}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const slug = site.slugify(novelName);
  let url;

  // MtlNovel يحتاج lookup للرابط الصحيح
  if (site.needsSlugLookup) {
    url = await getMtlNovelChapterUrl(slug, chapterNum);
    console.log(`[NOVEL] MtlNovel URL: ${url}`);
  } else {
    url = site.buildUrl(slug, site.buildChapter(chapterNum));
  }

  const html = await fetchHTML(url);
  const $ = cheerio.load(html);
  const paragraphs = extractContent($, site.selectors);
  if (!paragraphs || paragraphs.length < 2) throw new Error(`محتوى فارغ (${paragraphs?.length || 0} فقرة)`);

  let title = "";
  for (const sel of site.titleSel) {
    try { const t = $(sel).first().text().trim().split(/[-|•]/)[0].trim(); if (t?.length > 2) { title = t; break; } } catch (_) {}
  }

  const result = { title: title || novelName, chapterTitle: `الفصل ${chapterNum}`, paragraphs, url, siteName: site.name };
  cacheSet(cacheKey, result);
  return result;
}

module.exports = {
  config: {
    name: "novel",
    aliases: ["رواية", "فصل", "read"],
    version: "8.1.0",
    author: "Sunken",
    countDown: 20,
    role: 0,
    shortDescription: { ar: "قراءة فصول الروايات مترجمة للعربية" },
    category: "tools",
    guide: { ar: "{pn}novel [اسم الرواية] [رقم الفصل]\nمثال: .novel martial peak 1" }
  },

  onStart: async function ({ api, event, args, message }) {
    const { threadID, messageID } = event;

    if (args.length < 2) {
      return api.sendMessage(
        "📚 قارئ الروايات\n\n" +
        "📝 الاستخدام:\n  .novel [اسم الرواية] [رقم الفصل]\n\n" +
        "💡 أمثلة:\n" +
        "  .novel martial peak 1\n" +
        "  .novel solo leveling 100\n\n" +
        "🌐 المصادر:\n" +
        "  ① WTR-Lab ② MtlNovel ③ NovelHall ④ AllNovelFull ⑤ NovelFull\n\n" +
        "🔄 الترجمة تلقائية للعربية",
        threadID, null, messageID
      );
    }

    const lastArg = args[args.length - 1];
    if (isNaN(lastArg) || Number(lastArg) < 1) {
      return api.sendMessage(
        "❌ يجب أن يكون آخر شيء في الأمر رقم الفصل\n💡 مثال: .novel martial peak 1",
        threadID, null, messageID
      );
    }

    const chapterNum = parseInt(lastArg);
    const novelName  = args.slice(0, -1).join(" ");

    // 🤖 تفاعل "جاري المعالجة"
    try { api.setMessageReaction("🤖", messageID, () => {}, true); } catch (_) {}

    let result = null;

    // أولاً: WTR-Lab
    if (HF_SCRAPER_URL) {
      try {
        result = await fetchFromWTRLab(novelName, chapterNum);
        console.log(`[NOVEL] ✅ WTR-Lab نجح`);
      } catch (err) {
        console.warn(`[NOVEL] WTR-Lab فشل: ${err.message?.substring(0, 80)}`);
      }
    }

    // ثانياً: مواقع احتياطية
    if (!result) {
      for (const site of FALLBACK_SITES) {
        try {
          result = await fetchFromFallback(site, novelName, chapterNum);
          console.log(`[NOVEL] ✅ ${site.name} نجح`);
          break;
        } catch (err) {
          console.warn(`[NOVEL] ${site.name} فشل: ${err.message?.substring(0, 60)}`);
          await new Promise(r => setTimeout(r, 400));
        }
      }
    }

    if (!result) {
      try { api.setMessageReaction("❌", messageID, () => {}, true); } catch (_) {}
      return api.sendMessage(
        `❌ لم أجد الفصل في أي مصدر\n\n📖 ${novelName}\n📄 الفصل ${chapterNum}\n\n` +
        `💡 تأكد من:\n• الاسم الإنجليزي الصحيح\n• رقم الفصل صحيح`,
        threadID, null, messageID
      );
    }

    const translated = await translateBatch(result.paragraphs);

    const divider      = "─".repeat(35);
    const chapterLabel = result.chapterTitle || `الفصل ${chapterNum}`;
    const header       = `📖 ${result.title}\n📄 ${chapterLabel}\n🌐 ${result.siteName}\n${divider}\n\n`;
    const fullText     = header + translated.join("\n\n");
    const chunks       = splitMessage(fullText);

    for (let i = 0; i < chunks.length; i++) {
      const suffix = chunks.length > 1 ? `\n\n${divider}\n📌 ${i + 1} / ${chunks.length}` : "";
      const body   = chunks[i] + suffix;
      await new Promise(r => setTimeout(r, i === 0 ? 0 : 800));
      api.sendMessage(body, threadID, null, messageID);
    }

    try { api.setMessageReaction("✅", messageID, () => {}, true); } catch (_) {}
  }
};
