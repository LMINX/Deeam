const fs = require('fs');
let c = fs.readFileSync('index.html', 'utf8');

// Find and replace the corrupted room-info div
const oldPattern = '<div className="room-info">{((listing.name || \'\').match(/(\\d+?\\d+?/)?.[1] || (listing.area ? listing.area + \'?\' : \'??\'))}</div>';
const newContent = '<div className="room-info">{listing.area ? listing.area + \'㎡\' : \'查看\'}</div>';

c = c.replace(oldPattern, newContent);

// Also fix the earlier version if it exists
c = c.replace('<div className="room-info">{(listing.name || \'\').match(/(\\d+室\\d+厅/)?.[1] || (listing.area ? listing.area + \'㎡\' : \'查看\')}</div>', newContent);

fs.writeFileSync('index.html', c);
console.log('Fixed, new length:', c.length);

// Verify the fix
const idx = c.indexOf('room-info');
console.log('room-info at:', idx);
if(idx > -1) {
  console.log('Context:', c.substring(idx - 10, idx + 100));
}
