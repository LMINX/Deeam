/**
 * 链家房源数据抓取脚本
 * 
 * 功能：
 * 1. 连接 Chrome CDP (localhost:9222)
 * 2. 找到已通过 CAPTCHA 验证的链家页面
 * 3. 从链家页面抓取房源数据
 * 4. 上传到 Supabase
 * 5. 遇到 CAPTCHA 时通过 Discord 通知用户
 * 
 * 抓取模式：
 *   --all (默认)    : 抓取所有区域，价格 ≤ 200万
 *   --tianshan2     : 只抓取天山二村，不限价格
 */

const { chromium } = require('playwright');
const { execSync } = require('child_process');
const https = require('https');
const net = require('net');

// ============ 抓取模式配置 ============
// 模式说明：
//   --all (默认) : 抓取所有区域，仅抓取价格 ≤ 200万的房源
//   --tianshan2  : 只抓取天山二村小区，不限制价格
const SCRAPE_MODE = process.argv.includes('--tianshan2') ? 'tianshan2' : 'all';
console.log(`筛选模式: ${SCRAPE_MODE}`);

// ============ 常量 ============
const SCRIPT_TIMEOUT = 15 * 60 * 1000;
const PAGE_TIMEOUT = 15 * 1000;
const CDP_URL = 'http://127.0.0.1:9222';
const SUPABASE_HOST = 'zojmkzwhyoxowssxkoko.supabase.co';
const CHROME_DEBUG_PORT = 9222;

// ============ Discord 通知 ============
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
const DISCORD_USER_ID = process.env.DISCORD_USER_ID || '1097013973779488798';

async function notifyCAPTCHA(message) {
  console.log('⚠️ CAPTCHA 检测到，正在通知用户...');
  try {
    if (!DISCORD_WEBHOOK_URL) {
      console.log('  (Discord webhook 未配置，跳过通知)');
      return false;
    }
    const webhookBody = JSON.stringify({
      content: `<@${DISCORD_USER_ID}> ${message}`
    });
    
    const url = new URL(DISCORD_WEBHOOK_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(webhookBody)
      }
    };
    
    return new Promise((resolve) => {
      const req = https.request(options, (res) => {
        resolve(res.statusCode === 204 || res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.write(webhookBody);
      req.end();
    });
  } catch (e) {
    return false;
  }
}

// ============ Chrome 检测 ============
function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => { socket.destroy(); resolve(false); });
    socket.connect(port, host);
  });
}

async function ensureChromeRunning() {
  const isReady = await isPortOpen(CHROME_DEBUG_PORT);
  if (isReady) {
    console.log('✓ Chrome 调试端口已就绪');
    return true;
  }
  console.log('✗ Chrome 未运行，请手动启动 Chrome-Lianjia');
  return false;
}

// ============ 验证函数 ============
function isValidListing(listing) {
  if (!listing || !listing.name) return false;
  if (listing.name.includes('\ufffd') || listing.name.includes('?')) return false;
  if (listing.name.trim().length < 5) return false;
  return true;
}

// ============ CAPTCHA 检测 ============
async function detectCAPTCHA(page) {
  try {
    const pageText = await page.evaluate(() => document.body ? document.body.innerText : '');
    
    // 如果有验证码文字并且没有房源数据（万/平米），认为是 CAPTCHA
    const hasCaptchaText = /验证码|人机验证|请完成验证/i.test(pageText);
    const hasListing = pageText.includes('万') && pageText.includes('平米');
    
    if (hasCaptchaText && !hasListing) {
      return true;
    }
    
    // 如果能提取到有效房源数据，认为不是 CAPTCHA
    const listings = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('li').forEach(li => {
        const text = li.textContent || '';
        if (text.includes('万') && text.includes('平米')) {
          results.push(text);
        }
      });
      return results;
    });
    
    if (listings.length > 0) {
      console.log(`  (页面有 ${listings.length} 条数据，无 CAPTCHA)`);
      return false;
    }
    
    return hasCaptchaText;
  } catch (e) {
    return false;
  }
}

// ============ 上传 Supabase ============
function uploadToSupabase(listings) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(listings);
    
    const options = {
      hostname: SUPABASE_HOST,
      path: '/rest/v1/listings',
      method: 'POST',
      headers: {
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpvam1rendoeW94b3dzc3hrb2tvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3MzY4ODIsImV4cCI6MjA5MDMxMjg4Mn0.1vrlQlyL6kQ63Rc3G_otmTwIcqpGrQnZaFFMMou7bcE',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpvam1rendoeW94b3dzc3hrb2tvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3MzY4ODIsImV4cCI6MjA5MDMxMjg4Mn0.1vrlQlyL6kQ63Rc3G_otmTwIcqpGrQnZaFFMMou7bcE',
        'Content-Type': 'application/json',
        'Prefer': 'resolution=minimal'
      }
    };
    
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ============ 提取单页数据 ============
async function extractFromPage(page, district, scrapeMode) {
  if (await detectCAPTCHA(page)) {
    return { success: false, error: 'CAPTCHA_DETECTED', listings: [] };
  }
  
  try {
    await page.bringToFront();
    
    const result = await Promise.race([
      page.evaluate(async (dist, mode) => {
        return new Promise((resolve) => {
          setTimeout(() => {
            try {
              const results = [];
              const seen = new Set();
              
              document.querySelectorAll('li').forEach(li => {
                const text = li.textContent || '';
                if (!text.includes('万') || !text.includes('平米')) return;
                
                const link = li.querySelector('a[href*="/ershoufang/"]');
                if (!link) return;
                
                const href = link.href;
                if (seen.has(href)) return;
                seen.add(href);
                
                const idMatch = href.match(/\/ershoufang\/(\d+)\.html/);
                if (!idMatch || idMatch[1].length < 10) return;

                const rawName = text.split('|')[0].trim().substring(0, 60);
                const name = rawName.replace(/\ufffd/g, '').replace(/\?/g, '').trim();
                if (!name || name.length < 5) return;

                const priceMatch = text.match(/(\d+)\s*万/);
                if (!priceMatch) return;
                
                // 价格筛选：默认模式只抓200万以下，天山二村模式不限制价格
                const price = parseInt(priceMatch[1], 10);
                const isTianshan2Mode = (mode === 'tianshan2');
                if (!isTianshan2Mode && price > 200) return;
                
                results.push({
                  listing_id: idMatch[1],
                  name: name,
                  area: (text.match(/(\d+\.?\d*)\s*平米/) || ['', ''])[1],
                  price: priceMatch[1],
                  unit_price: '',
                  floor: (text.match(/(低|中|高)楼层/) || ['', ''])[0],
                  year_build: (text.match(/(\d{4})年/) || ['', ''])[1],
                  tags: '',
                  district: dist,
                  url: href,
                  scraped_at: new Date().toISOString()
                });
              });
              
              resolve({ success: true, listings: results.slice(0, 30) });
            } catch (e) {
              resolve({ success: false, error: e.message });
            }
          }, 500);
        });
      }, district, SCRAPE_MODE),
      new Promise(resolve => setTimeout(() => resolve({ success: false, error: 'Page timeout' }), PAGE_TIMEOUT))
    ]);
    
    return result || { success: false, error: 'No result', listings: [] };
  } catch (e) {
    return { success: false, error: e.message, listings: [] };
  }
}

// ============ 主函数 ============
async function main() {
  console.log('=== 链家数据抓取开始 ===');
  console.log(`时间: ${new Date().toISOString()}`);
  
  let browser;
  let success = false;
  
  try {
    console.log(`检查 Chrome 调试端口 (${CDP_URL})...`);
    if (!await ensureChromeRunning()) {
      console.log('请先运行 Chrome-Lianjia 快捷方式');
      process.exit(1);
    }

    console.log(`连接 Chrome CDP (${CDP_URL})...`);
    browser = await chromium.connectOverCDP(CDP_URL, { timeout: 10000 });
    console.log('✓ 已连接');
    
    const context = browser.contexts()[0];
    const pages = context.pages();
    console.log(`找到 ${pages.length} 个页面`);
    
    let totalListings = [];
    let foundValidPage = false;
    
    // Find a valid Lianjia page (not CAPTCHA)
    for (const page of pages) {
      const url = page.url();
      
      if (!url.includes('lianjia.com/ershoufang')) {
        continue;
      }
      
      if (url.includes('captcha')) {
        console.log('发现 CAPTCHA 页面，跳过');
        continue;
      }
      
      // 根据筛选模式判断区域和是否需要抓取
      let district = '未知';
      let shouldScrape = false;
      const decodedUrl = decodeURIComponent(url);
      
      if (SCRAPE_MODE === 'tianshan2') {
        // ===== 天山二村模式 =====
        // 目标：只抓取天山二村的房源，不限制价格
        // 
        // 匹配天山二村URL的多种形式：
        //   - /ershoufang/rs天山二村/     → 直接搜索
        //   - /ershoufang/rs%E5%A4%A9... → URL编码形式 (rs天山二村)
        //   - /ershoufang/rs%E5%A4%A9%E5%B1%B1%E4%BA%8C%E6%9D%91 → 完整URL编码
        //   - /ershoufang/tianshan2   → 拼音形式
        //   - ?community=天山二村    → 参数形式
        //   - /ershoufang/rs开头 + 天山二村编码 → 搜索结果页
        const isTianshan2 = 
          decodedUrl.includes('天山二村') ||                    // 解码后中文
          url.includes('%E5%A4%A9%E5%B1%B1%E4%BA%8C%E6%9D%91') ||  // 完整URL编码
          url.includes('tianshan2') ||                            // 拼音
          url.includes('community=天山') ||                       // 参数
          decodedUrl.includes('community=天山') ||
          (url.includes('/ershoufang/rs') && url.includes('%E5%A4%A9')); // rs搜索页 + 天
        
        if (isTianshan2) {
          district = '天山二村';
          shouldScrape = true;
        }
      } else {
        // ===== 默认模式 (--all) =====
        // 目标：抓取所有区域，仅限制价格 ≤ 200万
        // 区域判断：包含天山/天 → 天山二村，否则 → 娄山关路
        const isTianshan = 
          decodedUrl.includes('天山') || 
          decodedUrl.includes('tian Shan') ||
          decodedUrl.includes('tianshan') ||
          url.includes('rs%E5%A4%A9');  // rs+天 (搜索前缀)
        district = isTianshan ? '天山二村' : '娄山关路';
        shouldScrape = true;
      }
      
      if (!shouldScrape) {
        console.log(`  -> 跳过（不符合筛选条件）`);
        continue;
      }
      
      console.log(`\n使用页面: ${url.substring(0, 70)}`);
      
      if (await detectCAPTCHA(page)) {
        console.log('页面有 CAPTCHA，需要人工验证');
        continue;
      }
      
      const result = await extractFromPage(page, district, SCRAPE_MODE);
      
      if (result.success) {
        if (result.listings.length > 0) {
          console.log(`✓ 获取到 ${result.listings.length} 条数据`);
          totalListings.push(...result.listings);
          foundValidPage = true;
        } else {
          console.log('⚠️ 页面无数据');
        }
      } else if (result.error === 'CAPTCHA_DETECTED') {
        console.log('⚠️ CAPTCHA 检测到');
      } else {
        console.log(`✗ 处理失败: ${result.error}`);
      }
    }
    
    // If no valid page found, show message
    if (!foundValidPage) {
      console.log('\n⚠️ 未找到已通过验证的链家页面');
      console.log('请在 Chrome 中打开链家页面并完成 CAPTCHA 验证，然后保持该页面打开');
      await notifyCAPTCHA('⚠️ **链家抓取任务失败**：未找到已验证的页面。\n请打开 Chrome-Lianjia，完成 CAPTCHA 验证，并保持页面打开。');
      process.exit(1);
    }
    
    console.log(`\n=== 总计: ${totalListings.length} 条房源 ===`);
    
    const validListings = totalListings.filter(isValidListing);
    if (validListings.length < totalListings.length) {
      console.log(`过滤掉 ${totalListings.length - validListings.length} 条乱码数据`);
    }
    
    if (validListings.length > 0) {
      console.log('上传到 Supabase...');
      const uploadResult = await uploadToSupabase(validListings);
      
      if (uploadResult.status === 201 || uploadResult.status === 200) {
        console.log(`✓ 上传成功 (${uploadResult.status})`);
        success = true;
      } else {
        console.log(`✗ 上传失败: ${uploadResult.status}`);
      }
    } else {
      console.log('无可上传数据');
    }
    
  } catch (e) {
    console.error('错误:', e.message);
    
  } finally {
    if (browser) {
      try { await browser.close(); } catch (e) {}
    }
  }
  
  console.log('\n=== 抓取' + (success ? '成功' : '失败') + ' ===');
  process.exit(success ? 0 : 1);
}

// ============ 启动 ============
const timeout = setTimeout(() => {
  console.log('\n=== 脚本超时 (15分钟)，强制结束 ===');
  process.exit(1);
}, SCRIPT_TIMEOUT);

main()
  .then(() => { clearTimeout(timeout); process.exit(0); })
  .catch((e) => {
    console.error('Fatal error:', e.message);
    clearTimeout(timeout);
    process.exit(1);
  });
