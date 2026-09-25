const fs = require('fs');
const path = require('path');
const filesList = fs.readFileSync('all_files.txt', 'utf-8').split('\n').map(l => l.trim()).filter(l => l && !l.includes('node_modules') && l.endsWith('.tsx'));
let report = '# UI Architecture Map\n\n';
report += '## Screens\n\n';
for (const file of filesList) {
    if (fs.statSync(file).isDirectory()) continue;
    const content = fs.readFileSync(file, 'utf-8');
    const filename = path.basename(file);
    const isScreen = file.includes('screens');
    const services = [...content.matchAll(/import.*from.*services.*/g)].map(m => m[0]).join(', ');
    const dataFetches = [...content.matchAll(/useQuery|useMutation|fetch|axios/g)].map(m => m[0]).filter((v, i, a) => a.indexOf(v) === i).join(', ');
    const navFlow = [...content.matchAll(/navigation\.navigate\([`'"]([^`'"]+)[`'"]/g)].map(m => m[1]).join(', ');
    let state = 'complete';
    if (content.includes('TODO') || content.includes('FIXME')) state = 'partial';
    if (content.match(/return \(\s*<View>\s*<\/View>\s*\)/) || content.length < 200) state = 'stub';
    const info = `### ${filename}\n- **Type**: ${isScreen ? 'Screen' : 'Component'}\n- **Path**: ${file}\n- **Services**: ${services || 'None'}\n- **Data Fetched**: ${dataFetches || 'None'}\n- **Navigation**: ${navFlow || 'None'}\n- **State**: ${state}\n\n`;
    if (isScreen) report += info;
}
report += '## Components\n\n';
for (const file of filesList) {
    if (fs.statSync(file).isDirectory()) continue;
    const content = fs.readFileSync(file, 'utf-8');
    const filename = path.basename(file);
    const isScreen = file.includes('screens');
    if (isScreen) continue;
    const services = [...content.matchAll(/import.*from.*services.*/g)].map(m => m[0]).join(', ');
    const dataFetches = [...content.matchAll(/useQuery|useMutation|fetch|axios/g)].map(m => m[0]).filter((v, i, a) => a.indexOf(v) === i).join(', ');
    const navFlow = [...content.matchAll(/navigation\.navigate\([`'"]([^`'"]+)[`'"]/g)].map(m => m[1]).join(', ');
    let state = 'complete';
    if (content.includes('TODO') || content.includes('FIXME')) state = 'partial';
    if (content.match(/return \(\s*<View>\s*<\/View>\s*\)/) || content.length < 200) state = 'stub';
    const info = `### ${filename}\n- **Services**: ${services || 'None'}\n- **Data Fetched**: ${dataFetches || 'None'}\n- **Navigation**: ${navFlow || 'None'}\n- **State**: ${state}\n\n`;
    report += info;
}
fs.writeFileSync('report.md', report);
console.log('Report generated');