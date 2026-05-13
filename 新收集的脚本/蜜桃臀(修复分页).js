// @name 蜜桃臀18+ (修复分页)
// @author ChatGPT
// @description OmniBox 蜜桃站最终稳定修复版（封面+播放地址+分页修复v4）
/* @dependencies: axios, cheerio */
// @version 1.8.0
// @downloadURL 

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");
const axios = require("axios");
const cheerio = require("cheerio");

const BASE_URL = "https://mitaotunbbx.xyz";

const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// 请求延迟控制（避免429）
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1000; // 最小请求间隔1秒

// ================= 日志 =================
function logInfo(msg, data = null) {
    const suffix = data ? `: ${JSON.stringify(data)}` : "";
    OmniBox.log("info", `[蜜桃] ${msg}${suffix}`);
}

function logError(msg, err = null) {
    const suffix = err ? `: ${err.message || err}` : "";
    OmniBox.log("error", `[蜜桃] ${msg}${suffix}`);
}

// ================= 工具 =================
function toAbsUrl(url) {
    if (!url) return "";

    url = String(url).trim();

    if (!url) return "";

    if (url.startsWith("http")) return url;

    if (url.startsWith("//")) return "https:" + url;

    if (url.startsWith("/")) return BASE_URL + url;

    return `${BASE_URL}/${url}`;
}

async function request(url, retryCount = 0) {
    try {
        // 添加延迟避免429
        const now = Date.now();
        const timeSinceLastRequest = now - lastRequestTime;
        if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
            const delay = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
            logInfo("请求延迟", { delay, url });
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        logInfo("请求页面", { url });
        lastRequestTime = Date.now();
        
        const res = await axios.get(url, {
            timeout: 15000,
            headers: {
                "User-Agent": UA,
                "Referer": BASE_URL,
                "Origin": BASE_URL,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                "Cache-Control": "no-cache",
                "Pragma": "no-cache",
            },
            responseType: "text",
            maxRedirects: 5,
        });

        return res.data || "";
    } catch (error) {
        // 429错误特殊处理，增加等待时间
        if (error.response?.status === 429) {
            const waitTime = 3000 * (retryCount + 1);
            logInfo(`遇到429，等待${waitTime}ms后重试`, { url, retryCount });
            await new Promise(resolve => setTimeout(resolve, waitTime));
            if (retryCount < 3) {
                return request(url, retryCount + 1);
            }
        } else if (retryCount < 2 && error.response?.status !== 404) {
            logInfo(`请求失败，重试 ${retryCount + 1}/2`, { url, error: error.message, status: error.response?.status });
            await new Promise(resolve => setTimeout(resolve, 2000 * (retryCount + 1)));
            return request(url, retryCount + 1);
        }
        throw error;
    }
}

// ================= 安全转换为整数 =================
function toInt(value) {
    if (typeof value === "number") {
        return Math.floor(value);
    }
    if (typeof value === "string") {
        const num = parseInt(value, 10);
        return isNaN(num) ? 0 : num;
    }
    return 0;
}

// ================= 解析扩展参数 =================
function parseExtendParams(params = {}) {
    const result = {};

    if (params.extend) {
        try {
            const decodedStr = Buffer.from(String(params.extend), "base64").toString("utf-8");
            const extObj = JSON.parse(decodedStr);
            if (extObj && typeof extObj === "object") {
                Object.assign(result, extObj);
            }
            logInfo("解析extend参数", result);
        } catch (error) {
            logError(`解析extend参数失败: ${error.message}`);
        }
    }

    if (params.filters && typeof params.filters === "object") {
        Object.assign(result, params.filters);
    } else if (typeof params.filters === "string" && params.filters.trim()) {
        try {
            const parsed = JSON.parse(params.filters);
            if (parsed && typeof parsed === "object") {
                Object.assign(result, parsed);
            }
        } catch (error) {
            logError(`解析filters参数失败: ${error.message}`);
        }
    }

    return result;
}

// ================= 构建分页URL（使用路径格式） =================
function buildPageUrl(originalUrl, page) {
    if (page <= 1) return originalUrl;
    
    logInfo("构建分页URL", { originalUrl, page });
    
    // 根据提供的示例，分页格式是: /list/{id}/{page}.html
    // 原始URL格式: /list/ff80808172b90a110172b90dca6c0013.html
    // 第2页: /list/ff80808172b90a110172b90dca6c0013/2.html
    
    // 移除.html后缀
    let baseUrl = originalUrl;
    if (baseUrl.endsWith('.html')) {
        baseUrl = baseUrl.slice(0, -5); // 移除 .html
    }
    
    // 构建分页URL: {baseUrl}/{page}.html
    const pageUrl = `${baseUrl}/${page}.html`;
    logInfo("使用路径格式", { pageUrl });
    
    return pageUrl;
}

// ================= 从页面中提取分页信息 =================
function extractPaginationInfo($, currentUrl, currentPage) {
    let totalPages = 1;
    let maxPageNum = 1;
    
    // 查找所有分页链接
    const paginationSelectors = [
        ".pagination a",
        ".pages a", 
        ".page a",
        "a[href*='/list/']",
        ".page-numbers",
        "a.page-link",
        ".pager a"
    ];
    
    for (let selector of paginationSelectors) {
        $(selector).each((_, el) => {
            const href = $(el).attr("href") || "";
            const text = $(el).text().trim();
            
            // 从链接中提取页码
            // 匹配格式: /list/xxx/数字.html
            const pageMatch = href.match(/\/list\/[^/]+\/(\d+)\.html/);
            if (pageMatch) {
                const pageNum = parseInt(pageMatch[1]);
                if (pageNum > maxPageNum) {
                    maxPageNum = pageNum;
                }
            }
            
            // 也匹配文本中的数字
            if (/^\d+$/.test(text)) {
                const pageNum = parseInt(text);
                if (pageNum > maxPageNum) {
                    maxPageNum = pageNum;
                }
            }
        });
        
        if (maxPageNum > 1) break;
    }
    
    // 检查是否有下一页链接
    let hasNextPage = false;
    const nextSelectors = [
        "a:contains('下一页')",
        "a:contains('下页')", 
        "a:contains('next')",
        "a[rel='next']"
    ];
    
    for (let selector of nextSelectors) {
        const nextLink = $(selector).first();
        if (nextLink.length && nextLink.attr("href")) {
            hasNextPage = true;
            break;
        }
    }
    
    // 如果当前页有数据且没有检测到最大页码，但有下一页链接，则设置一个较大的值
    if (maxPageNum <= 1 && hasNextPage) {
        totalPages = currentPage + 10;
        logInfo("检测到下一页链接，设置总页数", { totalPages });
    } else if (maxPageNum > 1) {
        totalPages = maxPageNum;
    } else {
        totalPages = 1;
    }
    
    logInfo("分页信息提取", { totalPages, hasNextPage, maxPageNum });
    
    return {
        totalPages,
        hasNextPage
    };
}

// ================= 增强的封面图提取函数 =================
function extractPic(element, $) {
    let pic = "";
    
    const img = element.find("img");
    
    if (img.length > 0) {
        pic = img.attr("data-original") ||
              img.attr("data-src") ||
              img.attr("src") ||
              img.attr("data-lazy-src") ||
              img.attr("data-srcset") ||
              "";
        
        if (!pic) {
            const style = img.attr("style") || "";
            const bgMatch = style.match(/background(?:-image)?:\s*url\(['"]?(.*?)['"]?\)/i);
            if (bgMatch) pic = bgMatch[1];
        }
        
        if (!pic) {
            const classAttr = img.attr("class") || "";
            if (classAttr.includes("lazy")) {
                pic = img.attr("data-original") || img.attr("data-src");
            }
        }
    }
    
    if (!pic) {
        const parentImg = element.closest("a").find("img");
        if (parentImg.length > 0) {
            pic = parentImg.attr("data-original") ||
                  parentImg.attr("data-src") ||
                  parentImg.attr("src") ||
                  "";
        }
    }
    
    if (!pic) {
        const style = element.attr("style") || "";
        const bgMatch = style.match(/background(?:-image)?:\s*url\(['"]?(.*?)['"]?\)/i);
        if (bgMatch) pic = bgMatch[1];
    }
    
    if (pic) {
        pic = pic.replace(/-\w+\.(jpg|jpeg|png|webp)/i, '.$1');
        pic = toAbsUrl(pic);
    }
    
    return pic;
}

// ================= 首页增强封面提取 =================
function extractHomePic(element, $) {
    let pic = "";
    
    const selectors = [
        element.find("img"),
        element.find(".lazy"),
        element.find("[data-original]"),
        element.find("[data-src]"),
        element.closest("a").find("img"),
        element.parent().find("img"),
        element.prev().find("img")
    ];
    
    for (let imgElement of selectors) {
        if (imgElement.length > 0) {
            pic = imgElement.attr("data-original") ||
                  imgElement.attr("data-src") ||
                  imgElement.attr("src") ||
                  imgElement.attr("data-lazy-src") ||
                  "";
            if (pic) break;
        }
    }
    
    if (!pic) {
        const bgElements = [
            element,
            element.find("[style*='background']"),
            element.closest("[style*='background']")
        ];
        
        for (let bgElement of bgElements) {
            if (bgElement.length > 0) {
                const style = bgElement.attr("style") || "";
                const bgMatch = style.match(/background(?:-image)?:\s*url\(['"]?(.*?)['"]?\)/i);
                if (bgMatch) {
                    pic = bgMatch[1];
                    break;
                }
            }
        }
    }
    
    if (pic) {
        pic = pic.replace(/-\d+x\d+\.(jpg|jpeg|png|webp)/i, '.$1');
        pic = pic.replace(/thumb\//i, '');
        pic = toAbsUrl(pic);
    }
    
    return pic;
}

// ================= 播放地址解析核心函数 =================
async function parseIframeContent(iframeUrl, depth = 0) {
    if (depth > 3) {
        logError("iframe 嵌套过深");
        return null;
    }
    
    try {
        logInfo("解析 iframe 内容", { iframeUrl, depth });
        const html = await request(iframeUrl);
        
        const videoPatterns = [
            /https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi,
            /https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/gi,
            /https?:\/\/[^\s"'<>]+\.flv[^\s"'<>]*/gi,
            /https?:\/\/[^\s"'<>]+\.m4v[^\s"'<>]*/gi,
            /https?:\/\/[^\s"'<>]+\.ts[^\s"'<>]*/gi,
        ];
        
        for (let pattern of videoPatterns) {
            const matches = html.match(pattern);
            if (matches && matches.length > 0) {
                const videoUrl = toAbsUrl(matches[0]);
                logInfo("从 iframe 找到播放地址", { videoUrl });
                return videoUrl;
            }
        }
        
        const redirectMatch = html.match(/window\.location\.href\s*=\s*["']([^"']+)["']/i) ||
                             html.match(/location\.replace\(["']([^"']+)["']\)/i) ||
                             html.match(/setTimeout.*?location\.href=["']([^"']+)["']/i);
        
        if (redirectMatch) {
            let redirectUrl = redirectMatch[1];
            if (redirectUrl.startsWith('/')) {
                redirectUrl = BASE_URL + redirectUrl;
            } else if (!redirectUrl.startsWith('http')) {
                redirectUrl = BASE_URL + '/' + redirectUrl;
            }
            return parseIframeContent(redirectUrl, depth + 1);
        }
        
        const nestedIframe = html.match(/<iframe[^>]+src=["']([^"']+)["'][^>]*>/i);
        if (nestedIframe) {
            let nestedUrl = nestedIframe[1];
            if (nestedUrl.startsWith('/')) {
                nestedUrl = BASE_URL + nestedUrl;
            } else if (!nestedUrl.startsWith('http')) {
                nestedUrl = BASE_URL + '/' + nestedUrl;
            }
            return parseIframeContent(nestedUrl, depth + 1);
        }
        
        const jsVarPatterns = [
            /var\s+url\s*=\s*["']([^"']+)["']/i,
            /var\s+videoUrl\s*=\s*["']([^"']+)["']/i,
            /var\s+src\s*=\s*["']([^"']+)["']/i,
            /["'](https?:\/\/[^"']+\.(?:m3u8|mp4|flv))["']/i,
        ];
        
        for (let pattern of jsVarPatterns) {
            const match = html.match(pattern);
            if (match && (match[1].includes('m3u8') || match[1].includes('mp4') || match[1].includes('flv'))) {
                const videoUrl = toAbsUrl(match[1]);
                logInfo("从 JavaScript 变量找到播放地址", { videoUrl });
                return videoUrl;
            }
        }
        
    } catch (e) {
        logError("解析 iframe 失败", e);
    }
    
    return null;
}

function parseVideoUrl(html, originalUrl) {
    let videoUrl = "";
    
    const iframeMatches = html.match(/<iframe[^>]+src=["']([^"']+)["'][^>]*>/gi);
    if (iframeMatches) {
        for (let iframe of iframeMatches) {
            const srcMatch = iframe.match(/src=["']([^"']+)["']/i);
            if (srcMatch) {
                let iframeUrl = srcMatch[1];
                
                if (iframeUrl.startsWith('/')) {
                    iframeUrl = BASE_URL + iframeUrl;
                } else if (!iframeUrl.startsWith('http')) {
                    iframeUrl = BASE_URL + '/' + iframeUrl;
                }
                
                return parseIframeContent(iframeUrl);
            }
        }
    }
    
    const playerConfigs = [
        /var\s+player_info\s*=\s*(\{[^;]+\})/i,
        /var\s+player_data\s*=\s*(\{[^;]+\})/i,
        /var\s+config\s*=\s*(\{[^;]+\})/i,
        /var\s+player\s*=\s*(\{[^;]+\})/i,
        /var\s+video\s*=\s*(\{[^;]+\})/i,
        /player_?\w*\s*=\s*(\{[^;]+\})/i,
        /MacPlayer\s*=\s*(\{[^;]+\})/i,
        /MacGuild\s*=\s*(\{[^;]+\})/i,
        /window\.player\s*=\s*(\{[^;]+\})/i,
    ];
    
    for (let pattern of playerConfigs) {
        const match = html.match(pattern);
        if (match) {
            try {
                let playerData = match[1];
                playerData = playerData.replace(/(\w+):/g, '"$1":');
                const data = JSON.parse(playerData);
                logInfo("找到播放器配置", data);
                
                const possibleFields = ['url', 'video', 'src', 'playUrl', 'play_url', 'source', 'mp4', 'm3u8', 'videoUrl'];
                for (let field of possibleFields) {
                    if (data[field]) {
                        videoUrl = data[field];
                        break;
                    }
                }
                
                if (data.encrypt === '1') {
                    try {
                        videoUrl = unescape(videoUrl);
                    } catch(e) {}
                }
                if (data.encrypt === '2') {
                    try {
                        videoUrl = decodeURIComponent(unescape(videoUrl));
                    } catch(e) {}
                }
                
                if (videoUrl) break;
            } catch (e) {}
        }
    }
    
    if (!videoUrl) {
        const videoPatterns = [
            /https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi,
            /https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/gi,
            /https?:\/\/[^\s"'<>]+\.flv[^\s"'<>]*/gi,
            /https?:\/\/[^\s"'<>]+\.m4v[^\s"'<>]*/gi,
            /https?:\/\/[^\s"'<>]+\.ts[^\s"'<>]*/gi,
        ];
        
        for (let pattern of videoPatterns) {
            const matches = html.match(pattern);
            if (matches && matches.length > 0) {
                videoUrl = matches[0];
                break;
            }
        }
    }
    
    if (!videoUrl) {
        const videoMatch = html.match(/<video[^>]+src=["']([^"']+)["'][^>]*>/i) ||
                          html.match(/<source[^>]+src=["']([^"']+)["'][^>]*>/i);
        if (videoMatch) {
            videoUrl = videoMatch[1];
        }
    }
    
    if (!videoUrl) {
        const jsVarPatterns = [
            /var\s+url\s*=\s*["']([^"']+)["']/i,
            /var\s+videoUrl\s*=\s*["']([^"']+)["']/i,
            /var\s+mp4\s*=\s*["']([^"']+)["']/i,
            /var\s+m3u8\s*=\s*["']([^"']+)["']/i,
            /var\s+src\s*=\s*["']([^"']+)["']/i,
            /["'](https?:\/\/[^"']+\.(?:m3u8|mp4|flv))["']/i,
        ];
        
        for (let pattern of jsVarPatterns) {
            const match = html.match(pattern);
            if (match && (match[1].includes('m3u8') || match[1].includes('mp4') || match[1].includes('flv'))) {
                videoUrl = match[1];
                break;
            }
        }
    }
    
    if (!videoUrl && html.includes('base64')) {
        const base64Match = html.match(/atob\(["']([^"']+)["']\)/i);
        if (base64Match) {
            try {
                const decoded = Buffer.from(base64Match[1], 'base64').toString('utf-8');
                const urlMatch = decoded.match(/https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4|flv)[^\s"'<>]*/i);
                if (urlMatch) {
                    videoUrl = urlMatch[0];
                }
            } catch(e) {}
        }
    }
    
    if (!videoUrl) {
        const scriptMatches = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
        if (scriptMatches) {
            for (let script of scriptMatches) {
                const urlMatch = script.match(/https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4|flv)[^\s"'<>]*/i);
                if (urlMatch) {
                    videoUrl = urlMatch[0];
                    break;
                }
            }
        }
    }
    
    return videoUrl || null;
}

// ================= 首页 =================
async function home() {
    try {
        const html = await request(BASE_URL);
        const $ = cheerio.load(html);

        const classes = [];
        const classCache = new Set();

        $("a[href*='/list/']").each((_, el) => {
            const href = $(el).attr("href") || "";
            const name = $(el).text().trim();

            if (!href || !name) return;
            if (name.length > 20) return;

            const id = toAbsUrl(href);

            if (classCache.has(id)) return;
            classCache.add(id);

            classes.push({
                type_id: id,
                type_name: name,
            });
        });

        const list = [];
        const cache = new Set();

        $(".video-item, .movie-item, .item, li[class*='video'], div[class*='movie'], a[href*='/detail/']").each((_, el) => {
            const a = $(el).is("a") ? $(el) : $(el).find("a[href*='/detail/']").first();
            
            if (!a.length) return;
            
            const href = a.attr("href") || "";
            if (!href) return;

            let title = a.attr("title") || 
                       a.find("img").attr("alt") || 
                       a.find(".title, .name, h3, h4").text().trim() ||
                       a.text().trim();
            
            if (!title) return;

            const vodId = toAbsUrl(href);
            if (cache.has(vodId)) return;
            cache.add(vodId);

            const vod_pic = extractHomePic(a, $);
            
            list.push({
                vod_id: vodId,
                vod_name: title,
                vod_pic: vod_pic || "https://via.placeholder.com/200x300?text=No+Image",
                vod_remarks: a.find(".remarks, .episode, .tag").text().trim() || "",
            });
        });

        logInfo("首页完成", { classCount: classes.length, videoCount: list.length });

        return {
            class: classes,
            list: list.slice(0, 30),
        };
    } catch (e) {
        logError("首页失败", e);

        return {
            class: [],
            list: [],
        };
    }
}

// ================= 分类（使用正确的路径分页格式） =================
async function category(params) {
    try {
        // 获取分类URL和页码
        let url = String(params.type_id || params.categoryId || "");
        let page = toInt(params.page) || 1;
        
        logInfo("分类请求", { originalUrl: url, page, params });
        
        // 解析扩展参数
        const extObj = parseExtendParams(params);
        if (extObj.page) {
            page = toInt(extObj.page);
            logInfo("从extend参数获取页码", { page });
        }
        
        // 构建分页URL（使用路径格式: /list/{id}/{page}.html）
        let pageUrl = url;
        if (page > 1) {
            pageUrl = buildPageUrl(url, page);
        }
        
        logInfo("请求分类页面", { pageUrl });
        
        let html;
        try {
            html = await request(pageUrl);
        } catch (error) {
            // 如果请求失败且不是404，抛出错误
            if (error.response?.status !== 404) {
                throw error;
            }
            
            // 404错误，可能已到最后一页
            logInfo("请求返回404，可能已到最后一页", { pageUrl, page });
            return {
                page: page,
                pagecount: page - 1,
                total: 0,
                list: [],
            };
        }
        
        const $ = cheerio.load(html);

        const list = [];
        const cache = new Set();

        $(".video-item, .movie-item, .item, li[class*='video'], div[class*='movie'], a[href*='/detail/']").each((_, el) => {
            const a = $(el).is("a") ? $(el) : $(el).find("a[href*='/detail/']").first();
            
            if (!a.length) return;
            
            const href = a.attr("href") || "";
            if (!href) return;

            const title = a.attr("title") || 
                         a.find("img").attr("alt") || 
                         a.find(".title, .name, h3, h4").text().trim() ||
                         a.text().trim();
            
            if (!title) return;

            const vodId = toAbsUrl(href);
            if (cache.has(vodId)) return;
            cache.add(vodId);

            const vod_pic = extractHomePic(a, $);
            
            list.push({
                vod_id: vodId,
                vod_name: title,
                vod_pic: vod_pic || "https://via.placeholder.com/200x300?text=No+Image",
                vod_remarks: a.find(".remarks, .episode, .tag").text().trim() || "",
            });
        });
        
        // 提取分页信息
        const paginationInfo = extractPaginationInfo($, pageUrl, page);
        let totalPages = paginationInfo.totalPages;
        
        // 如果当前页有数据但没检测到总页数，且不是第一页，继续设置较大的值
        if (totalPages <= 1 && list.length > 0) {
            if (page === 1) {
                totalPages = 999; // 第一页有数据，可能有多页
            } else {
                totalPages = page + 10;
            }
            logInfo("设置默认总页数", { totalPages, page, listLength: list.length });
        }
        
        logInfo("分类解析完成", { 
            pageUrl, 
            currentPage: page, 
            totalPages, 
            videoCount: list.length 
        });

        return {
            page: page,
            pagecount: totalPages,
            total: list.length,
            list: list,
        };
    } catch (e) {
        logError("分类失败", e);
        
        return {
            list: [],
            page: 1,
            pagecount: 1,
            total: 0,
        };
    }
}

// ================= 详情 =================
async function detail(params) {
    try {
        const url = params.videoId;

        const html = await request(url);
        const $ = cheerio.load(html);

        const title =
            $("h1").first().text().trim() ||
            $(".title, .vod-title").first().text().trim() ||
            $("title").text().trim();

        let pic = "";
        
        const picSelectors = [
            ".detail img", ".vod-detail img", ".poster img", 
            ".cover img", ".thumb img", "img[class*='poster']",
            "img[class*='cover']", "img[class*='thumb']",
            ".content img", "img"
        ];
        
        for (let selector of picSelectors) {
            const img = $(selector).first();
            if (img.length) {
                pic = img.attr("data-original") ||
                      img.attr("data-src") ||
                      img.attr("src") ||
                      "";
                if (pic) break;
            }
        }
        
        if (!pic) {
            const bgElements = [".detail", ".vod-detail", ".poster", ".cover", ".thumb"];
            for (let selector of bgElements) {
                const style = $(selector).attr("style") || "";
                const bgMatch = style.match(/background(?:-image)?:\s*url\(['"]?(.*?)['"]?\)/i);
                if (bgMatch) {
                    pic = bgMatch[1];
                    break;
                }
            }
        }

        pic = toAbsUrl(pic);

        const playSources = [];

        $("a[href*='/vodplay/']").each((i, el) => {
            const href = $(el).attr("href") || "";
            const name = $(el).text().trim() || `播放地址${i + 1}`;

            if (!href) return;

            playSources.push({
                name,
                episodes: [
                    {
                        name,
                        playId: toAbsUrl(href),
                    },
                ],
            });
        });

        logInfo("详情解析", {
            title,
            pic,
            playCount: playSources.length,
        });

        return {
            list: [
                {
                    vod_id: url,
                    vod_name: title,
                    vod_pic: pic || "https://via.placeholder.com/200x300?text=No+Image",
                    vod_play_sources: playSources,
                },
            ],
        };
    } catch (e) {
        logError("详情失败", e);

        return {
            list: [],
        };
    }
}

// ================= 播放 =================
async function play(params) {
    try {
        const playUrl = params.playId;

        logInfo("开始播放解析", {
            playUrl,
            flag: params.flag,
        });

        const html = await request(playUrl);
        
        const redirectMatch = html.match(/window\.location\.href\s*=\s*["']([^"']+)["']/i) ||
                             html.match(/location\.replace\(["']([^"']+)["']\)/i) ||
                             html.match(/setTimeout.*?location\.href=["']([^"']+)["']/i);
        
        let videoUrl = null;
        
        if (redirectMatch) {
            logInfo("发现重定向", { redirectUrl: redirectMatch[1] });
            let redirectUrl = redirectMatch[1];
            if (redirectUrl.startsWith('/')) {
                redirectUrl = BASE_URL + redirectUrl;
            } else if (!redirectUrl.startsWith('http')) {
                redirectUrl = BASE_URL + '/' + redirectUrl;
            }
            
            const redirectHtml = await request(redirectUrl);
            videoUrl = parseVideoUrl(redirectHtml, redirectUrl);
        } else {
            videoUrl = parseVideoUrl(html, playUrl);
        }
        
        if (!videoUrl) {
            logError("未抓到播放地址", { 
                playUrl,
                htmlPreview: html.substring(0, 500) 
            });
            return {
                urls: [],
                parse: 1,
            };
        }
        
        if (videoUrl.includes('#')) {
            const urls = videoUrl.split('#').map(url => ({
                name: "播放地址",
                url: toAbsUrl(url.trim())
            }));
            return {
                urls: urls,
                parse: 0,
            };
        }
        
        videoUrl = toAbsUrl(videoUrl);
        
        logInfo("真实播放地址", { videoUrl });
        
        return {
            urls: [
                {
                    name: params.flag || "默认线路",
                    url: videoUrl,
                },
            ],
            parse: 0,
        };
    } catch (e) {
        logError("播放失败", e);
        
        return {
            urls: [],
            parse: 1,
        };
    }
}

module.exports = {
    home,
    category,
    detail,
    play,
};

runner.run(module.exports);