const fs = require('fs');
let content = fs.readFileSync('screens/LeaveScreen.tsx', 'utf-8');
content = content.replace(/title="Leave & Calendar"/, 'title="Leave History"');
fs.writeFileSync('screens/LeaveScreen.tsx', content, 'utf-8');
