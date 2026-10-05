const fs = require("fs");
let code = fs.readFileSync("screens/admin/AdminDashboardScreen.tsx", "utf-8");
code = code.replace(/icon="file-text"/, `icon="file-text"\n              accent="#9CA3AF"`);
fs.writeFileSync("screens/admin/AdminDashboardScreen.tsx", code);
