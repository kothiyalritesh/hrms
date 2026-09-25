const fs = require('fs');
const log = fs.readFileSync('C:/Users/sagar/.gemini/antigravity/brain/77011173-9dc8-40ca-b438-aa2de113ce6e/.system_generated/logs/transcript_full.jsonl', 'utf8');
const lines = log.split('\n');
for(let i = lines.length - 1; i >= 0; i--) {
  if(!lines[i].trim()) continue;
  try {
    const obj = JSON.parse(lines[i]);
    if(obj.tool_calls) {
      for(const tc of obj.tool_calls) {
        const name = tc.name || tc.function?.name;
        if(name && name.includes('run_command')) {
          const args = tc.arguments || tc.function?.arguments;
          const parsed = typeof args === 'string' ? JSON.parse(args) : args;
          if(parsed.CommandLine && parsed.CommandLine.includes('WriteAllText') && parsed.CommandLine.includes('TVDisplayScreen.tsx')) {
            console.log('Found it!');
            let code = parsed.CommandLine.split("@'")[1];
            if(!code) code = parsed.CommandLine.split('@"')[1];
            if(code) {
              code = code.split("'@")[0];
              code = code.split('"@')[0];
              fs.writeFileSync('tv_code.tsx', code.trim(), 'utf8');
              console.log('Saved to tv_code.tsx');
            } else {
              console.log('Could not match string literal');
            }
            process.exit(0);
          }
        }
      }
    }
  } catch(e) {}
}
console.log('Not found');