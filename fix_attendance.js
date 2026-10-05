const fs = require("fs");
let code = fs.readFileSync("services/attendance.service.ts", "utf-8");

code = code.replace(/export interface AttendanceRecord \{/, `export interface AttendanceRecord {\n  active_site_name?: string;\n  active_field_visit_name?: string;`);

fs.writeFileSync("services/attendance.service.ts", code);
console.log("Updated AttendanceRecord");
