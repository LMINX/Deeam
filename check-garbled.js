// 检查 Supabase 数据库中的乱码房源数据
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

// 检测乱码的简单方法 - 检查是否包含常见乱码字符模式
function detectGarbled(text) {
  if (!text || typeof text !== 'string') return false;
  
  // 检测常见的乱码模式
  const garbledPatterns = [
    /\?{2,}/,           // 多个问号
    /\+/,
    /[\x00-\x08\x0B\x0C\x0E-\x1F]/,  // 控制字符
    /undefined/,        // 可能的 undefined 值
    /null/,             // 可能的 null 值
    /<[^>]+>/,          // HTML 标签乱入
    /\\u[0-9a-f]{4}/i,  // 未解码的 Unicode
    /\[object Object\]/, // 对象转字符串
    /^\s*\{.*\}\s*$/,   // 整个字符串是 JSON 对象
  ];
  
  // 检查是否有异常的中文字符范围之外的字符混在其中
  // 正常中文在 4e00-9fff 范围
  const hasSuspiciousChars = /[^\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\s\w\d，。！？、：；""''（）【】《》.,!?:\s\w\d'"-]/.test(text);
  
  // 检查是否太短或为空
  if (text.trim().length < 2) return true;
  
  // 检查是否包含 HTML 或代码
  if (/<[^>]*>/.test(text) && !/<a [^>]*href/.test(text)) return true;
  
  return garbledPatterns.some(p => p.test(text)) || hasSuspiciousChars;
}

// 更具体地检测乱码
function checkGarbledDetails(text) {
  const issues = [];
  
  if (!text) return issues;
  
  // 检查问号过多
  const questionMarks = (text.match(/\?/g) || []).length;
  if (questionMarks > text.length * 0.1) {
    issues.push(`问号过多: ${questionMarks}个`);
  }
  
  // 检查是否包含 [object Object]
  if (text.includes('[object Object]')) {
    issues.push('包含 [object Object]');
  }
  
  // 检查是否包含 undefined/null
  if (text.includes('undefined') || text === 'undefined') {
    issues.push('包含 undefined');
  }
  if (text.includes('null') || text === 'null') {
    issues.push('包含 null');
  }
  
  // 检查是否包含 HTML 标签（排除链接）
  if (/<(?!a |\/a>|\s)/.test(text)) {
    issues.push('包含可疑HTML标签');
  }
  
  // 检查是否有未解码的 Unicode
  if (/\\u[0-9a-f]{4}/i.test(text)) {
    issues.push('未解码的Unicode转义序列');
  }
  
  return issues;
}

async function checkListings() {
  console.log('🔍 开始检查 Supabase 数据库房源数据...\n');
  
  // 获取所有房源
  const listings = await querySupabase('listings', '?select=*&order=created_at.desc&limit=500');
  
  if (!Array.isArray(listings)) {
    console.error('❌ 查询失败:', listings);
    return;
  }
  
  console.log(`📊 总共 ${listings.length} 条房源记录\n`);
  
  // 检查乱码记录
  const garbledRecords = [];
  const cleanRecords = [];
  
  listings.forEach((listing, idx) => {
    const fieldsToCheck = ['name', 'community', 'address', 'title', 'description', 'layout'];
    const garbledFields = [];
    
    fieldsToCheck.forEach(field => {
      if (listing[field] && detectGarbled(listing[field])) {
        garbledFields.push(field);
      }
    });
    
    if (garbledFields.length > 0) {
      garbledRecords.push({
        id: listing.id,
        fields: garbledFields,
        data: garbledFields.reduce((acc, f) => ({ ...acc, [f]: listing[f] }), {})
      });
    } else {
      cleanRecords.push(listing.id);
    }
  });
  
  console.log('='.repeat(60));
  console.log('📋 乱码记录检查结果:');
  console.log(`   ✅ 正常记录: ${cleanRecords.length} 条`);
  console.log(`   ❌ 乱码记录: ${garbledRecords.length} 条`);
  console.log('='.repeat(60));
  
  if (garbledRecords.length > 0) {
    console.log('\n🔴 乱码详情:\n');
    garbledRecords.forEach((record, idx) => {
      console.log(`【记录 ${idx + 1}】ID: ${record.id}`);
      record.fields.forEach(field => {
        const value = record.data[field];
        const details = checkGarbledDetails(value);
        console.log(`  - ${field}: "${value}"`);
        if (details.length > 0) {
          console.log(`    问题: ${details.join(', ')}`);
        }
      });
      console.log('');
    });
  }
  
  // 分析乱码原因
  console.log('='.repeat(60));
  console.log('🔬 乱码原因分析:\n');
  
  const reasons = {
    '编码问题': 0,
    '源数据问题': 0,
    '空值/undefined': 0,
    '格式错误': 0
  };
  
  garbledRecords.forEach(record => {
    record.fields.forEach(field => {
      const value = record.data[field];
      if (value === null || value === undefined || value === '') {
        reasons['空值/undefined']++;
      } else if (value.includes('[object Object]') || value.includes('undefined')) {
        reasons['源数据问题']++;
      } else if (/\\u[0-9a-f]{4}/i.test(value)) {
        reasons['编码问题']++;
      } else {
        reasons['格式错误']++;
      }
    });
  });
  
  Object.entries(reasons).forEach(([reason, count]) => {
    console.log(`  - ${reason}: ${count} 处`);
  });
  
  return { total: listings.length, garbled: garbledRecords, clean: cleanRecords.length };
}

checkListings().then(result => {
  console.log('\n✅ 检查完成!');
  process.exit(0);
}).catch(err => {
  console.error('❌ 检查失败:', err);
  process.exit(1);
});