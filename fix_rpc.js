const fs = require('fs');
const path = require('path');
const p = path.resolve('screens/admin/SiteVisitObserverScreen.tsx');
let content = fs.readFileSync(p, 'utf-8');

content = content.replace(/supabase\.rpc\("get_site_visit_observer_data", \{\s*p_date:\s*date,?\s*\}\)/, 'supabase.rpc("get_site_visit_observer_data", { p_date: date, p_employee_id: null, p_visit_id: null })');

fs.writeFileSync(p, content, 'utf-8');
console.log("Updated SiteVisitObserverScreen.tsx");
