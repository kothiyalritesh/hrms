const fs = require('fs');
const path = require('path');
const p = path.resolve('screens/admin/UserManagementScreen.tsx');
let content = fs.readFileSync(p, 'utf-8');

// The error is TS18047: 'row.team' is possibly 'null'.
// Find row.team and replace it with (row.team || "")

content = content.replace(/row\.team\.trim\(\)/g, '(row.team || "").trim()');

fs.writeFileSync(p, content, 'utf-8');
console.log("Fixed row.team null issue in UserManagementScreen.tsx");
