// 详细检查乱码房源并准备修复
const SUPABASE_URL = 'https://zojmkzwhyoxowssxkoko.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpvam1rendoeW94b3dzc3hrb2tvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3MzY4ODIsImV4cCI6MjA5MDMxMjg4Mn0.1vrlQlyL6kQ63Rc3G_otmTwIcqpGrQnZaFFMMou7bcE';

async function querySupabase(table, params = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  return res.json();
}

async function updateSupabase(table, data, conditions) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${conditions}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(data)
  });
  return res.json();
}

async function deleteSupabase(table, conditions) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${conditions}`, {
    method: 'DELETE',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  return res;
}

// 检测是否为垃圾/注入数据
function isGarbageData(text) {
  if (!text) return false;
  
  // 垃圾数据特征
  const garbagePatterns = [
    /和您偏好相似的用户还喜欢/,
    /懂得都懂/,
    /卖出难得一套/,
    /双规交通/,
    /广告|推广|推广房源/i,
    /购房指南|刚需上车|投资自住/i,
    /点击获取|立即联系|扫码/i,
    /房价走势|市场分析|购房攻略/i
  ];
  
  return garbagePatterns.some(p => p.test(text));
}

// 获取包含可疑模式的记录
async function findSuspiciousRecords() {
  console.log('🔍 搜索可疑房源数据...\n');
  
  const listings = await querySupabase('listings', '?select=*&limit=1000');
  
  if (!Array.isArray(listings)) {
    console.error('❌ 查询失败:', listings);
    return;
  }
  
  console.log(`📊 检查 ${listings.length} 条房源记录...\n`);
  
  const suspicious = [];
  const adPatterns = [];
  
  listings.forEach(listing => {
    const fields = ['name', 'community', 'address', 'title', 'description'];
    
    fields.forEach(field => {
      const value = listing[field];
      if (value && isGarbageData(value)) {
        if (!suspicious.find(s => s.id === listing.id)) {
          suspicious.push({
            id: listing.id,
            name: listing.name,
            community: listing.community,
            price: listing.price,
            area: listing.area,
            url: listing.url,
            created_at: listing.created_at
          });
        }
        adPatterns.push({ field, value: value.substring(0, 100) });
      }
    });
  });
  
  console.log('='.repeat(70));
  console.log('🚨 可疑记录分析:');
  console.log(`   发现 ${suspicious.length} 条可疑记录\n`);
  
  if (suspicious.length > 0) {
    console.log('📋 可疑记录详情:\n');
    suspicious.forEach((s, idx) => {
      console.log(`【${idx + 1}】 ID: ${s.id}`);
      console.log(`   小区: ${s.community || 'N/A'}`);
      console.log(`   名称: ${s.name || 'N/A'}`);
      console.log(`   价格: ${s.price || 'N/A'}`);
      console.log(`   面积: ${s.area || 'N/A'}`);
      console.log(`   URL: ${s.url || 'N/A'}`);
      console.log(`   时间: ${s.created_at || 'N/A'}`);
      console.log('');
    });
  }
  
  // 检查是否有重复记录
  console.log('='.repeat(70));
  console.log('🔄 重复记录检查:\n');
  
  const byKey = {};
  listings.forEach(l => {
    const key = (l.name || '') + '_' + (l.community || '') + '_' + (l.price || '');
    if (!byKey[key]) byKey[key] = [];
    byKey[key].push(l);
  });
  
  let duplicates = 0;
  Object.values(byKey).forEach(group => {
    if (group.length > 1) {
      duplicates++;
      console.log(`重复: ${group[0].name} x${group.length}, ID: ${group.map(l => l.id).join(', ')}`);
    }
  });
  
  console.log(`\n发现 ${duplicates} 组重复记录`);
  
  return suspicious;
}

// 检查数据质量总体情况
async function checkDataQuality() {
  console.log('📈 数据质量总览...\n');
  
  const listings = await querySupabase('listings', '?select=*&limit=1000');
  
  const stats = {
    total: listings.length,
    hasName: 0,
    hasCommunity: 0,
    hasPrice: 0,
    hasArea: 0,
    hasUrl: 0,
    emptyName: [],
    emptyCommunity: [],
    emptyPrice: [],
    emptyArea: []
  };
  
  listings.forEach(l => {
    if (l.name) stats.hasName++;
    else stats.emptyName.push(l.id);
    
    if (l.community) stats.hasCommunity++;
    else stats.emptyCommunity.push(l.id);
    
    if (l.price) stats.hasPrice++;
    else stats.emptyPrice.push(l.id);
    
    if (l.area) stats.hasArea++;
    else stats.emptyArea.push(l.id);
    
    if (l.url) stats.hasUrl++;
  });
  
  console.log('字段完整率:');
  console.log(`  - name: ${stats.hasName}/${stats.total} (${(stats.hasName/stats.total*100).toFixed(1)}%)`);
  console.log(`  - community: ${stats.hasCommunity}/${stats.total} (${(stats.hasCommunity/stats.total*100).toFixed(1)}%)`);
  console.log(`  - price: ${stats.hasPrice}/${stats.total} (${(stats.hasPrice/stats.total*100).toFixed(1)}%)`);
  console.log(`  - area: ${stats.hasArea}/${stats.total} (${(stats.hasArea/stats.total*100).toFixed(1)}%)`);
  console.log(`  - url: ${stats.hasUrl}/${stats.total} (${(stats.hasUrl/stats.total*100).toFixed(1)}%)`);
  
  return stats;
}

async function main() {
  await findSuspiciousRecords();
  console.log('\n' + '='.repeat(70) + '\n');
  await checkDataQuality();
}

main().then(() => {
  console.log('\n✅ 分析完成');
  process.exit(0);
}).catch(err => {
  console.error('❌ 失败:', err);
  process.exit(1);
});