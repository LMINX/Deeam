// 彻底清理所有垃圾数据
const SUPABASE_URL = 'https://zojmkzwhyoxowssxkoko.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpvam1rendoeW94b3dzc3hrb2tvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3MzY4ODIsImV4cCI6MjA5MDMxMjg4Mn0.1vrlQlyL6kQ63Rc3G_otmTwIcqpGrQnZaFFMMou7bcE';

async function querySupabase(table, params = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    }
  });
  return res.json();
}

// 更严格的垃圾数据模式
const GARBAGE_PATTERNS = [
  '和您偏好相似的用户还喜欢',
  '懂得都懂',
  '双规交通',  // 错误应该是双轨
  '中山公园区域关注度较高房源',
  '紫云小区附近房源',
  '虹桥区域关注度较高房源',
  '天山区域关注度较高房源',
  '仙霞区域关注度较高房源',
  '附近房源',
  '房主自荐',  // 单独出现时
  '广告',
  '推广',
];

function isGarbage(name) {
  if (!name) return false;
  
  // 如果包含"房主自荐"且前面还有一堆描述，那很可能是垃圾
  if (name.includes('房主自荐') && name.indexOf('房主自荐') > 30) {
    return true;
  }
  
  // "和您偏好相似" 直接就是垃圾
  if (name.includes('和您偏好相似的用户还喜欢')) {
    return true;
  }
  
  // "关注度较高房源" 也是垃圾
  if (name.includes('关注度较高房源')) {
    return true;
  }
  
  // "双规交通" 是错误写法
  if (name.includes('双规交通')) {
    return true;
  }
  
  return false;
}

async function main() {
  console.log('🧹 彻底清理垃圾数据...\n');
  
  // 获取所有记录（增加限制）
  console.log('📥 获取所有房源...');
  let allListings = [];
  let offset = 0;
  const limit = 1000;
  
  while (true) {
    const listings = await querySupabase(`listings?select=*&limit=${limit}&offset=${offset}`);
    if (!Array.isArray(listings) || listings.length === 0) break;
    allListings.push(...listings);
    if (listings.length < limit) break;
    offset += limit;
  }
  
  console.log(`   共 ${allListings.length} 条记录`);
  
  // 找出垃圾数据
  const garbageRecords = allListings.filter(l => isGarbage(l.name));
  console.log(`\n🔍 发现 ${garbageRecords.length} 条垃圾数据`);
  
  if (garbageRecords.length > 0) {
    // 显示示例
    console.log('\n垃圾数据示例:');
    garbageRecords.slice(0, 10).forEach(r => {
      console.log(`  ID ${r.id}: ${r.name.substring(0, 80)}...`);
    });
    
    // 删除
    console.log('\n🗑️  删除中...');
    const ids = garbageRecords.map(r => r.id);
    
    let deleted = 0;
    const batchSize = 50;
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      const idsStr = batch.join(',');
      
      const res = await fetch(`${SUPABASE_URL}/rest/v1/listings?id=in.(${idsStr})`, {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        }
      });
      
      if (res.status === 204 || res.status === 200) {
        deleted += batch.length;
      }
      process.stdout.write(`\r   ${Math.min(i + batchSize, ids.length)}/${ids.length}`);
    }
    
    console.log(`\n\n✅ 删除了 ${deleted} 条垃圾数据`);
  }
  
  // 检查重复
  console.log('\n🔄 检查重复...');
  const byKey = {};
  allListings.forEach(l => {
    if (!garbageRecords.find(g => g.id === l.id)) {
      const key = `${l.name}_${l.price}_${l.area}`;
      if (!byKey[key]) byKey[key] = [];
      byKey[key].push(l);
    }
  });
  
  const duplicates = [];
  Object.entries(byKey).forEach(([key, records]) => {
    if (records.length > 1) {
      records.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      duplicates.push(...records.slice(1).map(r => r.id));
    }
  });
  
  console.log(`   发现 ${duplicates.length} 条重复记录`);
  
  if (duplicates.length > 0) {
    // 删除重复（保留最新）
    let deletedDup = 0;
    const batchSize = 50;
    for (let i = 0; i < duplicates.length; i += batchSize) {
      const batch = duplicates.slice(i, i + batchSize);
      const idsStr = batch.join(',');
      
      const res = await fetch(`${SUPABASE_URL}/rest/v1/listings?id=in.(${idsStr})`, {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        }
      });
      
      if (res.status === 204 || res.status === 200) {
        deletedDup += batch.length;
      }
      process.stdout.write(`\r   删除重复: ${Math.min(i + batchSize, duplicates.length)}/${duplicates.length}`);
    }
    console.log(`\n   删除了 ${deletedDup} 条重复记录`);
  }
  
  // 最终验证
  console.log('\n🔄 最终验证...');
  const remaining = await querySupabase('listings?select=*&limit=500');
  console.log(`   剩余记录: ${remaining.length} 条`);
  
  const stillGarbage = remaining.filter(l => isGarbage(l.name));
  console.log(`   垃圾残留: ${stillGarbage.length} 条`);
  
  if (stillGarbage.length > 0) {
    console.log('\n⚠️ 仍有垃圾数据，需要再次清理');
    stillGarbage.forEach(r => console.log(`  ID ${r.id}: ${r.name}`));
  }
}

main()
  .then(() => {
    console.log('\n✅ 清理完成');
    process.exit(0);
  })
  .catch(err => {
    console.error('\n❌ 失败:', err);
    process.exit(1);
  });