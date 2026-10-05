const fs = require('fs');
let content = fs.readFileSync('hooks/useScreenRefresh.tsx', 'utf8');

content = content.replace(
  /if \(Platform\.OS === 'web'\) \{/g,
  'if (true) {'
);

fs.writeFileSync('hooks/useScreenRefresh.tsx', content);
console.log('Fixed useScreenRefresh.tsx');
