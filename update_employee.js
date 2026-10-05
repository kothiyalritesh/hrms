const fs = require('fs');
let content = fs.readFileSync('screens/admin/UserManagementScreen.tsx', 'utf-8');

// 1. Add to interface
content = content.replace(/team\?: string \| null;/, 'team?: string | null;\n  weekly_off_day?: number | null;');

// 2. Add to EMPTY_FORM
content = content.replace(/team: "",\n  \};/, 'team: "",\n  weekly_off_day: -1,\n  };');

// 3. Add to openEditModal
const editRegex = /setForm\(\{\s*name: emp\.name,\s*email: emp\.email \|\| "",\s*phone: emp\.phone \|\| "",\s*employee_number: emp\.employee_number \|\| "",\s*role_id: matchedRole\?\.id \|\| emp\.role_id \|\| "",\s*office_id: emp\.office_id \|\| "",\s*gender: emp\.gender \|\| "MALE",\s*date_of_joining: emp\.date_of_joining \|\| "",\s*team: emp\.team \|\| "",\s*\}\);/;
content = content.replace(editRegex, `setForm({
        name: emp.name,
        email: emp.email || "",
        phone: emp.phone || "",
        employee_number: emp.employee_number || "",
        role_id: matchedRole?.id || emp.role_id || "",
        office_id: emp.office_id || "",
        gender: emp.gender || "MALE",
        date_of_joining: emp.date_of_joining || "",
        team: emp.team || "",
        weekly_off_day: emp.weekly_off_day !== undefined && emp.weekly_off_day !== null ? emp.weekly_off_day : -1,
      });`);

// 4. Update the save logic payload. The save logic just passes `p_values: form`. So this is automatic!
fs.writeFileSync('screens/admin/UserManagementScreen.tsx', content, 'utf-8');
console.log("Updated UserManagementScreen interfaces");
