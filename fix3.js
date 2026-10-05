const fs = require('fs');
const path = require('path');
const p = path.resolve('screens/admin/SiteVisitObserverScreen.tsx');
let content = fs.readFileSync(p, 'utf-8');

content = content.replace(/Alert,\r?\n\}\s*from\s*["']react-native["'];/, 'Alert, useWindowDimensions, FlatList } from "react-native";');
fs.writeFileSync(p, content, 'utf-8');
console.log('Fixed react-native imports');
