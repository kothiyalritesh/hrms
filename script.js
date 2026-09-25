const fs = require('fs');
const path = require('path');

const walkSync = (dir, filelist = [], exclude = []) => {
  fs.readdirSync(dir).forEach(file => {
    const dirFile = path.join(dir, file);
    if (exclude.some(ex => dirFile.includes(ex))) return;
    try {
      filelist = fs.statSync(dirFile).isDirectory() ? walkSync(dirFile, filelist, exclude) : (dirFile.endsWith('.ts') ? filelist.concat(dirFile) : filelist);
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'EPERM') {
        // Skip
      } else {
        throw err;
      }
    }
  });
  return filelist;
};

const dirs = ['services', 'supabase/functions'];
let files = [];
dirs.forEach(d => {
  files = files.concat(walkSync(d, [], ['__tests__', 'node_modules']));
});

const results = files.map(f => {
  const content = fs.readFileSync(f, 'utf8');
  
  const tables = [...content.matchAll(/from\(['"]([^'"]+)['"]\)/g)].map(m => m[1]);
  const rpcs = [...content.matchAll(/rpc\(['"]([^'"]+)['"]\)/g)].map(m => m[1]);
  const exportsMatches = [...content.matchAll(/export\s+(const|function|class|async function|type|interface)\s+([a-zA-Z0-9_]+)/g)].map(m => m[2]);
  
  const hasFetch = content.includes('fetch(') || content.includes('axios.');
  const todos = [...content.matchAll(/TODO.*|FIXME.*/g)].map(m => m[0]);
  
  // Try to find function signatures
  const signatures = [...content.matchAll(/export\s+(?:async\s+)?(?:function\s+)?([a-zA-Z0-9_]+)\s*\(([^)]*)\)/g)].map(m => m[1] + '(' + m[2].replace(/\s+/g, ' ') + ')');
  
  // class methods
  const methods = [...content.matchAll(/(?:public|private|protected)?\s*(?:async\s+)?([a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*[:{]/g)].map(m => m[1] + '(' + m[2].replace(/\s+/g, ' ') + ')');

  return {
    file: f.replace(/\\/g, '/'),
    exports: [...new Set(exportsMatches)],
    tables: [...new Set(tables)],
    rpcs: [...new Set(rpcs)],
    hasFetch,
    todos: [...new Set(todos)],
    signatures: [...new Set([...signatures, ...methods])].filter(s => s.length > 2 && s.length < 150) // filter out junk
  };
});

fs.writeFileSync('analysis.json', JSON.stringify(results, null, 2));
