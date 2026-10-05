const fs = require("fs");
let code = fs.readFileSync("services/canonical-attendance.service.ts", "utf-8");
code = code.replace(/active_field_visit_name\?: string \| null;/, `active_field_visit_name?: string | null;\n  active_site_name?: string | null;`);
fs.writeFileSync("services/canonical-attendance.service.ts", code);
console.log("Updated CanonicalService");
