const fs = require('fs');
const path = require('path');
const p = path.resolve('screens/admin/SmartOfficeImportedData.tsx');
let content = fs.readFileSync(p, 'utf-8');

// Remove from StyleSheet
content = content.replace(/backgroundColor: theme\.backgroundSecondary,\r?\n/g, '');

// Add to JSX
content = content.replace(/<View style=\{styles\.statBox\}>/g, '<View style={[styles.statBox, { backgroundColor: theme.backgroundSecondary }]}>');

fs.writeFileSync(p, content, 'utf-8');
console.log("Fixed theme scope in SmartOfficeImportedData.tsx");
