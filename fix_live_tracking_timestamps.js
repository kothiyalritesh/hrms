const fs = require('fs');
const file = 'screens/admin/LiveTrackingScreen.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Normalize the official_first_in fallback
content = content.replace(
  /recorded_at: ping\?\.recorded_at \?\? row\.official_first_in,/,
  `recorded_at: ping?.recorded_at ?? (row.official_first_in && !row.official_first_in.includes('+') && !row.official_first_in.endsWith('Z') ? row.official_first_in.replace(' ', 'T') + '+05:30' : row.official_first_in),`
);

// 2. Wrap parseDatabaseTimestamp in try/catch in loadData
content = content.replace(
  /const pingTimestamp = e\.recorded_at\s*\?\s*parseDatabaseTimestamp\(e\.recorded_at\)\.getTime\(\)\s*:\s*null;/,
  `let pingTimestamp = null;
          if (e.recorded_at) {
            try { pingTimestamp = parseDatabaseTimestamp(e.recorded_at).getTime(); } catch (err) {}
          }`
);

// 3. Guard parseDatabaseTimestamp in timeAgo and isGpsTrulyOff
content = content.replace(
  /const pingTime = parseDatabaseTimestamp\(emp\.recorded_at\)\.getTime\(\);/g,
  `let pingTime = 0; try { pingTime = parseDatabaseTimestamp(emp.recorded_at).getTime(); } catch (err) { return false; }`
);

content = content.replace(
  /const t = parseDatabaseTimestamp\(timestamp\)\.getTime\(\);/,
  `let t = 0; try { t = parseDatabaseTimestamp(timestamp).getTime(); } catch (err) { return "Unknown"; }`
);

fs.writeFileSync(file, content);
