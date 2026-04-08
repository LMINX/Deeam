// 清理 Deeam 项目中的乱码和重复房源数据
const SUPABASE_URL = 'https://zojmkzwhyoxowssxkoko.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpvam1rendoeW94b3dzc3hrb2tvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3MzY4ODIsImV4cCI6MjA5MDMxMjg4Mn0.1vrlQlyL6kQ63Rc3G_otmTwIcqpGrQnZaFFMMou7bcE';

// 垃圾数据特征
const GARBAGE_PATTERNS = [
  '和您偏好相似的用户还喜欢',
  '懂得都懂',
  '卖出难得一套',
  '双规交通',  // 应该是"双轨"
  '广告|推广|推广房源',
  '购房指南|刚需上车|投资自住',
  '点击获取|立即联系|扫码',
  '房价走势|市场分析|购房攻略',
  '关注度较高房源',
  '附近房源',
  '房主自荐',  // 这些通常是完整描述，不是标题
];

const GARBAGE_REGEX = new RegExp(GARBAGE_PATTERNS.join('|'), 'i');

// 判断是否为垃圾数据
function isGarbage(name) {
  if (!name) return false;
  return GARBAGE_REGEX.test(name);
}

// 获取所有记录
async function getAllListings() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/listings?select=*&limit=2000`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    }
  });
  return res.json();
}

// 删除记录
async function deleteRecord(id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/listings?id=eq.${id}`, {
    method: 'DELETE',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    }
  });
  return res.status === 204 || res.status === 200;
}

// 按 name+price+area 去重，保留最新的一条
function findDuplicates(listings) {
  const groups = {};
  
  listings.forEach(l => {
    const key = `${l.name}_${l.price}_${l.area}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(l);
  });
  
  const toDelete = [];
  Object.entries(groups).forEach(([key, records]) => {
    if (records.length > 1) {
      // 按 created_at 排序，最新的保留
      records.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      // 删除除第一个外的所有
      toDelete.push(...records.slice(1).map(r => r.id));
    }
  });
  
  return toDelete;
}

async function main() {
  console.log('🧹 开始清理 Deeam 房源数据...\n');
  
  // 获取所有记录
  console.log('📥 获取所有房源记录...');
  const listings = await getAllListings();
  
  if (!Array.isArray(listings)) {
    console.error('❌ 获取数据失败:', listings);
    return;
  }
  
  console.log(`   共 ${listings.length} 条记录\n`);
  
  // 1. 找出垃圾数据
  console.log('🔍 步骤1: 识别垃圾数据...');
  const garbageIds = [];
  const garbageDetails = [];
  
  listings.forEach(l => {
    if (isGarbage(l.name)) {
      garbageIds.push(l.id);
      garbageDetails.push({ id: l.id, name: l.name, url: l.url });
    }
  });
  
  console.log(`   发现 ${garbageIds.length} 条垃圾记录`);
  
  // 2. 找出重复数据
  console.log('\n🔍 步骤2: 识别重复数据...');
  const duplicateIds = findDuplicates(listings);
  console.log(`   发现 ${duplicateIds.length} 条重复记录`);
  
  // 3. 合并要删除的 ID（去重）
  const allToDelete = [...new Set([...garbageIds, ...duplicateIds])];
  console.log(`\n📊 总计需要删除: ${allToDelete.length} 条记录`);
  console.log(`   - 垃圾数据: ${garbageIds.length} 条`);
  console.log(`   - 重复数据: ${duplicateIds.length} 条（其中 ${duplicateIds.filter(id => garbageIds.includes(id)).length} 条已在垃圾数据中）`);
  
  // 4. 执行删除
  if (allToDelete.length > 0) {
    console.log('\n🗑️  开始删除...');
    let deleted = 0;
    let failed = 0;
    
    // 批量删除（每批50条）
    const batchSize = 50;
    for (let i = 0; i < allToDelete.length; i += batchSize) {
      const batch = allToDelete.slice(i, i + batchSize);
      const idsStr = batch.join(',');
      
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/listings?id=in.(${idsStr})`, {
          method: 'DELETE',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          }
        });
        
        if (res.status === 204 || res.status === 200) {
          deleted += batch.length;
        } else {
          failed += batch.length;
          console.log(`   删除失败 batch ${i/batchSize + 1}`);
        }
      } catch (e) {
        failed += batch.length;
        console.log(`   删除错误: ${e.message}`);
      }
      
      // 进度
      process.stdout.write(`\r   进度: ${Math.min(i + batchSize, allToDelete.length)}/${allToDelete.length}`);
    }
    
    console.log(`\n\n✅ 删除完成: 成功 ${deleted} 条, 失败 ${failed} 条`);
  }
  
  // 5. 显示垃圾数据详情
  if (garbageDetails.length > 0) {
    console.log('\n📋 垃圾数据示例:');
    garbageDetails.slice(0, 5).forEach(g => {
      console.log(`   ID ${g.id}: ${g.name.substring(0, 60)}...`);
    });
    if (garbageDetails.length > 5) {
      console.log(`   ... 还有 ${garbageDetails.length - 5} 条`);
    }
  }
  
  // 6. 验证结果
  console.log('\n🔄 验证清理结果...');
  const remaining = await getAllListings();
  console.log(`   清理后剩余: ${remaining.length} 条记录`);
  
  // 7. 检查 community 字段问题
  console.log('\n🔍 检查 community 字段...');
  const hasCommunity = remaining.filter(l => l.community && l.community.trim().length > 0);
  console.log(`   有 community 数据的: ${hasCommunity.length} 条`);
  
  // 检查是否有 community 信息在 name 中
  const nameHasCommunity = remaining.filter(l => l.name && l.name.includes('小区'));
  console.log(`   name 中包含"小区"的: ${nameHasCommunity.length} 条`);
}

main()
  .then(() => {
    console.log('\n✅ 清理完成!');
    process.exit(0);
  })
  .catch(err => {
    console.error('\n❌ 清理失败:', err);
    process.exit(1);
  });