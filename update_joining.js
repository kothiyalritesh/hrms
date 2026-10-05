const fs = require('fs');
let content = fs.readFileSync('screens/ProfileScreen.tsx', 'utf-8');

// Update the supabase query to fetch both
content = content.replace(/\.select\("office_id, team, joining_date"\)/, '.select("office_id, team, joining_date, date_of_joining")');
content = content.replace(/setDateOfJoining\(data\?\.joining_date \|\| null\);/, 'setDateOfJoining(data?.joining_date || data?.date_of_joining || null);');

// Update the render fallback to include created_at
content = content.replace(/\{formatDate\(dateOfJoining \|\| \(user as any\)\?\.date_of_joining\)\}/, '{formatDate(dateOfJoining || (user as any)?.date_of_joining || (user as any)?.joining_date || user?.created_at)}');

fs.writeFileSync('screens/ProfileScreen.tsx', content, 'utf-8');
console.log("Updated ProfileScreen joining date fallback");
