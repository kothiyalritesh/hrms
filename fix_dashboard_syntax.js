const fs = require("fs");
let code = fs.readFileSync("screens/admin/AdminDashboardScreen.tsx", "utf-8");

code = code.replace(/\{hasPermission\("SYSTEM_ADMIN"\) \? \(/g, `{hasPermission("SYSTEM_ADMIN") && (`);
code = code.replace(/\{hasPermission\("screen\.live_tracking"\) \? \(/g, `{hasPermission("screen.live_tracking") && (`);
code = code.replace(/\{hasPermission\("screen\.check_in_logs"\) \? \(/g, `{hasPermission("screen.check_in_logs") && (`);
code = code.replace(/\{hasPermission\("screen\.office_settings"\) \? \(/g, `{hasPermission("screen.office_settings") && (`);
code = code.replace(/\{hasPermission\("screen\.site_settings"\) \? \(/g, `{hasPermission("screen.site_settings") && (`);
code = code.replace(/\{hasPermission\("screen\.notification_management"\) \? \(/g, `{hasPermission("screen.notification_management") && (`);
code = code.replace(/\{hasPermission\("screen\.audit_logs"\) \? \(/g, `{hasPermission("screen.audit_logs") && (`);
code = code.replace(/\{hasPermission\("screen\.anonymous_feedback"\) \? \(/g, `{hasPermission("screen.anonymous_feedback") && (`);

// also fix the closing tags that I manually added `: null}` to!
code = code.replace(/\) : null\}/g, `)}`);

fs.writeFileSync("screens/admin/AdminDashboardScreen.tsx", code);
console.log("Updated AdminDashboardScreen syntax");
