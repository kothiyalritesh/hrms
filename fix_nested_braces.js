const fs = require("fs");
let code = fs.readFileSync("screens/admin/AdminDashboardScreen.tsx", "utf-8");

const perms = [
  "SYSTEM_ADMIN", "screen.live_tracking", "screen.check_in_logs",
  "screen.office_settings", "screen.site_settings", "screen.notification_management", "screen.audit_logs"
];

for (const p of perms) {
  code = code.replace(new RegExp(`\\{hasPermission\\("${p}"\\) && \\(\\{isHRD && \\(`, "g"), `{hasPermission("${p}") && (`);
}

// Clean up double closing braces from my nested match
code = code.replace(/\)\s*\)\}\)/g, `)}`);
// Actually, the end of the match was \s*\)\} which got wrapped in )} so it became \s*\)\})}
code = code.replace(/\s*\)\}\)/g, `)}`);
code = code.replace(/\s*\)\}\}/g, `)}`); // just in case

fs.writeFileSync("screens/admin/AdminDashboardScreen.tsx", code);
console.log("Updated nested braces");
