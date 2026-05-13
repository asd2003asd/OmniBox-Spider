// @name TingYou.fm
// @author mumu
// @version 0.3.12
// @downloadURL https://example.com/tingyou.fm.js
// @dependencies axios,cheerio

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");
const axios = require("axios");
const cheerio = require("cheerio");
const { webcrypto } = require("crypto");

const SITE = "https://tingyou.fm";
const PAYLOAD_KEY_HEX = "ea9d9d4f9a983fe6f6382f29c7b46b8d6dc47abc6da36662e6ddff8c78902f65";
const PAYLOAD_VERSION = 1;

const CATEGORY_MAP = [
  { type_id: "46", type_name: "有声小说" },
  { type_id: "11", type_name: "武侠小说" },
  { type_id: "19", type_name: "言情通俗" },
  { type_id: "21", type_name: "相声小品" },
  { type_id: "14", type_name: "恐怖惊悚" },
  { type_id: "17", type_name: "官场商战" },
  { type_id: "15", type_name: "历史军事" },
  { type_id: "9", type_name: "百家讲坛" }
];

function log(level, msg) {
  try { OmniBox.log(level, `[TingYou] ${msg}`); } catch {}
}

function getAuthToken() {
  return process.env.TINGYOU_AUTH || "";
}

function getCookie() {
  return process.env.TINGYOU_COOKIE || "";
}

function getHeaders(extra = {}) {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    "Referer": SITE + "/",
    "Origin": SITE,
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
  };
  const auth = getAuthToken();
  const cookie = getCookie();
  if (auth) headers.Authorization = auth;
  if (cookie) headers.Cookie = cookie;
  return { ...headers, ...extra };
}

/* Utilities */
function normalizeUrl(url) {
  if (url === undefined || url === null) return "";
  if (typeof url === "object") {
    const candidates = [url.url, url.src, url.path, url.href, url.cover_url, url.cover];
    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) {
        url = c;
        break;
      }
    }
    if (typeof url !== "string") return "";
  }
  url = String(url || "").trim();
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return SITE + url;
  return url;
}

function safeText($el) {
  if (!$el || !$el.text) return "";
  return $el.text().replace(/\s+/g, " ").trim();
}

function uniqBy(arr, keyFn) {
  const map = new Map();
  for (const item of arr || []) {
    const key = keyFn(item);
    if (!key) continue;
    if (!map.has(key)) map.set(key, item);
  }
  return Array.from(map.values());
}

/* Crypto helpers */
function hexToBytes(hex) {
  const clean = String(hex || "").trim();
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function bytesToHex(bytes) {
  return Array.from(bytes || []).map(b => b.toString(16).padStart(2, "0")).join("");
}

/* Image helpers */
function pickImage($img) {
  if (!$img || !$img.attr) return "";
  let pic =
    $img.attr("src") ||
    $img.attr("data-src") ||
    $img.attr("data-lazy-src") ||
    $img.attr("data-original") ||
    $img.attr("data-url") ||
    $img.attr("srcset") ||
    "";

  if ((!pic || String(pic).startsWith("data:image")) && $img.attr("srcset")) {
    const ss = String($img.attr("srcset") || "");
    const first = ss.split(",")[0] || "";
    pic = first.trim().split(" ")[0] || pic;
  }

  if (typeof pic !== "string") {
    if (typeof pic === "object" && pic) {
      pic = pic.url || pic.src || pic.path || "";
    } else {
      pic = String(pic || "");
    }
  }

  pic = normalizeUrl(pic);
  if (pic.startsWith("data:image")) return "";
  return pic;
}

/* Payload encryption */
async function encryptPayload(plainText) {
  const keyBytes = hexToBytes(PAYLOAD_KEY_HEX);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const key = await webcrypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const cipherBuf = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plainText));
  const cipher = new Uint8Array(cipherBuf);
  const out = new Uint8Array(1 + iv.length + cipher.length);
  out[0] = 1;
  out.set(iv, 1);
  out.set(cipher, 1 + iv.length);
  return bytesToHex(out);
}

async function decryptPayloadHex(hex) {
  const raw = hexToBytes(hex);
  if (!raw || raw.length < 29) throw new Error("payload too short");
  const version = raw[0];
  const iv = raw.slice(1, 13);
  let cipher = raw.slice(13);
  if (version === 2) cipher = Uint8Array.from(Array.from(cipher).reverse());
  const keyBytes = hexToBytes(PAYLOAD_KEY_HEX);
  const key = await webcrypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
  const plainBuf = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  return new TextDecoder().decode(plainBuf);
}

/* API wrappers */
async function apiRequest(method, path, body) {
  const url = path.startsWith("http") ? path : `${SITE}${path.startsWith("/") ? path : "/" + path}`;
  const headers = getHeaders({ "X-Payload-Version": String(PAYLOAD_VERSION) });
  const config = { method, url, headers, timeout: 20000, validateStatus: () => true };

  if (body !== undefined && body !== null) {
    const plain = typeof body === "string" ? body : JSON.stringify(body);
    config.data = await encryptPayload(plain);
    config.headers["Content-Type"] = "text/plain";
  }

  const resp = await axios(config);
  let data = resp.data;

  if (data && typeof data === "object" && typeof data.payload === "string") {
    const plain = await decryptPayloadHex(data.payload);
    try { data = JSON.parse(plain); } catch { data = plain; }
  }

  if (resp.status >= 400) {
    throw new Error(`HTTP ${resp.status}: ${typeof data === "string" ? data : JSON.stringify(data).slice(0, 500)}`);
  }
  return data;
}

async function apiGet(nameOrPath, params) {
  let path = String(nameOrPath || "");
  if (!path.startsWith("/")) path = `/api/${path.replace(/^\//, "")}`;
  if (params && typeof params === "object") {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) qs.append(k, String(v));
    });
    const s = qs.toString();
    if (s) path += (path.includes("?") ? "&" : "?") + s;
  }
  return apiRequest("GET", path);
}

async function apiPost(nameOrPath, body) {
  let path = String(nameOrPath || "");
  if (!path.startsWith("/")) path = `/api/${path.replace(/^\//, "")}`;
  return apiRequest("POST", path, body);
}

/* Dereference helpers for nuxtData numeric pointers */
function derefValue(val, nuxtData) {
  if (val === undefined || val === null) return val;
  if (typeof val === "number") {
    const v = nuxtData[val];
    if (v === undefined || v === null) return val;
    if (typeof v === "object") return derefObject(v, nuxtData);
    return v;
  }
  if (Array.isArray(val)) return val.map(v => derefValue(v, nuxtData));
  if (typeof val === "object") return derefObject(val, nuxtData);
  return val;
}

function derefObject(obj, nuxtData) {
  if (!obj || typeof obj !== "object") return obj;
  const out = {};
  for (const k of Object.keys(obj)) {
    try {
      out[k] = derefValue(obj[k], nuxtData);
    } catch {
      out[k] = obj[k];
    }
  }
  return out;
}

/* Strong meta filtering and album detection */
function isArrayFrameworkMarker(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return false;
  if (typeof arr[0] === "string") {
    const marker = arr[0].toLowerCase();
    const metaMarkers = new Set(["shallowreactive", "teleports", "nuxt", "ssr", "shallow"]);
    if (metaMarkers.has(marker)) return true;
  }
  if (arr.length === 2 && typeof arr[0] === "string" && typeof arr[1] === "number") return true;
  if (arr.every(v => typeof v === "number")) return true;
  return false;
}

function isMappingObjectOfPointers(obj) {
  if (!obj || typeof obj !== "object") return false;
  const keys = Object.keys(obj);
  if (keys.length === 0) return false;
  const allValuesNumbers = keys.every(k => typeof obj[k] === "number");
  if (allValuesNumbers && keys.length <= 6) return true;
  const mappingKeys = new Set(["id","name","types","key","page","pages","detail","sort","status"]);
  const numericCount = keys.filter(k => typeof obj[k] === "number").length;
  const mappingKeyCount = keys.filter(k => mappingKeys.has(k)).length;
  if (numericCount >= 1 && mappingKeyCount >= 1 && keys.length <= 6) return true;
  return false;
}

function isMetaObject(obj) {
  if (!obj) return false;
  if (Array.isArray(obj)) return isArrayFrameworkMarker(obj);
  if (typeof obj !== "object") return false;

  const metaKeys = new Set([
    "serverRendered","pinia","state","data","once","_errors","path","filters","sorts",
    "categories","statuses","teleports","version","badge","description","is_primary","key",
    "android_intl","sort","types","page","pages","detail"
  ]);

  for (const k of Object.keys(obj)) {
    if (metaKeys.has(k)) return true;
  }

  if (isMappingObjectOfPointers(obj)) return true;

  let numericArrayFields = 0;
  let numericValueFields = 0;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === "number") numericArrayFields++;
    if (typeof v === "number") numericValueFields++;
  }
  if (numericArrayFields >= 1 && Object.keys(obj).length <= 8) return true;
  if (numericValueFields >= 2 && Object.keys(obj).length <= 6) return true;

  return false;
}

function isAlbumCandidate(obj, nuxtData) {
  if (!obj) return false;
  if (typeof obj === "number" && Array.isArray(nuxtData)) {
    const deref = derefValue(obj, nuxtData);
    return isAlbumCandidate(deref, nuxtData);
  }
  if (typeof obj !== "object") return false;
  if (isMetaObject(obj)) return false;

  const maybe = derefObject(obj, nuxtData);
  const id = maybe.id || maybe.album_id;
  const hasTitle = !!(maybe.title || maybe.name);
  const hasCover = !!(maybe.cover_url || maybe.cover || maybe.image);
  if (!id && !hasTitle && !hasCover) return false;

  const keys = Object.keys(maybe);
  if (keys.length <= 2 && (maybe.key || maybe.name) && !hasCover && !hasTitle && !id) return false;

  return true;
}

function pushIfAlbum(obj, nuxtData, outArr) {
  try {
    if (!obj) return;
    if (isAlbumCandidate(obj, nuxtData)) {
      const real = (typeof obj === "number" && Array.isArray(nuxtData)) ? derefValue(obj, nuxtData) : derefObject(obj, nuxtData);
      if (real && typeof real === "object") outArr.push(real);
    }
  } catch (e) {
    // ignore
  }
}

/* DOM album parser */
function parseAlbumCard($, el, fallbackTypeId = "", fallbackTypeName = "") {
  const $el = $(el);
  const href = $el.attr("href") || "";
  const match = href.match(/\/albums\/(\d+)/);
  if (!match) return null;

  const vod_id = match[1];
  const $img = $el.find("img.cover").first().length ? $el.find("img.cover").first() : $el.find("img").first();

  const vod_name =
    ($img && $img.attr && $img.attr("alt")) ||
    safeText($el.find(".title").first()) ||
    safeText($el.find(".name").first()) ||
    safeText($el).split("作者：")[0].trim() ||
    `专辑${vod_id}`;

  const text = safeText($el);
  let author = "";
  const authorPatterns = [
    /作者[:：]\s*([^\s·,，]+)/i,
    /作\s*者[:：]?\s*([^\s·,，]+)/i,
    /主讲[:：]\s*([^\s·,，]+)/i,
    /播讲[:：]\s*([^\s·,，]+)/i,
    /朗读[:：]\s*([^\s·,，]+)/i
  ];
  for (const p of authorPatterns) {
    const m = text.match(p);
    if (m && m[1]) { author = m[1].trim(); break; }
  }

  const periods = /(\d+)\s*期/.exec(text)?.[1] || /共\s*(\d+)\s*集/.exec(text)?.[1] || "";
  const status = /连载中|已完结/.exec(text)?.[0] || "";
  const remarksParts = [];
  if (author) remarksParts.push(`作者:${author}`);
  if (periods) remarksParts.push(`${periods}期`);
  if (status) remarksParts.push(status);
  const vod_remarks = remarksParts.join(" · ");
  const vod_pic = pickImage($img);

  return {
    vod_id,
    vod_name,
    vod_pic,
    vod_remarks,
    type_id: String(fallbackTypeId || ""),
    type_name: fallbackTypeName || ""
  };
}

/* safe cover extraction */
function safeCoverFromItem(item, nuxtData) {
  if (!item) return "";
  if (typeof item === "number" && Array.isArray(nuxtData)) {
    item = derefValue(item, nuxtData);
  }
  if (item && typeof item === "object") item = derefObject(item, nuxtData);

  if (typeof item.cover_url === "string" && item.cover_url.trim()) return normalizeUrl(item.cover_url);
  if (typeof item.cover === "string" && item.cover.trim()) return normalizeUrl(item.cover);
  if (typeof item.image === "string" && item.image.trim()) return normalizeUrl(item.image);
  if (item.cover_url && typeof item.cover_url === "object") {
    const c = item.cover_url.url || item.cover_url.src || item.cover_url.path || "";
    if (typeof c === "string" && c.trim()) return normalizeUrl(c);
  }
  if (item.cover && typeof item.cover === "object") {
    const c = item.cover.url || item.cover.src || item.cover.path || "";
    if (typeof c === "string" && c.trim()) return normalizeUrl(c);
  }
  return "";
}

/* Resolve status text with custom mappings */
function resolveStatusText(st) {
  if (st === undefined || st === null) return "";
  if (typeof st === "number") {
    if (st === 0) return "已完结";
    if (st === 1) return "连载中";
    if (st === 99) return "连载中";
    if (st === 156) return "已完结";
    return "";
  }
  const s = String(st || "").trim();
  if (!s) return "";
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (n === 0) return "已完结";
    if (n === 1) return "连载中";
    if (n === 99) return "连载中";
    if (n === 156) return "已完结";
  }
  if (/完结|已完结/.test(s)) return "已完结";
  if (/连载|更新/.test(s)) return "连载中";
  return "";
}

/* home (完整实现：优先解析 __NUXT_DATA__ 并合并 DOM) */
async function home(params, context) {
  try {
    log("info", `home start`);
    const resp = await axios.get(SITE + "/", { headers: getHeaders(), timeout: 15000 });
    const html = typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data);
    const $ = cheerio.load(html);

    // 1. 解析页面分类（DOM 级别）
    const classList = [];
    const seenCat = new Set();
    $("a[href*='/categories/']").each((_, el) => {
      const href = $(el).attr("href") || "";
      const m = href.match(/\/categories\/(\d+)/);
      if (!m) return;
      const type_id = m[1];
      if (seenCat.has(type_id)) return;
      seenCat.add(type_id);
      const type_name = safeText($(el)) || `分类${type_id}`;
      if (!type_name || /全部分类/.test(type_name)) return;
      classList.push({ type_id, type_name });
    });

    // 2. 先从 DOM 抽取卡片（保守）
    const domList = [];
    $("a.list-item[href*='/albums/'], a[href*='/albums/']").slice(0, 40).each((_, el) => {
      const item = parseAlbumCard($, el, "46", "有声小说");
      if (item) domList.push(item);
    });

    // 3. 解析 __NUXT_DATA__（若存在），并构建 id -> albumObject 映射（deref）
    const scriptText = $("#__NUXT_DATA__").html();
    let nuxtData = null;
    const nuxtMap = new Map(); // id -> deref object
    if (scriptText) {
      try {
        nuxtData = JSON.parse(scriptText);
        if (Array.isArray(nuxtData)) {
          for (let i = 0; i < nuxtData.length; i++) {
            const raw = nuxtData[i];
            if (!raw) continue;
            let obj;
            try { obj = (typeof raw === "object") ? derefObject(raw, nuxtData) : raw; } catch { obj = raw; }
            if (!obj || typeof obj !== "object") continue;
            const idVal = obj.id || obj.album_id;
            if (idVal) {
              const title = obj.title || obj.name || "";
              const cover = safeCoverFromItem(obj, nuxtData) || "";
              nuxtMap.set(String(idVal), { id: String(idVal), title, cover, raw: obj });
            }
          }
        } else if (typeof nuxtData === "object") {
          for (const k of Object.keys(nuxtData)) {
            const val = nuxtData[k];
            if (Array.isArray(val)) {
              for (const it of val) {
                try {
                  const obj = (typeof it === "object") ? derefObject(it, nuxtData) : it;
                  if (!obj || typeof obj !== "object") continue;
                  const idVal = obj.id || obj.album_id;
                  if (idVal) {
                    const title = obj.title || obj.name || "";
                    const cover = safeCoverFromItem(obj, nuxtData) || "";
                    nuxtMap.set(String(idVal), { id: String(idVal), title, cover, raw: obj });
                  }
                } catch {}
              }
            }
          }
        }
        log("info", `__NUXT_DATA__ parsed type=${Array.isArray(nuxtData) ? 'array' : typeof nuxtData} nuxtMap=${nuxtMap.size}`);
      } catch (e) {
        log("warn", `home failed to parse __NUXT_DATA__: ${e && e.message ? e.message : String(e)}`);
      }
    } else {
      log("info", "__NUXT_DATA__ not found on home");
    }

    // 4. 合并 DOM 与 nuxtData：以 nuxtData 为准覆盖封面与标题
    const merged = domList.map(d => {
      const id = String(d.vod_id || "");
      let vod_pic = d.vod_pic || "";
      let vod_name = d.vod_name || "";
      if (id && nuxtMap.has(id)) {
        const nd = nuxtMap.get(id);
        if (nd.cover) vod_pic = normalizeUrl(nd.cover);
        if (nd.title) vod_name = nd.title;
      }
      if (!vod_pic) {
        const metaImg = $("meta[property='og:image']").attr("content") || "";
        if (metaImg) vod_pic = normalizeUrl(metaImg);
      }
      return {
        vod_id: id,
        vod_name: vod_name || `专辑${id}`,
        vod_pic: normalizeUrl(vod_pic || ""),
        vod_remarks: d.vod_remarks || "",
        type_id: d.type_id || "",
        type_name: d.type_name || ""
      };
    });

    // 5. 如果 merged 为空但 nuxtMap 有数据，则把 nuxtMap 转为列表
    let finalList = merged;
    if (finalList.length === 0 && nuxtMap.size > 0) {
      const arr = [];
      for (const v of nuxtMap.values()) {
        arr.push({
          vod_id: String(v.id || ""),
          vod_name: v.title || `专辑${v.id || ""}`,
          vod_pic: normalizeUrl(v.cover || ""),
          vod_remarks: "",
          type_id: "",
          type_name: ""
        });
      }
      finalList = arr;
    }

    // 6. 去重并返回
    const uniq = uniqBy(finalList, it => it.vod_id);
    log("info", `home done classes=${classList.length} list=${uniq.length}`);
    log("info", `home sample list[0..5]=${JSON.stringify(uniq.slice(0,6), null, 2)}`);

    return {
      class: classList.length ? classList : CATEGORY_MAP,
      list: uniq
    };
  } catch (e) {
    log("error", `home error: ${e.message}`);
    return { class: CATEGORY_MAP, list: [] };
  }
}

/* category (priority: __NUXT_DATA__ -> DOM -> regex) */
async function category(params, context) {
  try {
    const { categoryId, page = 1 } = params || {};
    log("info", `category start categoryId=${categoryId} page=${page}`);
    const url = `${SITE}/categories/${categoryId}?sort=comprehensive&page=${page}`;
    const resp = await axios.get(url, { headers: getHeaders(), timeout: 20000 });
    const html = typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data);
    const $ = cheerio.load(html);

    const pageTitle = safeText($("h1").first()) || CATEGORY_MAP.find(x => x.type_id === String(categoryId))?.type_name || `分类${categoryId}`;

    const scriptText = $("#__NUXT_DATA__").html();
    log("info", `__NUXT_DATA__ present=${!!scriptText} length=${scriptText ? scriptText.length : 0}`);

    if (scriptText) {
      try {
        const nuxtData = JSON.parse(scriptText);
        log("info", `__NUXT_DATA__ parsed type=${Array.isArray(nuxtData) ? 'array' : typeof nuxtData}`);

        const key = `categoryAlbums-${categoryId}`;
        let albums = [];

        if (Array.isArray(nuxtData)) {
          for (let i = 0; i < nuxtData.length; i++) {
            const obj = nuxtData[i];
            if (!obj) continue;
            if (isMetaObject(obj)) continue;
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
              const idxOrArr = obj[key];
              if (typeof idxOrArr === "number") {
                const catObj = nuxtData[idxOrArr];
                if (catObj && Array.isArray(catObj.data)) {
                  for (const j of catObj.data) pushIfAlbum(j, nuxtData, albums);
                }
              } else if (Array.isArray(idxOrArr)) {
                for (const it of idxOrArr) pushIfAlbum(it, nuxtData, albums);
              } else {
                pushIfAlbum(idxOrArr, nuxtData, albums);
              }
              break;
            }
          }
        } else if (typeof nuxtData === "object" && Object.prototype.hasOwnProperty.call(nuxtData, key)) {
          const idxOrArr = nuxtData[key];
          if (typeof idxOrArr === "number") {
            const catObj = nuxtData[idxOrArr];
            if (catObj && Array.isArray(catObj.data)) {
              for (const j of catObj.data) pushIfAlbum(j, nuxtData, albums);
            }
          } else if (Array.isArray(idxOrArr)) {
            for (const it of idxOrArr) pushIfAlbum(it, nuxtData, albums);
          } else {
            pushIfAlbum(idxOrArr, nuxtData, albums);
          }
        }

        if (!albums.length) {
          const candidates = [];
          if (Array.isArray(nuxtData)) {
            for (const objRaw of nuxtData) {
              if (!objRaw) continue;
              if (isMetaObject(objRaw)) continue;
              pushIfAlbum(objRaw, nuxtData, candidates);
              if (Array.isArray(objRaw.data)) {
                for (const d of objRaw.data) pushIfAlbum(d, nuxtData, candidates);
              }
              for (const k of Object.keys(objRaw || {})) {
                const val = objRaw[k];
                if (Array.isArray(val) && val.length) {
                  for (const it of val) pushIfAlbum(it, nuxtData, candidates);
                }
              }
            }
          } else {
            for (const k of Object.keys(nuxtData)) {
              const val = nuxtData[k];
              if (Array.isArray(val)) {
                for (const it of val) pushIfAlbum(it, nuxtData, candidates);
              } else if (typeof val === "object" && val) {
                pushIfAlbum(val, nuxtData, candidates);
                if (Array.isArray(val.data)) for (const d of val.data) pushIfAlbum(d, nuxtData, candidates);
              }
            }
          }
          const seen = new Set();
          for (const c of candidates) {
            const id = String((c && (c.id || c.album_id)) || "");
            if (!id) continue;
            if (!seen.has(id)) { seen.add(id); albums.push(c); }
          }
          log("info", `collected candidate albums from nuxtData count=${albums.length}`);
        }

        const derefAlbums = albums.map(a => (typeof a === "number" ? derefValue(a, nuxtData) : (typeof a === "object" ? derefObject(a, nuxtData) : a))).filter(Boolean);

        const list = derefAlbums.map(item => {
          const idVal = item?.id || item?.album_id || "";
          const coverCandidate = safeCoverFromItem(item, nuxtData);

          // 作者优先级：author > teller > reader > host > performer
          const author = item?.author || item?.teller || item?.reader || item?.host || item?.performer || "";

          // 期数/集数兼容字段
          const count = item?.count || item?.chapterTotal || item?.episodes || item?.total || "";

          // 状态解析（使用 resolveStatusText，包含 site-specific codes 99/156）
          const statusText = resolveStatusText(item?.status);

          const remarksParts = [];
          if (author) remarksParts.push(`作者:${author}`);
          if (count || item?.count === 0) {
            const cnt = (typeof count === "number" || /^\d+$/.test(String(count))) ? String(count) : String(count);
            if (cnt && cnt !== "0") remarksParts.push(`${cnt}期`);
          }
          if (statusText) remarksParts.push(statusText);
          const vod_remarks = remarksParts.join(" · ");

          return {
            vod_id: String(idVal),
            vod_name: item?.title || item?.name || `专辑${idVal}`,
            vod_pic: normalizeUrl(coverCandidate || ""),
            vod_remarks,
            type_id: String(categoryId),
            type_name: ""
          };
        }).filter(it => it.vod_id);

        for (const it of list) it.vod_pic = normalizeUrl(it.vod_pic || "");

        const finalList = uniqBy(list, it => it.vod_id);
        log("info", `category parsed from __NUXT_DATA__ count=${finalList.length}`);
        if (finalList.length > 0) {
          return {
            page: Number(page) || 1,
            pagecount: finalList.length > 0 ? (Number(page) || 1) + 1 : Number(page) || 1,
            total: finalList.length,
            list: finalList
          };
        }
      } catch (err) {
        log("warn", `failed to parse or extract from __NUXT_DATA__: ${err && err.message ? err.message : String(err)}`);
      }
    } else {
      log("warn", "__NUXT_DATA__ not found in HTML");
    }

    // Fallback DOM parsing
    const domList = [];
    $("a.list-item[href*='/albums/'], a[href*='/albums/']").each((_, el) => {
      const item = parseAlbumCard($, el, categoryId, pageTitle);
      if (item) domList.push(item);
    });

    if (domList.length === 0) {
      try {
        const albumHrefRe = /\/albums\/(\d+)/g;
        const seen = new Set();
        let m;
        while ((m = albumHrefRe.exec(html)) !== null) {
          const id = m[1];
          if (seen.has(id)) continue;
          seen.add(id);
          const snippetRe = new RegExp(`<a[^>]*href=["']\\/albums\\/${id}["'][\\s\\S]{0,300}?>([\\s\\S]{0,300}?)<\\/a>`, "i");
          const sn = snippetRe.exec(html);
          let vod_name = `专辑${id}`;
          let vod_pic = "";
          if (sn && sn[1]) {
            const inner = sn[1];
            const titleMatch = inner.replace(/<[^>]+>/g, " ").match(/[^\s]{2,100}/);
            if (titleMatch) vod_name = titleMatch[0].trim();
            const imgMatch = inner.match(/<img[^>]+src=["']([^"']+)["']/i);
            if (imgMatch) vod_pic = normalizeUrl(imgMatch[1]);
          }
          domList.push({
            vod_id: String(id),
            vod_name,
            vod_pic,
            vod_remarks: "",
            type_id: String(categoryId),
            type_name: pageTitle
          });
        }
      } catch (err) {
        log("warn", `fallback regex extraction failed: ${err.message}`);
      }
    }

    const finalList = uniqBy(domList, it => it.vod_id);
    log("info", `category fallback done title=${pageTitle} raw=${domList.length} uniq=${finalList.length}`);
    return {
      page: Number(page) || 1,
      pagecount: finalList.length > 0 ? (Number(page) || 1) + 1 : Number(page) || 1,
      total: finalList.length,
      list: finalList
    };
  } catch (e) {
    log("error", `category error: ${e.message}`);
    return { page: Number((params || {}).page || 1), pagecount: Number((params || {}).page || 1), total: 0, list: [] };
  }
}

/* detail (fixed: robust deref of __NUXT_DATA__ mapping + API + DOM fallback) */
async function detail(params, context) {
  try {
    const { videoId } = params || {};
    log("info", `detail start videoId=${videoId}`);

    let vod_name = `专辑${videoId}`;
    let vod_pic = "";
    let vod_content = "";
    let type_name = "";
    let episodes = [];

    // 1. 优先尝试通过 API 获取（如果可用）
    try {
      const album = await apiGet(`album_detail/${videoId}`);
      if (album && typeof album === "object") {
        vod_name = album.title || album.name || vod_name;
        vod_pic = normalizeUrl(album.cover_url || album.cover || album.image || vod_pic);
        vod_content = album.synopsis || album.detail || album.description || vod_content;
        type_name = album.cat || album.category || type_name;
        log("info", `detail api album ok title=${vod_name}`);
      }
    } catch (e) {
      log("warn", `album_detail api failed: ${e.message}`);
    }

    // 2. 尝试通过章节 API 获取集列表
    try {
      const chapterResp = await apiGet(`chapters_list/${videoId}`);
      const chapters = Array.isArray(chapterResp?.chapters) ? chapterResp.chapters : (Array.isArray(chapterResp) ? chapterResp : []);
      if (Array.isArray(chapters) && chapters.length) {
        episodes = chapters.map(item => ({
          name: item.title || item.name || `第${item.index || item.no || 1}集`,
          playId: `${videoId}|${item.index || item.no || 1}`
        }));
        log("info", `detail api chapters=${episodes.length}`);
      }
    } catch (e) {
      log("warn", `chapters_list api failed: ${e.message}`);
    }

    // 3. 如果关键信息缺失，抓取页面并解析 __NUXT_DATA__ 与 DOM 兜底
    if ((!vod_name || /^专辑\d+$/.test(vod_name)) || !vod_pic || vod_content === "" || episodes.length === 0) {
      try {
        const resp = await axios.get(`${SITE}/albums/${videoId}`, { headers: getHeaders(), timeout: 15000 });
        const html = typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data);
        const $ = cheerio.load(html);

        // DOM 直接取标题/封面/简介（优先）
        const domTitle = safeText($("section.album-pannel .album-intro h1").first()) ||
                         safeText($("h1").first()) ||
                         $("meta[property='og:title']").attr("content") || "";
        if (domTitle) vod_name = domTitle;

        const domCover = normalizeUrl($("section.album-pannel img").first().attr("src") || $("meta[property='og:image']").attr("content") || "");
        if (domCover) vod_pic = vod_pic || domCover;

        const domDesc = $("meta[name='description']").attr("content") || $("meta[property='og:description']").attr("content") || safeText($(".album-desc, .desc, .intro").first()) || "";
        if (domDesc) vod_content = vod_content || domDesc;

        // 解析 __NUXT_DATA__（若存在），并尝试 deref 数字指针或索引映射
        const scriptText = $("#__NUXT_DATA__").html();
        if (scriptText) {
          try {
            const nuxtData = JSON.parse(scriptText);

            // 优先查找显式的 album-detail 映射（例如 "album-detail-9783312385":4）
            const albumKey = `album-detail-${videoId}`;
            if (Array.isArray(nuxtData)) {
              for (let i = 0; i < nuxtData.length; i++) {
                const node = nuxtData[i];
                if (!node || typeof node !== "object") continue;
                if (Object.prototype.hasOwnProperty.call(node, albumKey)) {
                  const mapIdx = node[albumKey];
                  const mapping = nuxtData[mapIdx];
                  if (mapping && typeof mapping === "object") {
                    const albumObj = derefObject(mapping, nuxtData);
                    if (albumObj.title || albumObj.name) vod_name = albumObj.title || albumObj.name;
                    const cover = safeCoverFromItem(albumObj, nuxtData);
                    if (cover) vod_pic = normalizeUrl(cover);
                    vod_content = vod_content || (albumObj.synopsis || albumObj.detail || albumObj.description || "");
                    if (Array.isArray(albumObj.chapters) && albumObj.chapters.length) {
                      episodes = albumObj.chapters.map((c, idx) => ({ name: c.title || `第${idx+1}集`, playId: `${videoId}|${c.index || idx+1}` }));
                    }
                    break;
                  }
                }
              }
            } else if (typeof nuxtData === "object") {
              if (Object.prototype.hasOwnProperty.call(nuxtData, albumKey)) {
                const mapIdx = nuxtData[albumKey];
                const mapping = Array.isArray(nuxtData) ? nuxtData[mapIdx] : nuxtData[mapIdx];
                if (mapping && typeof mapping === "object") {
                  const albumObj = derefObject(mapping, nuxtData);
                  if (albumObj.title || albumObj.name) vod_name = albumObj.title || albumObj.name;
                  const cover = safeCoverFromItem(albumObj, nuxtData);
                  if (cover) vod_pic = normalizeUrl(cover);
                  vod_content = vod_content || (albumObj.synopsis || albumObj.detail || albumObj.description || "");
                }
              } else {
                // 遍历对象字段中的数组，寻找 id 匹配
                for (const k of Object.keys(nuxtData)) {
                  const val = nuxtData[k];
                  if (!Array.isArray(val)) continue;
                  for (const it of val) {
                    const d = (typeof it === "object") ? derefObject(it, nuxtData) : it;
                    if (!d || typeof d !== "object") continue;
                    const candidateId = String(d.id || d.album_id || "");
                    if (candidateId && candidateId === String(videoId)) {
                      vod_name = d.title || d.name || vod_name;
                      vod_pic = vod_pic || safeCoverFromItem(d, nuxtData);
                      vod_content = vod_content || (d.synopsis || d.detail || d.description || "");
                      if (Array.isArray(d.chapters) && d.chapters.length) {
                        episodes = d.chapters.map((c, idx) => ({ name: c.title || `第${idx+1}集`, playId: `${videoId}|${c.index || idx+1}` }));
                      }
                      break;
                    }
                  }
                  if (vod_name && vod_name !== `专辑${videoId}`) break;
                }
              }
            }
          } catch (err) {
            log("warn", `detail failed to parse __NUXT_DATA__: ${err && err.message ? err.message : String(err)}`);
          }
        }

        // 如果 nuxtData 中没有显式 album-detail 映射，尝试遍历数组索引映射（索引 i 等于 videoId 的情况）
        if ((!vod_name || /^专辑\d+$/.test(vod_name)) && scriptText) {
          try {
            const nuxtData2 = JSON.parse(scriptText);
            if (Array.isArray(nuxtData2) && Number.isInteger(Number(videoId))) {
              const idx = Number(videoId);
              if (idx >= 0 && idx < nuxtData2.length) {
                const candidate = nuxtData2[idx];
                if (candidate && typeof candidate === "object") {
                  const d = derefObject(candidate, nuxtData2);
                  if (d && (d.title || d.name || d.id || d.album_id)) {
                    if (d.title || d.name) vod_name = d.title || d.name;
                    if (!vod_pic) vod_pic = safeCoverFromItem(d, nuxtData2) || "";
                    vod_content = vod_content || (d.synopsis || d.detail || d.description || "");
                    if (Array.isArray(d.chapters) && d.chapters.length) {
                      episodes = d.chapters.map((c, idx2) => ({ name: c.title || `第${idx2+1}集`, playId: `${videoId}|${c.index || idx2+1}` }));
                    } else if (d.id || d.album_id) {
                      // 如果该项只是映射到真实 id，尝试请求真实专辑页
                      const realId = String(d.id || d.album_id);
                      try {
                        const realResp = await axios.get(`${SITE}/albums/${realId}`, { headers: getHeaders(), timeout: 15000 });
                        const $$ = cheerio.load(typeof realResp.data === "string" ? realResp.data : JSON.stringify(realResp.data));
                        const realTitle = safeText($$("section.album-pannel .album-intro h1").first()) ||
                                          safeText($$("h1").first()) ||
                                          $$("meta[property='og:title']").attr("content") || "";
                        if (realTitle) vod_name = realTitle;
                        if (!vod_pic) vod_pic = pickImage($$("section.album-pannel img").first()) || normalizeUrl($$("meta[property='og:image']").attr("content") || "");
                      } catch (err) {
                        // ignore
                      }
                    }
                  }
                }
              }
            }
          } catch (err) {
            // ignore
          }
        }

        // 如果页面中有章节列表且 episodes 仍为空，尝试从 DOM 抽取
        if (episodes.length === 0) {
          $("ul.chapter-list > li.chapter-item").each((idx, el) => {
            const $item = $(el);
            const numText = safeText($item.find("p").first());
            const title = safeText($item.find(".item-content .title").first()) || safeText($item.find(".title").first()) || `第${idx + 1}集`;
            const chapterIdx = Number(numText) || idx + 1;
            episodes.push({ name: title, playId: `${videoId}|${chapterIdx}` });
          });
        }

        // 最后再用 meta/title 兜底
        if ((!vod_name || /^专辑\d+$/.test(vod_name)) && $("meta[property='og:title']").attr("content")) {
          vod_name = $("meta[property='og:title']").attr("content");
        }
        if (!vod_pic) {
          vod_pic = pickImage($("section.album-pannel img").first()) || normalizeUrl($("meta[property='og:image']").attr("content") || "");
        }
      } catch (e) {
        log("warn", `detail page fetch failed: ${e.message}`);
      }
    }

    // 去重 episodes 并返回
    episodes = uniqBy(episodes, item => item.playId);
    log("info", `detail done title=${vod_name} episodes=${episodes.length}`);

    return {
      list: [{
        vod_id: String(videoId),
        vod_name,
        vod_pic,
        vod_content,
        type_id: "",
        type_name,
        vod_play_sources: [{ name: "TingYou", episodes }]
      }]
    };
  } catch (e) {
    log("error", `detail error: ${e.message}`);
    return { list: [] };
  }
}

/* search (placeholder) */
async function search(params, context) {
  try {
    log("info", `search start keyword=${params?.keyword || ''}`);
    return { page: Number((params || {}).page || 1), pagecount: Number((params || {}).page || 1), total: 0, list: [] };
  } catch (e) {
    log("error", `search error: ${e.message}`);
    return { page: 1, pagecount: 1, total: 0, list: [] };
  }
}

/* play */
async function play(params, context) {
  try {
    const { playId } = params || {};
    const [albumId, chapterIdx] = String(playId || "").split("|");
    log("info", `play start playId=${playId}`);
    if (!albumId || !chapterIdx) return { urls: [], flag: "play", parse: 0 };

    const data = await apiPost("play_token", {
      album_id: Number(albumId),
      chapter_idx: Number(chapterIdx)
    });

    const audioUrl =
      data?.audio_url ||
      data?.audioUrl ||
      data?.play_url ||
      data?.playUrl ||
      data?.url ||
      data?.file ||
      data?.stream_url ||
      data?.streamUrl ||
      "";

    if (!audioUrl) {
      log("error", `play_token response: ${JSON.stringify(data).slice(0, 800)}`);
      throw new Error("play_token has no playable url");
    }

    log("info", `play success url=${audioUrl.slice(0, 120)}`);
    return {
      urls: [{ name: `第${chapterIdx}集`, url: audioUrl }],
      flag: "play",
      parse: 0,
      header: { Referer: SITE + "/playing" }
    };
  } catch (e) {
    log("error", `play error: ${e.message}`);
    const [albumId, chapterIdx] = String((params || {}).playId || "").split("|");
    const fallback = albumId && chapterIdx ? `${SITE}/audios/${albumId}/${chapterIdx}` : SITE;
    return {
      urls: [{ name: "播放页", url: fallback }],
      flag: "play",
      parse: 1
    };
  }
}

module.exports = { home, category, detail, search, play };
runner.run(module.exports);
