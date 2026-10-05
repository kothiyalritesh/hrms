const fs = require("fs");
let code = fs.readFileSync("services/canonical-attendance.service.ts", "utf-8");

code = code.replace(/export interface CanonicalAttendanceRecord \{/, `export interface CanonicalAttendanceRecord {\n  active_site_name?: string;\n  active_field_visit_name?: string;`);

fs.writeFileSync("services/canonical-attendance.service.ts", code);
console.log("Updated CanonicalAttendanceRecord");
