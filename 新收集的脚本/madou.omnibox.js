// @name 麻豆
// @author 梦
// @description 麻豆接口转 OmniBox 版
// @version 1.0.0
// @indexs 1
// @push 0
// @dependencies axios
// @downloadURL https://example.invalid/madou.omnibox.js

const axios = require("axios");
const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");

const HOME_URL = text(process.env.MADOU_HOME_URL || "");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

function text(v) {
  return String(v == null ? "" : v).trim();
}

function logInfo(message, data) {
  const suffix = data == null ? "" : ` ${JSON.stringify(data)}`;
  OmniBox.log("info", `[麻豆] ${message}${suffix}`);
}

function logError(message, error) {
  OmniBox.log("error", `[麻豆] ${message}: ${error?.message || error}`);
}

async function apiGet(url) {
  const res = await axios.get(url, {
    headers: { "User-Agent": UA },
    timeout: 15000,
    validateStatus: () => true
  });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  return typeof res.data === "string" ? JSON.parse(res.data) : res.data;
}

function ensureHomeUrl() {
  if (!HOME_URL) {
    throw new Error("未配置 MADOU_HOME_URL 环境变量");
  }
  return HOME_URL.replace(/\/$/, "");
}

function pickArray(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.list)) return data.list;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.class)) return data.class;
  return [];
}

function mapVod(item) {
  return {
    vod_id: text(item?.vod_id || item?.id || ""),
    vod_name: text(item?.vod_name || item?.title || item?.name || ""),
    vod_pic: text(item?.vod_pic || item?.pic || item?.cover || ""),
    vod_remarks: text(item?.vod_remarks || item?.remarks || "")
  };
}

async function home(params, context) {
  logInfo("home", { from: context?.from || "unknown" });
  try {
    const base = ensureHomeUrl();
    const data = await apiGet(`${base}/api.php/provide/home_nav`);
    const list = pickArray(data);
    const classes = list.map((item) => ({
      type_id: text(item?.type_id || item?.typeId || item?.id || item?.vod_id || ""),
      type_name: text(item?.type_name || item?.name || item?.title || "")
    })).filter((it) => it.type_id && it.type_name);
    return { class: classes, list: [], filters: {} };
  } catch (e) {
    logError("home 失败", e);
    return { class: [], list: [], filters: {} };
  }
}

async function category(params, context) {
  const categoryId = text(params?.categoryId || params?.id || "");
  const page = Number(params?.page || 1);
  logInfo("category", { categoryId, page });
  if (!categoryId) return { page, pagecount: 0, total: 0, list: [] };

  try {
    const base = ensureHomeUrl();
    const data = await apiGet(`${base}/api.php/provide/vod_list?ac=detail&t=${encodeURIComponent(categoryId)}&pg=${page}`);
    const list = pickArray(data).map(mapVod).filter((it) => it.vod_id);
    const total = Number(data?.total || data?.data?.total || list.length || 0);
    const pagecount = Number(data?.pagecount || data?.data?.pagecount || (list.length ? page : 0));
    return { page, pagecount, total, list };
  } catch (e) {
    logError(`category 失败 ${categoryId}`, e);
    return { page, pagecount: 0, total: 0, list: [] };
  }
}

async function detail(params, context) {
  const videoId = text(params?.videoId || "");
  logInfo("detail", { videoId });
  if (!videoId) return { list: [] };

  try {
    const base = ensureHomeUrl();
    const data = await apiGet(`${base}/api.php/provide/vod_detail?vod_id=${encodeURIComponent(videoId)}`);
    const list = pickArray(data);
    const item = list[0] || data?.data?.list?.[0] || data?.data || data;
    const playUrlRaw = text(item?.vod_play_url || item?.play_url || "");
    const playFromRaw = text(item?.vod_play_from || item?.play_from || "麻豆");

    const sourceNames = playFromRaw ? playFromRaw.split("$$$") : ["麻豆"];
    const sourceUrls = playUrlRaw ? playUrlRaw.split("$$$") : [];
    const vod_play_sources = [];

    for (let i = 0; i < Math.max(sourceNames.length, sourceUrls.length); i++) {
      const sourceName = text(sourceNames[i] || `线路${i + 1}`);
      const rawEpisodes = text(sourceUrls[i] || "");
      if (!rawEpisodes) continue;
      const episodes = rawEpisodes.split("#").map((ep, idx) => {
        const pos = ep.indexOf("$");
        if (pos === -1) return { name: `播放${idx + 1}`, playId: ep };
        return {
          name: text(ep.slice(0, pos)) || `播放${idx + 1}`,
          playId: text(ep.slice(pos + 1))
        };
      }).filter((it) => it.playId);
      if (episodes.length) vod_play_sources.push({ name: sourceName, episodes });
    }

    return {
      list: [{
        vod_id: text(item?.vod_id || videoId),
        vod_name: text(item?.vod_name || item?.title || item?.name || ""),
        vod_pic: text(item?.vod_pic || item?.pic || item?.cover || ""),
        vod_remarks: text(item?.vod_remarks || item?.remarks || ""),
        vod_year: text(item?.vod_year || ""),
        vod_area: text(item?.vod_area || ""),
        vod_actor: text(item?.vod_actor || ""),
        vod_director: text(item?.vod_director || ""),
        vod_content: text(item?.vod_content || item?.content || item?.vod_blurb || ""),
        vod_play_sources
      }]
    };
  } catch (e) {
    logError(`detail 失败 ${videoId}`, e);
    return { list: [] };
  }
}

async function play(params, context) {
  const playId = text(params?.playId || "");
  const flag = text(params?.flag || "麻豆");
  logInfo("play", { flag, hasPlayId: !!playId });
  if (!playId) return { urls: [], flag, parse: 0, header: {} };

  return {
    urls: [{ name: "播放", url: playId }],
    flag,
    parse: 0,
    header: { "User-Agent": UA }
  };
}

async function search(params, context) {
  const wd = text(params?.keyword || params?.wd || "");
  const page = Number(params?.page || 1);
  logInfo("search", { wd, page });
  if (!wd) return { page, pagecount: 0, total: 0, list: [] };

  try {
    const base = ensureHomeUrl();
    const data = await apiGet(`${base}/api.php/provide/searchResult?ac=detail&wd=${encodeURIComponent(wd)}&pg=${page}`);
    const list = pickArray(data).map(mapVod).filter((it) => it.vod_id);
    const total = Number(data?.total || data?.data?.total || list.length || 0);
    const pagecount = Number(data?.pagecount || data?.data?.pagecount || (list.length ? page : 0));
    return { page, pagecount, total, list };
  } catch (e) {
    logError(`search 失败 ${wd}`, e);
    return { page, pagecount: 0, total: 0, list: [] };
  }
}

module.exports = { home, category, detail, play, search };
runner.run(module.exports);
