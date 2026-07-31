/**
 * TVBox / OK影视 GitHub 抓取 + 最新资源优先 + 多重 CDN 备用重试 + 全量健康复检脚本
 */

const fs = require('fs');
const path = require('path');

// ==================== 配置区域 ====================
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.MY_GITHUB_TOKEN || '你的_GITHUB_TOKEN'; 

// 抓取页数 (每页 100 条，改到 3 页抓取最新的前 300 个接口)
const MAX_PAGES = 3; 

// 多重 CDN 代理加速节点列表
const CDN_NODES = [
  'https://ghproxy.net/',
  'https://raw.gitmirror.com/',
  'https://gh.ddlc.top/'
];

const FILE_NAMES = {
  normalProxy: 'multisite_proxy_latest.json',
  normalGithub: 'multisite_github_latest.json',
  adultProxy: 'multisite_adult_proxy_latest.json',
  adultGithub: 'multisite_adult_github_latest.json',
  invalidProxy: 'multisite_invalid_proxy_latest.json',
  invalidGithub: 'multisite_invalid_github_latest.json'
};

const ADULT_CATEGORY_KEYWORDS = [
  '柚木TINA', '柚木提娜', '原纱央莉', '大桥未久', '仁科百华', '天海翼', '小川阿佐美', '三上悠亚', '长泽梓',
  '日韩无码', '强奸乱伦', '欧美精品', '国产精品', '人妻系列', '中文字幕', '动漫精品', '伦理影片', 
  '日韩精品', '制服诱惑', '自拍偷拍', 'AV明星', '3P合辑', '巨乳系列', '颜射系列', '口交视频', 
  '自慰系列', 'SM重味', '教师学生', '大秀视频', '成人', '成人片', '三级', '三级片', '情色', '情色片', 
  '18禁', '18+', '十八禁', '福利', '福利片', 'AV', 'av', '无码', '有码', '乱伦', '综合色情', '自拍', 
  '偷拍', '偷窥', '制服', '丝袜', '巨乳', '爆乳', '人妻', '熟女', '少女', '幼女', '萝莉', '后宫', 
  '动漫AV', '无码解禁', '骑兵', '步兵', '颜射', '口交', '肛交', '群交', '换妻', '强奸', '迷奸', 
  'SM', 'sm', '调教', '绑架', '拘束', '露阴', '孕妇', '美臀', '美腿', '野外', '激情', '麻豆', 
  '天美', '果冻', '星空传媒', '蜜桃', '精东', '乌鸦传媒', '皇家华人', '91大神', '91porny', '91视频', 
  '探花', '吃瓜', '黑料', '曝光', '流出', '门事件', 'Pornhub', 'Xvideos', 'Jable', 'MISSAV', 'Hanime', 
  'adult', 'erotic', 'porn', 'sex', 'sexy', 'hentai', 'uncensored', 'censored', 'nsfw', 'hjson'
];

let logBuffer = [];
const originalWrite = process.stdout.write.bind(process.stdout);

process.stdout.write = function (chunk, encoding, callback) {
  logBuffer.push(chunk.toString());
  return originalWrite(chunk, encoding, callback);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getFilenameTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function cleanToRawUrl(url) {
  if (!url) return '';
  let cleaned = url.trim();
  for (const cdn of CDN_NODES) {
    if (cleaned.startsWith(cdn)) {
      cleaned = cleaned.replace(cdn, '');
    }
  }
  return cleaned;
}

function loadExistingRawUrls(filename) {
  const filePath = path.join(process.cwd(), filename);
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const json = JSON.parse(content);
      if (json && Array.isArray(json.urls)) {
        return json.urls.map(item => cleanToRawUrl(item.url)).filter(u => u.length > 0);
      }
    } catch (e) {
      console.log(`⚠️ 读取历史文件 ${filename} 失败，忽略。`);
    }
  }
  return [];
}

/**
 * 1. 检索 GitHub API (强制按最新索引时间倒序排列)
 */
async function fetchFromGitHub() {
  console.log('🔍 开始检索 GitHub Code Search API (⚡已开启最新资源优先模式)...');
  let results = [];
  
  // sort=indexed&order=desc 确保获取最最新修改/提交的 JSON 配置
  const query = 'q=sites+spider+extension:json+tvbox&sort=indexed&order=desc';

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://api.github.com/search/code?${query}&per_page=100&page=${page}`;
    
    const headers = { 
      'User-Agent': 'TVBox-Aggregator-Bot',
      'Accept': 'application/vnd.github.v3+json'
    };
    
    if (GITHUB_TOKEN && GITHUB_TOKEN !== '你的_GITHUB_TOKEN') {
      const tokenStr = GITHUB_TOKEN.startsWith('ghp_') || GITHUB_TOKEN.startsWith('github_pat_')
        ? `Bearer ${GITHUB_TOKEN}`
        : GITHUB_TOKEN;
      headers['Authorization'] = tokenStr;
    }

    try {
      const res = await fetch(url, { headers });
      
      if (res.status === 401 || res.status === 403) {
        console.log(`  └─ ⚠️ Token 受限(HTTP ${res.status})，自动切入匿名通道抓取最新资源...`);
        const anonymousRes = await fetch(url, { headers: { 'User-Agent': 'TVBox-Aggregator-Bot' } });
        if (anonymousRes.ok) {
          const data = await anonymousRes.json();
          const items = data.items || [];
          items.forEach(item => {
            const rawUrl = item.html_url.replace('https://github.com/', 'https://raw.githubusercontent.com/').replace('/blob/', '/');
            results.push(rawUrl);
          });
          console.log(`  └─ [最新资源-匿名] 第 ${page} 页检索到 ${items.length} 条数据`);
          if (items.length < 100) break;
          continue;
        }
        break;
      }

      if (!res.ok) {
        console.log(`  └─ GitHub 返回状态: HTTP ${res.status}`);
        break;
      }

      const data = await res.json();
      const items = data.items || [];
      
      items.forEach(item => {
        const rawUrl = item.html_url.replace('https://github.com/', 'https://raw.githubusercontent.com/').replace('/blob/', '/');
        results.push(rawUrl);
      });
      console.log(`  └─ [最新资源-成功] 第 ${page} 页检索到 ${items.length} 条数据`);
      if (items.length < 100) break;
      await sleep(1000);
    } catch (e) {
      console.log(`  └─ GitHub 检索异常: ${e.message}`);
      break;
    }
  }
  return results;
}

function checkAdult(jsonObj) {
  let categoriesList = [];

  if (jsonObj && Array.isArray(jsonObj.sites)) {
    jsonObj.sites.forEach(site => {
      if (site.categories) {
        if (Array.isArray(site.categories)) categoriesList.push(...site.categories.map(c => String(c)));
        else if (typeof site.categories === 'string') categoriesList.push(site.categories);
      }
      if (site.name) categoriesList.push(String(site.name));
    });
  }

  const combinedText = categoriesList.join(' ').toLowerCase();
  for (const keyword of ADULT_CATEGORY_KEYWORDS) {
    if (combinedText.includes(keyword.toLowerCase())) {
      return { isAdult: true, keyword };
    }
  }
  return { isAdult: false, keyword: null };
}

async function validateUrlWithMultiCDN(rawUrl) {
  for (let idx = 0; idx < CDN_NODES.length; idx++) {
    const cdnPrefix = CDN_NODES[idx];
    const targetUrl = `${cdnPrefix}${rawUrl}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(targetUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const text = await res.text();
        let jsonObj = null;
        try { jsonObj = JSON.parse(text); } catch (e) {}

        const isTvbox = (jsonObj && (jsonObj.sites || jsonObj.spider)) || text.includes('"sites"');
        if (isTvbox) {
          const adultRes = checkAdult(jsonObj);
          return {
            isValid: true,
            isAdult: adultRes.isAdult,
            keyword: adultRes.keyword,
            workingCdnUrl: targetUrl
          };
        }
      }
    } catch (e) {}
  }

  return { isValid: false, reason: '全量 CDN 节点连接超时或无效' };
}

async function start() {
  const timestamp = getFilenameTimestamp();
  console.log(`🚀 开始处理 TVBox 配置文件 (最新资源倒序 + 多重 CDN 校验)...\n`);

  const historyNormal = loadExistingRawUrls(FILE_NAMES.normalGithub);
  const historyAdult = loadExistingRawUrls(FILE_NAMES.adultGithub);
  const historyInvalid = loadExistingRawUrls(FILE_NAMES.invalidGithub);

  console.log(`📦 历史加载：读取到历史已知接口 ${historyNormal.length + historyAdult.length + historyInvalid.length} 条。`);

  const fetchedRawUrls = await fetchFromGitHub();

  const allCandidateUrlsSet = new Set();
  [...historyNormal, ...historyAdult, ...historyInvalid, ...fetchedRawUrls].forEach(url => {
    if (url) allCandidateUrlsSet.add(url.trim());
  });

  const uniqueAllUrls = Array.from(allCandidateUrlsSet);
  console.log(`\n🧹 汇总去重：最终得到【${uniqueAllUrls.length}】条候选接口，开始发起【混合探针健康复检】...\n`);

  let normalProxy = [], normalGithub = [];
  let adultProxy = [], adultGithub = [];
  let invalidProxy = [], invalidGithub = [];

  let nIdx = 0, aIdx = 0, iIdx = 0;

  for (let i = 0; i < uniqueAllUrls.length; i++) {
    const rawUrl = uniqueAllUrls[i];
    let ownerRepoPath = rawUrl.replace('https://raw.githubusercontent.com/', '');
    
    process.stdout.write(`[${i + 1}/${uniqueAllUrls.length}] 节点测试... `);

    const check = await validateUrlWithMultiCDN(rawUrl);

    if (check.isValid) {
      if (check.isAdult) {
        aIdx++;
        const name = `[大人${aIdx}] 【GitHub-${ownerRepoPath}】`;
        adultProxy.push({ name, url: check.workingCdnUrl });
        adultGithub.push({ name, url: rawUrl });
        console.log(`🔞 [大人 - 命中"${check.keyword}"] -> ${name}`);
      } else {
        nIdx++;
        const name = `[自定义${nIdx}] 【GitHub-${ownerRepoPath}】`;
        normalProxy.push({ name, url: check.workingCdnUrl });
        normalGithub.push({ name, url: rawUrl });
        console.log(`✅ [常规健康] -> ${name}`);
      }
    } else {
      iIdx++;
      const name = `[剔除${iIdx}] 【GitHub-${ownerRepoPath}】`;
      invalidProxy.push({ name, url: `${CDN_NODES[0]}${rawUrl}` });
      invalidGithub.push({ name, url: rawUrl });
      console.log(`❌ [失效剔除] -> ${name}`);
    }
  }

  const finalFiles = [
    { name: FILE_NAMES.normalProxy, data: { urls: normalProxy } },
    { name: FILE_NAMES.normalGithub, data: { urls: normalGithub } },
    { name: FILE_NAMES.adultProxy, data: { urls: adultProxy } },
    { name: FILE_NAMES.adultGithub, data: { urls: adultGithub } },
    { name: FILE_NAMES.invalidProxy, data: { urls: invalidProxy } },
    { name: FILE_NAMES.invalidGithub, data: { urls: invalidGithub } },
  ];

  console.log(`\n=================== 聚合排查报告 (严格标准 + 极速响应) ===================`);
  console.log(`✅ 存活常规健康源: ${normalProxy.length} 个`);
  console.log(`🔞 存活成人隔离源: ${adultProxy.length} 个`);
  console.log(`❌ 确认完全无法访问/非TVBox结构: ${invalidProxy.length} 个`);
  console.log('------------------------------------------------------------------');

  finalFiles.forEach(f => {
    fs.writeFileSync(path.join(process.cwd(), f.name), JSON.stringify(f.data, null, 2), 'utf-8');
    console.log(`💾 保存最新纯净文件: ${f.name} (${f.data.urls.length} 条)`);
  });

  const logFileName = `run_log_${timestamp}.log.txt`;
  fs.writeFileSync(path.join(process.cwd(), logFileName), logBuffer.join(''), 'utf-8');
  originalWrite(`📄 本次复检日志已保存至: ${logFileName}\n`);
}

start();
