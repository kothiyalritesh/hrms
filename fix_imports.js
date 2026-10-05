const fs = require('fs');
const path = require('path');
const p = path.resolve('screens/admin/SiteVisitObserverScreen.tsx');
let content = fs.readFileSync(p, 'utf-8');

if (!content.includes('useWindowDimensions')) {
  content = content.replace('import {', 'import { useWindowDimensions, FlatList,');
} else if (!content.includes('FlatList')) {
  content = content.replace('import {', 'import { FlatList,');
}
fs.writeFileSync(p, content, 'utf-8');
