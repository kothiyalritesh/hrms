const fs = require('fs');
const path = 'd:\\download\\RealtyHRM-fixed\\RealtyHRM-fixed\\screens\\admin\\TVDisplayScreen.tsx';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(/isNew\?:\s*boolean;\s*\/\/\s*highlight newest entry\s*\r?\n}/, 'isNew?: boolean;    // highlight newest entry\n  rawTime: string;\n}');

fs.writeFileSync(path, code);
console.log('Fixed rawTime');
