const fs = require('fs');
const content = fs.readFileSync('dump-postgres-202609011610.sql', 'utf-8');
const lines = content.split('\n');
const matchLines = lines.filter((l, i) => l.toLowerCase().includes('insert into public.comp_off_earnings'));
console.log(matchLines);
