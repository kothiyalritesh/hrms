const fs = require('fs');
const content = fs.readFileSync('dump-postgres-202609011610.sql', 'utf-8');
const lines = content.split('\n');
const triggerLines = lines.filter((l, i) => l.toLowerCase().includes('comp_off') && (lines[i-1]?.toLowerCase().includes('trigger') || l.toLowerCase().includes('trigger')));
console.log(triggerLines);
