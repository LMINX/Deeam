/**
 * 链家房源数据抓取脚本 - Raw CDP版本
 */

const http = require('http');
const { WebSocket } = require('ws');
const https = require('https');

// ============ 常量 ============
const SCRIPT_TIMEOUT = 15 * 60 * 1000;
const PAGE_TIMEOUT = 15 * 1000;
const CDP_URL = 'http://127.0.0.1:9222';
const SUPABASE_HOST = 'zojmkzwhyoxowssxkoko.supabase.co';

// ============ Discord 通知 ============
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
const DISCORD_USER_ID = process.env.DISCORD_USER_ID || '1097013973779488798';

// ============ Raw CDP Client ============
class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.msgId = 0;
    this.pending = new Map();
    this.handlers = new Map();
    
    this.ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        resolve(msg.result || msg);
      } else if (msg.method && this.handlers.has(msg.method)) {
        this.handlers.get(msg.method)(msg.params);
      }
    });
  }
  
  connect() {
    return new Promise((resolve, reject) => {
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
    });
  }
  
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 15000);
    });
  }
  
  on(method, handler) {
    this.handlers.set(method, handler);
  }
  
  close() {
    this.ws.close();
  }
}

// ============ 辅助函数 ============
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

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
      const req = https.request(options, (res) => resolve(res.statusCode === 204 || res.statusCode === 200));
      req.on('error', () => resolve(false));
      req.write(webhookBody);
      req.end();
    });
  } catch (e) {
    return false;
  }
}

function isValidListing(listing) {
  if (!listing || !listing.name) return false;
  if (listing.name.includes('\ufffd') || listing.name.includes('?')) return false;
  if (listing.name.trim().length < 5) return false;
  return true;
}

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

// ============ 提取数据 ============
async function extractFromPage(cdp, pageId, district) {
  try {
    // Detect CAPTCHA
    const pageTextResult = await cdp.send('Runtime.evaluate', {
      expression: 'document.body ? document.body.innerText : ""',
      returnByValue: true
    });
    
    const pageText = pageTextResult.result.value || '';
    const hasCaptchaText = /验证码|人机验证|请完成验证/i.test(pageText);
    const hasListing = pageText.includes('万') && pageText.includes('平米');
    
    if (hasCaptchaText && !hasListing) {
      return { success: false, error: 'CAPTCHA_DETECTED', listings: [] };
    }
    
    // Extract listings
    const extractResult = await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
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
                  
                  const idMatch = href.match(/\\/ershoufang\\/(\\d+)\\.html/);
                  if (!idMatch || idMatch[1].length < 10) return;

                  const regionEl = li.querySelector('[data-el="region"]');
                  let community = '';
                  if (regionEl) {
                    community = regionEl.textContent || '';
                  }
                  community = community.replace(/\\ufffd/g, '').replace(/\\?/g, '').trim();

                  const rawName = text.split('|')[0].trim().substring(0, 60);
                  const name = rawName.replace(/\\ufffd/g, '').replace(/\\?/g, '').trim();
                  if (!name || name.length < 5) return;

                  const priceMatch = text.match(/(\\d+)\\s*万/);
                  if (!priceMatch) return;
                  
                  results.push({
                    listing_id: idMatch[1],
                    name: name,
                    community: community,
                    area: (text.match(/(\\d+\\.?\\d*)\\s*平米/) || ['', ''])[1],
                    price: priceMatch[1],
                    unit_price: '',
                    floor: (text.match(/(低|中|高)楼层/) || ['', ''])[0],
                    year_build: (text.match(/(\\d{4})年/) || ['', ''])[1],
                    tags: '',
                    district: '${district}',
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
        })()
      `,
      returnByValue: true
    });
    
    const value = extractResult.result.value;
    if (value && value.success) {
      return value;
    } else {
      return { success: false, error: value?.error || 'Extract failed', listings: [] };
    }
    
  } catch (e) {
    return { success: false, error: e.message, listings: [] };
  }
}

// ============ 主函数 ============
async function main() {
  console.log('=== 链家数据抓取开始 (Raw CDP) ===');
  console.log(`时间: ${new Date().toISOString()}`);
  
  let success = false;
  
  try {
    // Get pages from Chrome
    console.log(`检查 Chrome (${CDP_URL})...`);
    const json = await fetchJSON(`${CDP_URL}/json`);
    console.log(`找到 ${json.length} 个页面`);
    
    let totalListings = [];
    let foundValidPage = false;
    
    for (const page of json) {
      const url = page.url;
      console.log(`\n检查页面: ${url.substring(0, 70)}`);
      
      if (!url.includes('lianjia.com/ershoufang')) {
        console.log('  -> 非链家房源页面，跳过');
        continue;
      }
      
      if (url.includes('captcha')) {
        console.log('  -> CAPTCHA 页面，跳过');
        continue;
      }
      
      const isTianshan = url.includes('天山') || url.includes('tianshan') || url.includes('rs%E5%A4%A9');
      const district = isTianshan ? '天山二村' : '娄山关路';
      
      // Connect via WebSocket
      const cdp = new CDPClient(page.webSocketDebuggerUrl);
      await cdp.connect();
      console.log('  -> CDP 已连接');
      
      const result = await extractFromPage(cdp, page.id, district);
      cdp.close();
      
      if (result.success) {
        if (result.listings.length > 0) {
          console.log(`  -> ✓ 获取到 ${result.listings.length} 条数据`);
          totalListings.push(...result.listings);
          foundValidPage = true;
        } else {
          console.log('  -> ⚠️ 页面无数据');
        }
      } else if (result.error === 'CAPTCHA_DETECTED') {
        console.log('  -> ⚠️ CAPTCHA 检测到');
      } else {
        console.log(`  -> ✗ 处理失败: ${result.error}`);
      }
    }
    
    if (!foundValidPage) {
      console.log('\n⚠️ 未找到已通过验证的链家页面');
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
        console.log(`✗ 上传失败: ${uploadResult.status} - ${uploadResult.body}`);
      }
    } else {
      console.log('无可上传数据');
    }
    
  } catch (e) {
    console.error('错误:', e.message);
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