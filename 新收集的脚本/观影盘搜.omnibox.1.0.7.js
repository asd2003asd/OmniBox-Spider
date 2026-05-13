// @name 观影盘搜·OmniBox
// @author 梦
// @description 盘搜观影转 OmniBox 版：热搜榜 + 关键词搜索 + 网盘分组 + 快速详情线路 + 播放时解析
// @version 1.0.7
// @indexs 1
// @push 0
// @dependencies axios, tough-cookie, axios-cookiejar-support
// @downloadURL https://example.invalid/观影盘搜.omnibox.js

const axios = require("axios");
const crypto = require("crypto");
const { CookieJar } = require("tough-cookie");
const { wrapper: axiosCookieJarSupport } = require("axios-cookiejar-support");
const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");

function text(v) {
  return String(v == null ? "" : v).trim();
}

function safeJson(input, fallback = {}) {
  if (input == null) return fallback;
  if (typeof input === "object") return input;
  try {
    return JSON.parse(input);
  } catch {
    return fallback;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logInfo(message, data) {
  const suffix = data == null ? "" : ` ${JSON.stringify(data)}`;
  OmniBox.log("info", `[观影盘搜] ${message}${suffix}`);
}

function logError(message, error) {
  OmniBox.log("error", `[观影盘搜] ${message}: ${error?.message || error}`);
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const USE_TMDB_IMAGE = text(process.env.USE_TMDB_IMAGE || "0") === "1";
const TMDB_API_KEY = text(process.env.TMDB_API_KEY || "");
const LINK_CHECK_URL = text(process.env.PANCHECK_API || process.env.LINK_CHECK_URL || "");
const MAX_LINES_PER_PAN = Number(process.env.MAX_LINES_PER_PAN || 2);
const MAX_RESOURCES_TO_PARSE = Number(process.env.MAX_RESOURCES_TO_PARSE || 2);
const ACCOUNT_HEALTH_CHECK_INTERVAL = 10 * 60 * 1000;

const HOT_CHANNELS = [
  { id: "hot_电视剧", name: "热搜榜·电视剧", channel: "电视剧" },
  { id: "hot_电影", name: "热搜榜·电影", channel: "电影" },
  { id: "hot_短剧", name: "热搜榜·短剧", channel: "短剧" },
  { id: "hot_动漫", name: "热搜榜·动漫", channel: "动漫" },
  { id: "hot_综艺", name: "热搜榜·综艺", channel: "综艺" }
];

const PAN_ORDER = ["baidu", "a189", "quark", "uc", "xunlei", "a139", "a123", "a115", "pikpak", "ali"];
const panNames = {
  ali: "阿里网盘",
  quark: "夸克网盘",
  uc: "UC网盘",
  xunlei: "迅雷网盘",
  a123: "123网盘",
  a189: "天翼网盘",
  a139: "139网盘",
  a115: "115网盘",
  baidu: "百度网盘",
  pikpak: "PikPak"
};
const panPic = {
  ali: "https://gh-proxy.org/https://github.com/power721/alist-tvbox/raw/refs/heads/master/web-ui/public/ali.jpg",
  quark: "https://gh-proxy.org/https://github.com/power721/alist-tvbox/raw/refs/heads/master/web-ui/public/quark.png",
  uc: "https://gh-proxy.org/https://github.com/power721/alist-tvbox/raw/refs/heads/master/web-ui/public/uc.png",
  xunlei: "https://gh-proxy.org/https://github.com/power721/alist-tvbox/raw/refs/heads/master/web-ui/public/thunder.png",
  a123: "https://gh-proxy.org/https://github.com/power721/alist-tvbox/raw/refs/heads/master/web-ui/public/123.png",
  a189: "https://gh-proxy.org/https://github.com/power721/alist-tvbox/raw/refs/heads/master/web-ui/public/189.png",
  a139: "https://gh-proxy.org/https://github.com/power721/alist-tvbox/raw/refs/heads/master/web-ui/public/139.jpg",
  a115: "https://gh-proxy.org/https://github.com/power721/alist-tvbox/raw/refs/heads/master/web-ui/public/115.jpg",
  baidu: "https://gh-proxy.org/https://github.com/power721/alist-tvbox/raw/refs/heads/master/web-ui/public/baidu.jpg",
  pikpak: "https://gh-proxy.org/https://github.com/power721/alist-tvbox/raw/refs/heads/master/web-ui/public/pikpak.jpg"
};

const DATA_SOURCES = {
  tmdbImage: "https://image.tmdb.org/t/p/w500",
  tmdbApi: "https://api.tmdb.org/3"
};

const CACHE_TTL = {
  gyApi: 5 * 60 * 1000,
  hot: 5 * 60 * 1000,
  tmdb: 24 * 60 * 60 * 1000,
  image: 30 * 60 * 1000
};

const hotCache = new Map();
const gyApiCache = new Map();
const tmdbCache = new Map();
const tmdbImageCache = new Map();

function generateHash(username) {
  const salt = "pansou_gying_secret_2025";
  return crypto.createHash("sha256").update(String(username || "") + salt).digest("hex");
}

function getAccountsConfig() {
  const envJson = text(process.env.GYING_ACCOUNTS || process.env.GY_ACCOUNTS || "");
  if (!envJson) return [];
  const parsed = safeJson(envJson, []);
  return Array.isArray(parsed) ? parsed : [];
}

class GyingClient {
  constructor(baseUrl, username, password) {
    this.baseUrl = String(baseUrl || "").replace(/\/$/, "");
    this.username = username;
    this.password = password;
    this.jar = new CookieJar();
    this.client = axiosCookieJarSupport(axios.create({
      jar: this.jar,
      withCredentials: true,
      headers: { "User-Agent": UA },
      timeout: 15000,
      validateStatus: () => true
    }));
    this.loggedIn = false;
  }

  _ensureString(data) {
    if (typeof data === "string") return data;
    if (Buffer.isBuffer(data)) return data.toString("utf8");
    if (typeof data === "object") return JSON.stringify(data);
    return String(data || "");
  }

  _isBotChallengePage(body) {
    const str = this._ensureString(body);
    return str.includes("正在确认你是不是机器人") && /const json=/.test(str);
  }

  async _solveBotChallenge(body, referer) {
    const str = this._ensureString(body);
    const matches = str.match(/const json=(\{.*?\});const jss=/);
    if (!matches) throw new Error("未找到挑战数据");
    const challenge = JSON.parse(matches[1]);
    const { id, challenge: targets, diff, salt } = challenge;
    const remaining = new Map();
    (targets || []).forEach((target, idx) => remaining.set(String(target).toLowerCase(), idx));
    const nonces = new Array((targets || []).length).fill(0);
    for (let nonce = 0; nonce <= diff && remaining.size > 0; nonce++) {
      const hash = crypto.createHash("sha256").update(String(nonce) + salt).digest("hex");
      if (remaining.has(hash)) {
        const idx = remaining.get(hash);
        nonces[idx] = nonce;
        remaining.delete(hash);
      }
    }
    if (remaining.size > 0) throw new Error("无法完成验证");

    const form = new URLSearchParams();
    form.append("action", "verify");
    form.append("id", id);
    nonces.forEach((n) => form.append("nonce[]", n));

    const resp = await this.client.post(referer, form.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });
    const verifyResp = safeJson(resp.data, {});
    if (!verifyResp.success) throw new Error(`验证失败: ${verifyResp.msg || ""}`);
  }

  async login() {
    const loginPageUrl = `${this.baseUrl}/user/login/`;
    const res1 = await this.client.get(loginPageUrl);
    const body1 = this._ensureString(res1.data);
    if (this._isBotChallengePage(body1)) {
      await this._solveBotChallenge(body1, loginPageUrl);
    }

    const loginApi = `${this.baseUrl}/user/login`;
    const formData = `code=&siteid=1&dosubmit=1&cookietime=10506240&username=${encodeURIComponent(this.username)}&password=${encodeURIComponent(this.password)}`;
    const res2 = await this.client.post(loginApi, formData, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });
    const loginJson = safeJson(res2.data, {});
    if (loginJson.code !== 200) throw new Error(`登录失败: ${loginJson.msg || "未知错误"}`);

    await this.client.get(`${this.baseUrl}/mv/wkMn`);
    this.loggedIn = true;
    return true;
  }

  async _fetchDetail(id, type) {
    const detailUrl = `${this.baseUrl}/res/downurl/${type}/${id}`;
    const resp = await this.client.get(detailUrl);
    const detail = safeJson(resp.data, {});
    if (detail.code === 403) throw new Error(`详情返回403: ${id}`);
    return detail;
  }

  _buildResult(detail, searchData, index) {
    const l = searchData.l || {};
    const title = text((l.title || [])[index] || "");
    const links = [];

    const panlist = detail?.panlist;
    if (panlist && Array.isArray(panlist.url)) {
      for (let i = 0; i < panlist.url.length; i++) {
        let linkURL = text(panlist.url[i]);
        if (!linkURL) continue;
        const typeName = text(panlist.tname?.[i] || "");
        let password = text(panlist.p?.[i] || "");
        const fileName = text(panlist.name?.[i] || title || `网盘资源${i + 1}`);
        linkURL = linkURL.replace(/（访问码：.*?）/g, "").replace(/\(访问码：.*?\)/g, "").trim();
        if (!password) {
          const pwdMatch = linkURL.match(/[?&]pwd=([a-zA-Z0-9]+)/);
          if (pwdMatch) password = pwdMatch[1];
        }

        let panType = "others";
        if (linkURL.includes("pan.quark.cn")) panType = "quark";
        else if (linkURL.includes("drive.uc.cn")) panType = "uc";
        else if (linkURL.includes("pan.baidu.com")) panType = "baidu";
        else if (linkURL.includes("aliyundrive.com") || linkURL.includes("alipan.com")) panType = "ali";
        else if (linkURL.includes("pan.xunlei.com")) panType = "xunlei";
        else if (linkURL.includes("cloud.189.cn")) panType = "a189";
        else if (linkURL.includes("caiyun.139.com")) panType = "a139";
        else if (linkURL.includes("123pan")) panType = "a123";
        else if (linkURL.includes("115.com")) panType = "a115";
        else if (linkURL.toLowerCase().includes("pikpak")) panType = "pikpak";
        else panType = typeName || "others";

        links.push({ type: panType, url: linkURL, password, name: fileName, time: panlist.time?.[i] || "" });
      }
    }

    return { title, links };
  }

  async search(keyword) {
    try {
      const searchUrl = `${this.baseUrl}/s/1---1/${encodeURIComponent(keyword)}`;
      let resp = await this.client.get(searchUrl);
      let body = this._ensureString(resp.data);
      if (this._isBotChallengePage(body)) {
        await this._solveBotChallenge(body, searchUrl);
        resp = await this.client.get(searchUrl);
        body = this._ensureString(resp.data);
      }
      const match = body.match(/_obj\.search=(\{.*?\});/);
      if (!match) return [];
      const searchData = JSON.parse(match[1]);
      if (!searchData?.l || !Array.isArray(searchData.l.i)) return [];

      const ids = searchData.l.i;
      const types = searchData.l.d || [];
      const titles = searchData.l.title || [];
      const keywordLower = String(keyword || "").toLowerCase();
      const validItems = [];
      for (let i = 0; i < ids.length; i++) {
        const title = String(titles[i] || "");
        if (title.toLowerCase().includes(keywordLower)) {
          validItems.push({ id: ids[i], type: types[i], title, index: i });
        }
      }

      const results = [];
      for (let i = 0; i < validItems.length; i += 6) {
        const batch = validItems.slice(i, i + 6);
        const batchResults = await Promise.all(batch.map(async (item) => {
          try {
            const detail = await this._fetchDetail(item.id, item.type);
            const result = this._buildResult(detail, searchData, item.index);
            if (result.title && result.links.length) return result;
          } catch (e) {
            logError(`获取详情失败 ${item.id}`, e);
          }
          return null;
        }));
        results.push(...batchResults.filter(Boolean));
      }
      return results;
    } catch (e) {
      logError(`账号 ${this.username} 搜索失败`, e);
      return [];
    }
  }
}

let accounts = [];
let currentAccountIndex = 0;
let healthStarted = false;
let accountsInitPromise = null;

async function initAccount(account) {
  const client = new GyingClient(account.baseUrl, account.username, account.password);
  await client.login();
  account.client = client;
  account.logged_in = true;
  account.hash = generateHash(account.username);
  account.last_login = Date.now();
  return true;
}

async function ensureAccounts() {
  if (accounts.filter((a) => a.logged_in).length > 0) return;
  if (accountsInitPromise) return accountsInitPromise;

  const configs = getAccountsConfig();
  if (!configs.length) {
    logInfo("未配置 GYING_ACCOUNTS / GY_ACCOUNTS，搜索功能不可用");
    return;
  }

  accountsInitPromise = (async () => {
    accounts = [];
    for (const cfg of configs) {
      const account = { ...cfg, logged_in: false, hash: generateHash(cfg.username) };
      try {
        await initAccount(account);
        accounts.push(account);
        logInfo("账号初始化成功", { username: account.username, hash: account.hash });
      } catch (e) {
        logError(`账号初始化失败 ${cfg.username}`, e);
        accounts.push(account);
      }
      await sleep(150);
    }

    if (!healthStarted) {
      healthStarted = true;
      setInterval(async () => {
        for (const acc of accounts) {
          if (!acc.baseUrl || !acc.username || !acc.password) continue;
          if (acc.logged_in && Date.now() - Number(acc.last_check || 0) < ACCOUNT_HEALTH_CHECK_INTERVAL) continue;
          try {
            if (!acc.client) acc.client = new GyingClient(acc.baseUrl, acc.username, acc.password);
            await acc.client.client.get(acc.client.baseUrl + "/");
            acc.logged_in = true;
            acc.last_check = Date.now();
          } catch {
            try {
              await initAccount(acc);
              acc.last_check = Date.now();
            } catch (e) {
              acc.logged_in = false;
              logError(`账号健康检查失败 ${acc.username}`, e);
            }
          }
        }
      }, ACCOUNT_HEALTH_CHECK_INTERVAL);
    }
  })();

  await accountsInitPromise;
}

function selectAccount() {
  if (!accounts.length) return null;
  const startIdx = currentAccountIndex;
  for (let i = 0; i < accounts.length; i++) {
    const idx = (startIdx + i) % accounts.length;
    const account = accounts[idx];
    if (account.logged_in && account.client) {
      currentAccountIndex = (idx + 1) % accounts.length;
      return account;
    }
  }
  return null;
}

function getCachedGyApi(account, wd) {
  if (!account || !wd) return null;
  const cacheKey = `gy_api_${account.hash}_${wd}`;
  const cached = gyApiCache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL.gyApi) return cached.data;
  return null;
}

async function fetchHotRanking(channel, limit = 120) {
  const cacheKey = `hot_${channel}`;
  const cached = hotCache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL.hot) return cached.data;
  try {
    const url = `https://pan.dyuzi.com/api/frontend/ranking?channel=${encodeURIComponent(channel)}&limit=${limit}`;
    const response = await axios.get(url, { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 10000, validateStatus: () => true });
    const data = safeJson(response.data, {});
    const list = data?.data?.list || [];
    hotCache.set(cacheKey, { data: list, time: Date.now() });
    return list;
  } catch (e) {
    logError(`热搜榜获取失败 ${channel}`, e);
    return [];
  }
}

async function fetchTMDBImage(title) {
  if (!USE_TMDB_IMAGE || !TMDB_API_KEY || !title) return "";
  const cacheKey = `tmdb_img_${title}`;
  const cached = tmdbImageCache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL.image) return cached.url;
  try {
    let url = `${DATA_SOURCES.tmdbApi}/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=zh-CN&page=1`;
    let res = await axios.get(url, { timeout: 6000, validateStatus: () => true });
    let results = safeJson(res.data, {}).results;
    if (!results || !results.length) {
      url = `${DATA_SOURCES.tmdbApi}/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=zh-CN&page=1`;
      res = await axios.get(url, { timeout: 6000, validateStatus: () => true });
      results = safeJson(res.data, {}).results;
    }
    if (results && results.length && results[0].poster_path) {
      const imageUrl = `${DATA_SOURCES.tmdbImage}${results[0].poster_path}`;
      tmdbImageCache.set(cacheKey, { url: imageUrl, time: Date.now() });
      return imageUrl;
    }
  } catch (e) {
    logError(`TMDB 图片获取失败 ${title}`, e);
  }
  return "";
}

async function callGyApi(account, wd) {
  if (!account || !account.client || !account.logged_in) return null;
  const cacheKey = `gy_api_${account.hash}_${wd}`;
  const cached = gyApiCache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL.gyApi) return cached.data;

  const results = await account.client.search(wd);
  if (!Array.isArray(results) || !results.length) {
    gyApiCache.set(cacheKey, { data: null, time: Date.now() });
    return null;
  }

  const grouped = {};
  for (const res of results) {
    for (const link of res.links || []) {
      const panKey = text(link.type || "others");
      if (!grouped[panKey]) grouped[panKey] = [];
      grouped[panKey].push({
        url: text(link.url),
        password: text(link.password),
        type: panKey,
        name: text(link.name),
        quality: text(link.quality),
        time: text(link.time)
      });
    }
  }

  const apiData = { title: results[0].title || wd, grouped };
  gyApiCache.set(cacheKey, { data: apiData, time: Date.now() });
  return apiData;
}

function buildSharePlayId(shareURL, driveKey, fileId = "", fileName = "") {
  return Buffer.from(JSON.stringify({ shareURL, driveKey, fileId, fileName }), "utf8").toString("base64");
}

function isVideoFile(file) {
  const name = text(file?.file_name).toLowerCase();
  if (!name) return false;
  const exts = [".mp4", ".mkv", ".avi", ".flv", ".mov", ".wmv", ".m3u8", ".ts", ".webm", ".m4v"];
  if (exts.some((ext) => name.endsWith(ext))) return true;
  const formatType = text(file?.format_type).toLowerCase();
  return formatType.includes("video") || formatType.includes("mpeg") || formatType.includes("h264");
}

async function collectVideoFiles(shareURL, folderId = "0", depth = 0, maxDepth = 2) {
  if (depth > maxDepth) return [];
  const fileList = await OmniBox.getDriveFileList(shareURL, folderId);
  const files = Array.isArray(fileList?.files) ? fileList.files : [];
  const videos = [];
  for (const file of files) {
    if (isVideoFile(file)) {
      videos.push(file);
      continue;
    }
    const isDir = file?.is_dir === true || file?.type === "folder" || file?.vod_tag === "folder";
    if (isDir && file?.fid) {
      const sub = await collectVideoFiles(shareURL, String(file.fid), depth + 1, maxDepth);
      videos.push(...sub);
    }
  }
  return videos;
}

async function getFirstPlayableFileId(shareURL) {
  const files = await collectVideoFiles(shareURL, "0", 0, 2);
  const first = (files || [])[0];
  return text(first?.fid || first?.file_id || "");
}

function buildLightEpisodesFromLinks(items, panKey) {
  return (items || []).map((item, idx) => {
    const pwd = text(item?.password || "");
    const suffix = pwd ? ` 提取码:${pwd}` : "";
    return {
      name: `${panNames[panKey] || panKey}${idx + 1}${suffix}`,
      playId: buildSharePlayId(item.url, panKey)
    };
  }).filter((it) => it.playId);
}

async function home(params, context) {
  logInfo("home", { from: context?.from || "unknown" });
  const classes = HOT_CHANNELS.map((item) => ({ type_id: item.id, type_name: item.name }));
  let list = [];
  try {
    const hot = await fetchHotRanking("电视剧", 12);
    list = hot.slice(0, 12).map((item) => ({
      vod_id: `hot_电视剧_${encodeURIComponent(item.title)}_${item.year || ""}`,
      vod_name: item.title,
      vod_pic: item.src || "",
      vod_remarks: `🔥${item.hot_score || ""}`
    }));
  } catch (e) {
    logError("home 热搜加载失败", e);
  }
  return { class: classes, list, filters: {} };
}

async function category(params, context) {
  const id = text(params?.categoryId || params?.id || "");
  const page = Number(params?.page || 1);
  const hot = HOT_CHANNELS.find((item) => item.id === id);
  if (!hot) return { page, pagecount: 0, total: 0, list: [] };

  try {
    const allItems = await fetchHotRanking(hot.channel, 120);
    const pageSize = 20;
    const start = (page - 1) * pageSize;
    const pageItems = allItems.slice(start, start + pageSize);
    const list = pageItems.map((item) => ({
      vod_id: `hot_${hot.channel}_${encodeURIComponent(item.title)}_${item.year || ""}`,
      vod_name: item.title,
      vod_pic: item.src || "",
      vod_remarks: `🔥${item.hot_score || ""} | ${item.episode_count || "单集"}`,
      vod_year: item.year || ""
    }));
    return { page, pagecount: Math.ceil(allItems.length / pageSize) || 1, total: allItems.length, list };
  } catch (e) {
    logError(`category 失败 ${id}`, e);
    return { page, pagecount: 0, total: 0, list: [] };
  }
}

async function search(params, context) {
  const wd = text(params?.keyword || params?.wd || "");
  const page = Number(params?.page || 1);
  logInfo("search", { wd, page });
  if (!wd) return { page, pagecount: 0, total: 0, list: [] };

  await ensureAccounts();
  const account = selectAccount();
  if (!account) return { page, pagecount: 0, total: 0, list: [] };

  try {
    const apiData = await callGyApi(account, wd);
    if (!apiData) return { page, pagecount: 0, total: 0, list: [] };
    const tmdbPoster = await fetchTMDBImage(wd);

    const list = [];
    for (const panKey of PAN_ORDER) {
      const items = apiData.grouped[panKey] || [];
      if (!items.length) continue;
      list.push({
        vod_id: `drive_${account.hash}_${panKey}_${encodeURIComponent(wd)}`,
        vod_name: `${panNames[panKey] || panKey}【${wd}】`,
        vod_pic: tmdbPoster || panPic[panKey] || "",
        vod_remarks: `${items.length}个资源`
      });
    }
    return { page, pagecount: 1, total: list.length, list };
  } catch (e) {
    logError(`search 失败 ${wd}`, e);
    return { page, pagecount: 0, total: 0, list: [] };
  }
}

function buildFastDetailByApiData(keyword, apiData, opts = {}) {
  const requestedPanKey = text(opts.panKey || "");
  const playSources = [];
  const panKeys = requestedPanKey ? [requestedPanKey] : PAN_ORDER;

  for (const panKey of panKeys) {
    const items = ((apiData?.grouped || {})[panKey] || []).slice(0, MAX_RESOURCES_TO_PARSE);
    if (!items.length) continue;
    const episodes = buildLightEpisodesFromLinks(items, panKey);
    if (episodes.length) {
      playSources.push({ name: panNames[panKey] || panKey, episodes });
    }
    if (!requestedPanKey && playSources.length >= MAX_LINES_PER_PAN) break;
  }

  return {
    vod_id: `kw_${encodeURIComponent(keyword)}`,
    vod_name: keyword,
    vod_pic: requestedPanKey ? (panPic[requestedPanKey] || "") : "",
    vod_remarks: playSources.length ? `${playSources.length}个线路` : "暂无线路",
    vod_content: `《${keyword}》`,
    vod_play_sources: playSources
  };
}

async function buildDetailByKeyword(keyword, account, opts = {}) {
  const fetchIfMissing = !!opts.fetchIfMissing;
  let apiData = getCachedGyApi(account, keyword);
  if (!apiData && fetchIfMissing && account) {
    apiData = await callGyApi(account, keyword);
  }
  if (!apiData) {
    return buildFastDetailByApiData(keyword, { grouped: {} }, opts);
  }
  return buildFastDetailByApiData(keyword, apiData, opts);
}

async function detail(params, context) {
  const videoId = text(params?.videoId || "");
  logInfo("detail", { videoId });
  if (!videoId) return { list: [] };

  try {
    if (videoId.startsWith("drive_")) {
      await ensureAccounts();
      const parts = videoId.split("_");
      if (parts.length >= 4) {
        const accountHash = parts[1];
        const panKey = parts[2];
        const wd = decodeURIComponent(parts.slice(3).join("_"));
        const account = accounts.find((a) => a.hash === accountHash && a.logged_in);
        if (!account) return { list: [] };
        const vod = await buildDetailByKeyword(wd, account, { panKey, fetchIfMissing: false });
        vod.vod_id = videoId;
        if (!vod.vod_pic) vod.vod_pic = panPic[panKey] || "";
        return { list: [vod] };
      }
    }

    if (videoId.startsWith("hot_")) {
      await ensureAccounts();
      const match = videoId.match(/^hot_[^_]+_(.+?)(?:_(\d{4}))?$/);
      const keyword = match ? decodeURIComponent(match[1]) : videoId;
      const account = selectAccount();
      if (!account) return { list: [] };
      const vod = await buildDetailByKeyword(keyword, account, { fetchIfMissing: true });
      vod.vod_id = videoId;
      return { list: [vod] };
    }

    if (videoId.startsWith("kw_")) {
      await ensureAccounts();
      const keyword = decodeURIComponent(videoId.slice(3));
      const account = selectAccount();
      if (!account) return { list: [] };
      const vod = await buildDetailByKeyword(keyword, account, { fetchIfMissing: true });
      vod.vod_id = videoId;
      return { list: [vod] };
    }

    return { list: [] };
  } catch (e) {
    logError(`detail 失败 ${videoId}`, e);
    return { list: [] };
  }
}

async function play(params, context) {
  const rawPlayId = text(params?.playId || "");
  const flag = text(params?.flag || "");
  logInfo("play", { flag, hasPlayId: !!rawPlayId });
  if (!rawPlayId) return { urls: [], flag, parse: 0, header: {} };

  try {
    const payload = safeJson(Buffer.from(rawPlayId, "base64").toString("utf8"), {});
    const shareURL = text(payload.shareURL);
    let fileId = text(payload.fileId);
    const routeType = text(payload.driveKey || flag || "");
    if (!shareURL) throw new Error("playId 数据不完整");

    if (!fileId) {
      fileId = await getFirstPlayableFileId(shareURL);
      if (!fileId) throw new Error("未找到可播放视频文件");
    }

    const info = await OmniBox.getDriveVideoPlayInfo(shareURL, fileId, routeType);
    if (!info) throw new Error("未获取到播放信息");

    if (Array.isArray(info.urls) && info.urls.length) {
      return {
        urls: info.urls,
        flag,
        parse: Number(info.parse || 0),
        header: info.header || {}
      };
    }

    const directUrl = text(info.url || info.playUrl || "");
    if (directUrl) {
      return {
        urls: [{ name: text(payload.fileName || "播放"), url: directUrl }],
        flag,
        parse: Number(info.parse || 0),
        header: info.header || {}
      };
    }

    throw new Error("播放信息为空");
  } catch (e) {
    logError("play 失败", e);
    return { urls: [], flag, parse: 0, header: {} };
  }
}

module.exports = { home, category, search, detail, play };
runner.run(module.exports);
