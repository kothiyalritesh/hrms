const fs = require('fs');
const path = require('path');
function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    if (file === 'node_modules' || file === '.git' || file === 'dist' || file.includes('.expo')) continue;
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(filePath));
    } else if (filePath.endsWith('.ts') || filePath.endsWith('.tsx') || filePath.endsWith('.sql')) {
      results.push(filePath);
    }
  }
  return results;
}
const files = walk('.');
for (const f of files) {
  const content = fs.readFileSync(f, 'utf8');
  if (content.toLowerCase().includes('office id')) {
    console.log('--- ' + f + ' ---');
    const lines = content.split('\n');
    for(let i=0; i<lines.length; i++) {
       if (lines[i].toLowerCase().includes('office id')) console.log(i + ': ' + lines[i].trim());
    }
  }
  if (content.includes('.from(\"attendance\")') || content.includes('.from(\'attendance\')')) {
     console.log('!!! Found .from(attendance) in ' + f);
  }
}
