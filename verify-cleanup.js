// 验证清理后的数据状态
const SUPABASE_URL = 'https://zojmkzwhyoxowssxkoko.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpvam1rendoeW94b3dzc3hrb2tvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3MzY4ODIsImV4cCI6MjA5MDMxMjg4Mn0.1vrlQlyL6kQ63Rc3G_otmTwIcqpGrQnZaFFMMou7bcE';

async function getAllListings() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/listings?select=*&order=created_at.desc&limit=500`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    }
  });
  return res.json();
}

async function updateListing(id, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/listings?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data)
  });
  return res.json();
}

async function main() {
  console.log('📊 清理后数据验证...\n');
  
  const listings = await getAllListings();
  
  if (!Array.isArray(listings)) {
    console.error('获取失败:', listings);
    return;
  }
  
  console.log(`总记录数: ${listings.length}`);
  
  // 检查字段完整性
  const stats = {
    hasName: 0,
    hasCommunity: 0,
    hasDistrict: 0,
    hasUrl: 0,
    hasLayout: 0,
    hasPrice: 0,
    hasArea: 0,
  };
  
  listings.forEach(l => {
    if (l.name) stats.hasName++;
    if (l.community) stats.hasCommunity++;
    if (l.district) stats.hasDistrict++;
    if (l.url) stats.hasUrl++;
    if (l.layout) stats.hasLayout++;
    if (l.price) stats.hasPrice++;
    if (l.area) stats.hasArea++;
  });
  
  console.log('\n字段完整性:');
  Object.entries(stats).forEach(([key, val]) => {
    const pct = ((val / listings.length) * 100).toFixed(1);
    console.log(`  ${key}: ${val}/${listings.length} (${pct}%)`);
  });
  
  // 检查重复情况
  const byKey = {};
  listings.forEach(l => {
    const key = `${l.name}_${l.price}_${l.area}`;
    if (!byKey[key]) byKey[key] = 0;
    byKey[key]++;
  });
  
  const duplicates = Object.values(byKey).filter(c => c > 1).length;
  console.log(`\n重复组数: ${duplicates}`);
  
  // 检查垃圾数据残留
  const garbageTerms = ['和您偏好', '关注度较高', '房主自荐', '懂得都懂', '双规交通'];
  const hasGarbage = listings.filter(l => 
    garbageTerms.some(t => (l.name || '').includes(t))
  );
  console.log(`垃圾数据残留: ${hasGarbage.length} 条`);
  
  if (hasGarbage.length > 0) {
    console.log('\n残留垃圾数据示例:');
    hasGarbage.slice(0, 3).forEach(l => {
      console.log(`  ID ${l.id}: ${l.name}`);
    });
  }
  
  // 显示示例数据
  console.log('\n📋 数据示例:');
  listings.slice(0, 5).forEach(l => {
    console.log(`\n  ID: ${l.id}`);
    console.log(`  name: ${l.name}`);
    console.log(`  community: ${l.community || '(空)'}`);
    console.log(`  district: ${l.district || '(空)'}`);
    console.log(`  price: ${l.price}万`);
    console.log(`  area: ${l.area}㎡`);
    console.log(`  layout: ${l.layout || '(空)'}`);
  });
}

main()
  .then(() => {
    console.log('\n✅ 验证完成');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ 失败:', err);
    process.exit(1);
  });