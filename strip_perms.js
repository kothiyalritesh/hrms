const fs = require("fs");
let code = fs.readFileSync("screens/admin/AdminDashboardScreen.tsx", "utf-8");

// Strip all hasPermission wrappers entirely
code = code.replace(/\{hasPermission\("[^"]+"\)\s*&&\s*\(\s*(\{hasPermission[^>]+)\s*\)\}/g, "$1");
code = code.replace(/\{hasPermission\("[^"]+"\)\s*&&\s*\(\s*(<ActionCard[^>]+>|<\/ActionCard>|<ActionCard[^>]+\/>)\s*\)\}/g, "$1");
code = code.replace(/\{hasPermission\("[^"]+"\)\s*&&\s*\(\s*(<ActionCard[^>]+>|<\/ActionCard>|<ActionCard[^>]+\/>)\s*\)\}/g, "$1"); // run again for doubles
code = code.replace(/\{hasPermission\("[^"]+"\)\s*&&\s*\(\s*(<ActionCard[^>]+>|<\/ActionCard>|<ActionCard[^>]+\/>)\s*\)\}/g, "$1");
code = code.replace(/\{hasPermission\("[^"]+"\)\s*&&\s*\(\s*(<ActionCard[^>]+>|<\/ActionCard>|<ActionCard[^>]+\/>)\s*\)\}/g, "$1");

fs.writeFileSync("screens/admin/AdminDashboardScreen.tsx", code);
console.log("Stripped hasPermission");
