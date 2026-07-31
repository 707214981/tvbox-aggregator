/**
 * 1. 检索 GitHub API (加入最新资源排序 + 401/403 智能兜底)
 */
async function fetchFromGitHub() {
  console.log('🔍 开始检索 GitHub Code Search API (按最新索引倒序)...');
  let results = [];
  
  // 核心改动：加入 sort=indexed&order=desc，强制按照最新被索引/修改的时间排序
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
      
      // 如果 Token 鉴权失败，自动切换为匿名抓取最新资源
      if (res.status === 401 || res.status === 403) {
        console.log(`  └─ ⚠️ Token 鉴权受限 (HTTP ${res.status})，自动切入匿名通道抓取最新资源...`);
        const anonymousRes = await fetch(url, { headers: { 'User-Agent': 'TVBox-Aggregator-Bot' } });
        if (anonymousRes.ok) {
          const data = await anonymousRes.json();
          const items = data.items || [];
          items.forEach(item => {
            const rawUrl = item.html_url.replace('https://github.com/', 'https://raw.githubusercontent.com/').replace('/blob/', '/');
            results.push(rawUrl);
          });
          console.log(`  └─ [最新资源] GitHub 第 ${page} 页检索到 ${items.length} 条数据`);
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
      console.log(`  └─ [最新资源] GitHub 第 ${page} 页检索到 ${items.length} 条数据`);
      if (items.length < 100) break;
      await sleep(1000); // 避免请求过快触发 rate limit
    } catch (e) {
      console.log(`  └─ GitHub 检索异常: ${e.message}`);
      break;
    }
  }
  return results;
}
