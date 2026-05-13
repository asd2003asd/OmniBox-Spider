// @name         MemoJav Optimized
// @version      3.0.6
// @description play统一直链parse:0,直连
// @dependencies cheerio
// @downloadURL https://raw.githubusercontent.com/GD2021/omnibox_rules/refs/heads/badboy/NEW/MemoJav.js

const OmniBox = require("omnibox_sdk");
const cheerio = require("cheerio");

const HOST = "https://memojav.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

const MAX_CONCURRENT = 4;
const RATE_LIMIT = 10;
const RATE_WINDOW = 10000;

const TIMEOUT_LIST = 15000;
const TIMEOUT_DETAIL = 8000;

const ITEM_LIMIT = 24;
const MAX_PAGE = 10;

const TTL_HOT = 1800;
const TTL_WARM = 3600;
const TTL_COLD = 7200;
const TTL_DETAIL = 86400;
const TTL_META = 172800;                 // 48 hours for list-sourced metadata

const CACHE_PREFIX = "memojav:";

const CLASSES = [
    { type_id: "best",                      type_name: "最佳" },
    { type_id: "video",                     type_name: "最新" },
    { type_id: "categories/big-tits-lover", type_name: "Big Tits Lover" },
    { type_id: "categories/big-tits",       type_name: "Big Tits" },
    { type_id: "categories/bodysuit",       type_name: "Bodysuit" },
    { type_id: "categories/mature-woman",   type_name: "Mature Woman" },
    { type_id: "categories/stepfamily",     type_name: "Stepfamily" },
    { type_id: "categories/outdoor",        type_name: "Outdoor" },
    { type_id: "categories/milf",           type_name: "MILF" },
    { type_id: "categories/documentary",    type_name: "Documentary" },
];

const CLASS_MAP = {};
CLASSES.forEach(c => { CLASS_MAP[c.type_id] = c.type_name; });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function formatPic(url) {
    if (!url) return "";
    if (url.startsWith("//")) return "https:" + url;
    if (url.startsWith("http")) return url;
    return HOST + (url.startsWith("/") ? "" : "/") + url;
}

function cleanText(html) {
    if (!html) return "";
    let t = String(html).replace(/<[^>]+>/g, "");
    t = t.replace(/\s*\/\s*/g, " ");
    return t.replace(/\s+/g, " ").trim();
}

// ----------------------------------------------------------
// Sliding window rate limiter
// ----------------------------------------------------------
const timestamps = [];
async function rateLimitWait() {
    const now = Date.now();
    while (timestamps.length && timestamps[0] < now - RATE_WINDOW) {
        timestamps.shift();
    }
    if (timestamps.length >= RATE_LIMIT) {
        const wait = timestamps[0] + RATE_WINDOW - now + 200;
        await sleep(wait);
        return rateLimitWait();
    }
    timestamps.push(Date.now());
}

// ----------------------------------------------------------
// Request queue
// ----------------------------------------------------------
let active = 0;
const queue = [];
function pushTask(task) {
    return new Promise((resolve, reject) => {
        const run = () => {
            active++;
            task()
                .then(resolve, reject)
                .finally(() => {
                    active--;
                    if (queue.length) {
                        const next = queue.shift();
                        next();
                    }
                });
        };
        if (active < MAX_CONCURRENT) run();
        else queue.push(run);
    });
}

// ----------------------------------------------------------
// HTTP GET with retry (max 2 attempts)
// ----------------------------------------------------------
async function httpGet(url, timeout = TIMEOUT_LIST) {
    const fullUrl = url.startsWith("http") ? url : HOST + (url.startsWith("/") ? "" : "/") + url;
    const doFetch = () =>
        OmniBox.request(fullUrl, {
            method: "GET",
            headers: { "User-Agent": UA, Referer: HOST + "/" },
            timeout,
        }).then(res => {
            if (res.statusCode === 429 || res.statusCode === 503) throw new Error(`HTTP ${res.statusCode}`);
            return res.body || "";
        });

    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            await rateLimitWait();
            const body = await pushTask(doFetch);
            return body;
        } catch (e) {
            if (attempt === 1) {
                await OmniBox.log("error", `[MemoJav] HTTP failed: ${fullUrl} - ${e.message}`);
                return "";
            }
            await sleep(1000);
        }
    }
    return "";
}

// ----------------------------------------------------------
// Cache helpers
// ----------------------------------------------------------
async function getCached(key, fetcher, ttl) {
    const raw = await OmniBox.getCache(key);
    if (raw !== null && raw !== undefined) {
        if (typeof raw === "string") {
            try { return JSON.parse(raw); } catch {}
        }
        return raw;
    }
    const data = await fetcher();
    if (data !== null && data !== undefined) {
        await OmniBox.setCache(key, JSON.stringify(data), ttl);
    }
    return data;
}

function metaCacheKey(videoId) {
    return `${CACHE_PREFIX}meta:${videoId}`;
}

function detailCacheKey(videoId) {
    return `${CACHE_PREFIX}detail:${videoId}`;
}

// ----------------------------------------------------------
// URL builders
// ----------------------------------------------------------
function buildCategoryUrl(typeId, page) {
    if (typeId === "best") return page === 1 ? "/best/" : `/best/page-${page}`;
    return page === 1 ? `/${typeId}/` : `/${typeId}/page-${page}`;
}

// ----------------------------------------------------------
// HTML parsers
// ----------------------------------------------------------
function parseList(html, limit, typeId, typeName) {
    if (!html) return [];
    const $ = cheerio.load(html);
    const result = [];
    const seen = new Set();

    const selectors = ["a.video-item", ".video-item > a", "a[href*='/video/']"];
    let items = null;
    for (const sel of selectors) {
        items = $(sel);
        if (items.length) break;
    }
    if (!items) return [];

    items.each((i, el) => {
        if (result.length >= limit) return false;
        const $el = $(el);
        let href = $el.attr("href") || "";
        const m = href.match(/\/video\/([A-Z]+-\d+[A-Z]?)(\/|$)/i);
        if (!m) return true;
        const vodId = m[1].toUpperCase();
        if (seen.has(vodId)) return true;
        seen.add(vodId);

        const imgEl = $el.find("img").first();
        const pic = formatPic(imgEl.attr("data-original") || imgEl.attr("data-src") || imgEl.attr("src") || "");
        const meta = $el.find(".video-metadata").text().trim() || $el.find(".meta").text().trim() || "";
        const title = $el.find(".video-title").first().text().trim() || $el.attr("title") || "";

        const entry = {
            vod_id: vodId,
            type_id: typeId,
            type_name: typeName || CLASS_MAP[typeId] || "JAV",
            vod_name: (title || vodId).substring(0, 120),
            vod_pic: pic,
            vod_remarks: meta,
        };
        result.push(entry);

        // Store basic metadata into separate cache
        const metaObj = {
            vod_id: vodId,
            vod_name: entry.vod_name,
            vod_pic: entry.vod_pic,
            vod_remarks: entry.vod_remarks,
            type_id: entry.type_id,
            type_name: entry.type_name,
        };
        OmniBox.setCache(metaCacheKey(vodId), JSON.stringify(metaObj), TTL_META).catch(() => {});
    });
    return result;
}

function parsePageCount(html, fallback) {
    let count = fallback || 1;
    const pages = html.match(/page-(\d+)/g) || [];
    for (const p of pages) {
        const n = parseInt(p.replace("page-", ""), 10);
        if (n > count) count = n;
    }
    return count;
}

// ----------------------------------------------------------
// Full detail fetcher
// ----------------------------------------------------------
async function fetchDetail(videoId) {
    const html = await httpGet(`/video/${videoId}`, TIMEOUT_DETAIL);
    if (!html) return null;
    const $ = cheerio.load(html);

    const vodName = $("#title").first().text().replace(/\s*\|.+$/, "").trim() || videoId;
    const vodPic = formatPic($("meta[property='og:image']").attr("content") || "");
    const vodContent = $("meta[property='og:description']").attr("content") || "";

    let actressName = "", vodDirector = "", vodYear = "", releaseDate = "", studioName = "", labelName = "", seriesName = "";
    const categories = [];

    $("table tr").each(function () {
        const th = $(this).find("th").text().trim();
        const td = $(this).find("td");
        switch (th) {
            case "Actress:":
                const a = td.find("a[href*='/actress/']").first();
                actressName = cleanText(a.find(".description-vertical").text()) || cleanText(a.text());
                break;
            case "Director:":
                vodDirector = cleanText(td.text());
                break;
            case "Release Date:":
                const txt = td.text().trim();
                const m = txt.match(/(\d{4})/);
                if (m) vodYear = m[1];
                releaseDate = cleanText(txt);
                break;
            case "Studio:":
                studioName = cleanText(td.find(".description-vertical").text()) || cleanText(td.text());
                break;
            case "Label:":
                labelName = cleanText(td.text());
                break;
            case "Series:":
                seriesName = cleanText(td.text());
                break;
            case "Categories:":
                td.find("a[href*='/categories/']").each(function () {
                    const href = $(this).attr("href") || "";
                    const name = cleanText($(this).text());
                    const cm = href.match(/\/categories\/([^/]+)/);
                    if (cm && name) categories.push({ name, id: "categories/" + cm[1] });
                });
                break;
        }
    });

    let remarks = videoId;
    if (studioName) remarks += " • " + studioName;
    if (actressName) remarks += " • " + actressName;
    if (releaseDate) remarks += " • " + releaseDate;

    const m3u8Url = `https://video10.memojav.net/stream/${videoId}/master.m3u8`;

    const item = {
        vod_id: videoId,
        type_id: categories.length ? categories[0].id : "best",
        type_name: categories.length ? categories[0].name : "最佳",
        vod_name: vodName.substring(0, 120),
        vod_pic: vodPic,
        vod_remarks: remarks,
        vod_actor: actressName,
        vod_director: vodDirector,
        vod_year: vodYear,
        vod_content: vodContent,
        vod_play_sources: [{
            name: "默认线路",
            episodes: [{ name: "正片", playId: m3u8Url }],
        }],
    };

    if (labelName) item.vod_label = labelName;
    if (seriesName) item.vod_series = seriesName;
    if (actressName) {
        item.vod_actor_pic = `https://pics.dmm.co.jp/mono/actjpgs/${actressName.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z_]/g, "")}.jpg`;
        item.vod_actor_url = HOST + "/actress/" + actressName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    }
    if (categories.length) item.vod_categories = categories;

    return item;
}

// ----------------------------------------------------------
// Background detail fetcher for cache update
// ----------------------------------------------------------
function fillDetailInBackground(videoId) {
    setImmediate(async () => {
        try {
            const fresh = await fetchDetail(videoId);
            if (fresh) {
                await OmniBox.setCache(detailCacheKey(videoId), JSON.stringify(fresh), TTL_DETAIL);
            }
        } catch (ignored) {}
    });
}

// ========================================
// BUSINESS INTERFACES
// ========================================
async function home(params, context) {
    return { class: CLASSES, filters: {}, list: [] };
}

async function category(params, context) {
    try {
        let tid = params.categoryId || params.tid || "best";
        tid = decodeURIComponent(tid);
        const page = parseInt(params.page || 1, 10);

        if (page > MAX_PAGE) {
            return { page, pagecount: MAX_PAGE, total: MAX_PAGE * ITEM_LIMIT, list: [] };
        }

        let ttl;
        if (page === 1) ttl = TTL_HOT;
        else if (page <= 3) ttl = TTL_WARM;
        else ttl = TTL_COLD;

        const key = `${CACHE_PREFIX}cat:${tid}:${page}`;
        const data = await getCached(key, async () => {
            const url = buildCategoryUrl(tid, page);
            const html = await httpGet(url, TIMEOUT_LIST);
            const list = parseList(html, ITEM_LIMIT, tid, CLASS_MAP[tid]);
            let pagecount = page;
            if (list.length === ITEM_LIMIT) pagecount = page + 1;
            const siteCount = parsePageCount(html, page);
            if (siteCount > pagecount) pagecount = siteCount;
            return { list, pagecount, total: page * ITEM_LIMIT };
        }, ttl);

        return {
            page,
            pagecount: data.pagecount,
            total: data.total,
            list: data.list,
            limit: ITEM_LIMIT,
        };
    } catch (e) {
        await OmniBox.log("error", `[MemoJav] category error: ${e.message}`);
        return { page: 1, pagecount: 1, total: 0, list: [] };
    }
}

async function search(params, context) {
    return { page: 1, pagecount: 0, total: 0, list: [] };
}

async function detail(params, context) {
    try {
        let vid = params.videoId || params.id || params.vod_id || "";
        if (Array.isArray(vid)) vid = vid[0];
        vid = String(vid).toUpperCase().trim();
        if (!vid) return { list: [] };

        // 1. Full detail cache
        const fullKey = detailCacheKey(vid);
        const cachedFull = await OmniBox.getCache(fullKey);
        if (cachedFull !== null && cachedFull !== undefined) {
            const item = typeof cachedFull === "string" ? JSON.parse(cachedFull) : cachedFull;
            return { list: [item] };
        }

        // 2. Fast path: use list metadata (same thumbnail as the cover)
        const metaKey = metaCacheKey(vid);
        const metaRaw = await OmniBox.getCache(metaKey);
        if (metaRaw !== null && metaRaw !== undefined) {
            const meta = typeof metaRaw === "string" ? JSON.parse(metaRaw) : metaRaw;
            // Build a basic vodItem with the thumbnail/cover the user already saw
            const basicItem = {
                vod_id: meta.vod_id || vid,
                vod_name: meta.vod_name || vid,
                vod_pic: meta.vod_pic || "",
                vod_remarks: meta.vod_remarks || "",
                type_id: meta.type_id || "best",
                type_name: meta.type_name || "最佳",
                vod_play_sources: [{
                    name: "默认线路",
                    episodes: [{ name: "正片", playId: `https://video10.memojav.net/stream/${vid}/master.m3u8` }],
                }],
            };
            // Trigger background full detail fetch
            fillDetailInBackground(vid);
            return { list: [basicItem] };
        }

        // 3. Fallback: full fetch now (slowest)
        const fullItem = await fetchDetail(vid);
        if (fullItem) {
            await OmniBox.setCache(detailCacheKey(vid), JSON.stringify(fullItem), TTL_DETAIL);
            return { list: [fullItem] };
        }
        return { list: [] };
    } catch (e) {
        await OmniBox.log("error", `[MemoJav] detail error: ${e.message}`);
        return { list: [] };
    }
}

async function play(params, context) {
    const playId = params.playId || params.url || "";
    if (!playId) return { urls: [], parse: 1, flag: "play" };

    if (/\.(m3u8|mp4|flv|mkv|ts)(\?|$)/i.test(playId)) {
        const headers = {};
        if (context?.from === "web") {
            headers.Referer = HOST + "/";
        }
        return {
            urls: [{ name: "720p", url: playId }],
            header: headers,
            parse: 0,
            flag: params.flag || "play",
        };
    }

    return { urls: [], flag: params.flag || "play", parse: 1 };
}

module.exports = { home, category, search, detail, play };
require("spider_runner").run(module.exports);
