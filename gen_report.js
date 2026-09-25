const fs = require('fs');
const data = JSON.parse(fs.readFileSync('analysis.json', 'utf8'));

let md = '# Services Architecture Report\n\n';
md += '## Architecture Map\n\n';
md += '```mermaid\ngraph TD\n';
md += '    App --> LocationGroup\n    App --> AttendanceGroup\n    App --> EventGroup\n    App --> FieldVisitGroup\n';
md += '    LocationGroup --> LocationTrackingCoordinator\n';
md += '    LocationGroup --> BackgroundLocationTask\n';
md += '    AttendanceGroup --> AttendanceService\n';
md += '    AttendanceGroup --> AttendanceIntelligence\n';
md += '    EventGroup --> EventService\n';
md += '    FieldVisitGroup --> FieldVisitService\n';
md += '```\n\n';

for (const item of data) {
    md += `### \`${item.file}\`\n\n`;
    
    // 1. What it does
    const basename = item.file.split('/').pop().replace('.ts', '').replace('.service', '');
    md += `**1. What it does:** Handles logic, operations, and state related to ${basename}. It exports ${item.exports.join(', ')}.\n\n`;
    
    // 2. API Calls
    md += `**2. API Calls:** \n`;
    if (item.hasFetch) md += `- Makes external HTTP requests (uses fetch/axios).\n`;
    if (item.rpcs.length > 0) md += `- Supabase RPCs: ${item.rpcs.map(r => r).join(', ')}\n`;
    if (!item.hasFetch && item.rpcs.length === 0) md += `- No specific external fetch or RPC calls detected.\n`;
    md += `\n`;
    
    // 3. Tables Interactions
    md += `**3. Tables Interacted With:** ${item.tables.length > 0 ? item.tables.map(t => t).join(', ') : 'None directly specified in this file.'}\n\n`;
    
    // 4. Key Functions
    md += `**4. Key Functions & Signatures:**\n`;
    const sigs = item.signatures.filter(s => !s.startsWith('if') && !s.startsWith('for') && !s.startsWith('catch') && !s.startsWith('while') && !s.startsWith('return') && !s.startsWith('slice') && !s.startsWith('match') && !s.startsWith('parseInt') && !s.startsWith('trim') && !s.startsWith('toUpperCase'));
    if (sigs.length > 0) {
        sigs.slice(0, 10).forEach(s => {
            md += `- \`${s}\`\n`;
        });
        if (sigs.length > 10) md += `- *(and ${sigs.length - 10} more...)*\n`;
    } else {
        md += `- No complex function signatures exported or defined.\n`;
    }
    md += `\n`;
    
    // 5. Limitations / Gaps
    md += `**5. Limitations or Gaps:**\n`;
    if (item.todos.length > 0) {
        item.todos.forEach(t => {
            md += `- ${t.replace(/\r?\n|\r/g, " ")}\n`;
        });
    } else {
        md += `- No explicit TODOs or FIXMEs found.\n`;
    }
    md += `\n---\n\n`;
}

fs.writeFileSync('C:/Users/sagar/.gemini/antigravity/brain/25a8ceb9-9568-4cbe-bdae-aa1f0e70cf51/service_report.md', md);
console.log('Report written to artifact directory.');
