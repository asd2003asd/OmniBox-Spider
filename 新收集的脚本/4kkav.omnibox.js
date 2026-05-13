// @name 4kkav
// @author 梦
// @description XHamster 4K 分类/搜索/详情播放 OmniBox 版（稳妥版）
// @version 1.0.1
// @indexs 1
// @push 0
// @dependencies axios
// @downloadURL https://example.invalid/4kkav.omnibox.js

const axios = require("axios");
const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");

const HOST = "https://zh.xhamster.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";
const HTTP_TIMEOUT = Number(process.env.XHAMSTER_TIMEOUT_MS || 10000);

const CATEGORIES = [
  { type_id: "4k", type_name: "4k" },
  { type_id: "chinese", type_name: "国产" },
  { type_id: "japanese", type_name: "日本" },
  { type_id: "18-year-old", type_name: "18" },
  { type_id: "singaporean", type_name: "新加坡" },
  { type_id: "asian", type_name: "亚洲" },
  { type_id: "russian", type_name: "俄罗斯" },
  { type_id: "taiwanese", type_name: "中国台湾" },
  { type_id: "college", type_name: "大学生" },
  { type_id: "cumshot", type_name: "射液" },
  { type_id: "orgasm", type_name: "高潮" },
  { type_id: "teen", type_name: "青少年" }
];

function text(v) {
  return String(v == null ? "" : v).trim();
}

function logInfo(message, data) {
  const suffix = data == null ? "" : ` ${JSON.stringify(data)}`;
  OmniBox.log("info", `[4kkav] ${message}${suffix}`);
}

function logError(message, error) {
  OmniBox.log("error", `[4kkav] ${message}: ${error?.message || error}`);
}

async function requestText(url) {
  const res = await axios.get(url, {
    headers: {
      "User-Agent": UA,
      Referer: HOST,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
    },
    timeout: HTTP_TIMEOUT,
    responseType: "text",
    validateStatus: () => true
  });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  return typeof res.data === "string" ? res.data : JSON.stringify(res.data || "");
}

function safeJsonParse(str, fallback = {}) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function cleanJsonText(str) {
  return String(str || "")
    .replace(/^\s*window\.__INITIALS_STATE__\s*=\s*/i, "")
    .replace(/^\s*window\.__INITIAL_STATE__\s*=\s*/i, "")
    .replace(/^\s*window\.__INITIAL_PROPS__\s*=\s*/i, "")
    .replace(/;\s*$/, "")
    .replace(/<div[^>]*>.*?<\/div>/gis, "")
    .replace(/<span[^>]*>.*?<\/span>/gis, "")
    .trim();
}

function extractInitialState(html) {
  const scriptMatch = html.match(/<script[^>]+id=["']initials-script["'][^>]*>([\s\S]*?)<\/script>/i);
  if (scriptMatch) {
    const raw = cleanJsonText(scriptMatch[1]);
    const data = safeJsonParse(raw, null);
    if (data) return data;
  }

  const fallbackMatch = html.match(/window\.__INITIAL(?:S|)_STATE__\s*=\s*(\{[\s\S]*?\})\s*;<\/script>/i);
  if (fallbackMatch) {
    const raw = cleanJsonText(fallbackMatch[1]);
    const data = safeJsonParse(raw, null);
    if (data) return data;
  }

  throw new Error("未找到可解析的初始数据");
}

function absoluteUrl(url) {
  const raw = text(url);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return new URL(raw, HOST).toString();
}

function getCategoryUrl(categoryId, page) {
  const pg = Number(page || 1);
  if (categoryId === "4k") {
    return pg === 1 ? `${HOST}/4k?formatFrozen=1` : `${HOST}/4k/${pg}`;
  }
  return pg === 1 ? `${HOST}/categories/${categoryId}` : `${HOST}/categories/${categoryId}/${pg}`;
}

function getThumbListByCategory(data, categoryId) {
  if (categoryId === "4k") {
    return data?.pagesIndexFormatComponent?.trendingVideoListProps?.videoThumbProps || [];
  }
  return data?.pagesCategoryComponent?.trendingVideoListProps?.videoThumbProps || data?.searchResult?.videoThumbProps || [];
}

function mapVodItem(item) {
  return {
    vod_id: absoluteUrl(item?.pageURL),
    vod_name: text(item?.title),
    vod_pic: absoluteUrl(item?.thumbURL),
    vod_remarks: text(item?.duration || item?.views || "")
  };
}

async function home(params, context) {
  logInfo("home", { from: context?.from || "unknown" });
  const list = CATEGORIES.slice(0, 12).map((item) => ({
    vod_id: `cate:${item.type_id}`,
    vod_name: item.type_name,
    vod_pic: "",
    vod_remarks: "分类入口"
  }));
  return { class: CATEGORIES, list, filters: {} };
}

async function category(params, context) {
  const rawId = text(params?.categoryId || params?.id || "4k");
  const categoryId = rawId.startsWith("cate:") ? rawId.slice(5) : rawId;
  const page = Number(params?.page || 1);
  logInfo("category", { categoryId, page });
  try {
    const html = await requestText(getCategoryUrl(categoryId, page));
    const json = extractInitialState(html);
    const items = getThumbListByCategory(json, categoryId);
    const list = items.map(mapVodItem).filter((it) => it.vod_id);
    return {
      page,
      pagecount: list.length ? page + 1 : page,
      total: list.length,
      list
    };
  } catch (e) {
    logError(`category 失败 ${categoryId}`, e);
    return { page, pagecount: 0, total: 0, list: [] };
  }
}

async function search(params, context) {
  const wd = text(params?.keyword || params?.wd || "");
  const page = Number(params?.page || 1);
  logInfo("search", { wd, page });
  if (!wd) return { page, pagecount: 0, total: 0, list: [] };

  try {
    const url = `${HOST}/search/${encodeURIComponent(wd)}?quality=2160p&page=${page}`;
    const html = await requestText(url);
    const json = extractInitialState(html);
    const items = json?.searchResult?.videoThumbProps || [];
    const list = items.map(mapVodItem).filter((it) => it.vod_id);
    return {
      page,
      pagecount: list.length ? page + 1 : page,
      total: list.length,
      list
    };
  } catch (e) {
    logError(`search 失败 ${wd}`, e);
    return { page, pagecount: 0, total: 0, list: [] };
  }
}

function extractSources(json) {
  return json?.xplayerSettings?.sources?.standard?.h264 || [];
}

async function detail(params, context) {
  const videoId = absoluteUrl(params?.videoId || "");
  logInfo("detail", { videoId });
  if (!videoId) return { list: [] };

  try {
    const html = await requestText(videoId);
    const json = extractInitialState(html);
    const sources = extractSources(json);
    const title =
      text(json?.seo?.entityTitle) ||
      text(json?.videoModel?.title) ||
      text(json?.xplayerSettings?.title) ||
      "4kkav";
    const pic =
      absoluteUrl(json?.xplayerSettings?.thumb) ||
      absoluteUrl(json?.videoModel?.thumbURL) ||
      "";

    const episodes = [];
    for (const item of sources) {
      const quality = text(item?.quality || "");
      const mainUrl = text(item?.url || "");
      const fallback = text(item?.fallback || "");
      if (quality === "auto") {
        if (mainUrl) episodes.push({ name: "4k①", playId: mainUrl });
        if (fallback) episodes.push({ name: "4k②", playId: fallback });
      } else if (mainUrl) {
        episodes.push({ name: quality || "播放", playId: mainUrl });
      }
    }

    return {
      list: [{
        vod_id: videoId,
        vod_name: title,
        vod_pic: pic,
        vod_content: title,
        vod_play_sources: episodes.length ? [{ name: "XSP", episodes }] : []
      }]
    };
  } catch (e) {
    logError("detail 失败", e);
    return { list: [] };
  }
}

async function play(params, context) {
  const playId = text(params?.playId || "");
  const flag = text(params?.flag || "XSP");
  logInfo("play", { flag, hasPlayId: !!playId });
  if (!playId) return { urls: [], flag, parse: 0, header: {} };

  return {
    urls: [{ name: "播放", url: playId }],
    flag,
    parse: 0,
    header: {
      "User-Agent": UA,
      Referer: HOST
    }
  };
}

module.exports = { home, category, search, detail, play };
runner.run(module.exports);
