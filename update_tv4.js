const fs = require('fs');
const file = 'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/TVDisplayScreen.tsx';
let content = fs.readFileSync(file, 'utf8');

// Replace using regex for the logo
content = content.replace(
  /<Text style=\{s\.brandBop\}>\s*bop<Text style=\{\{ color: C\.pink \}\}>\.in<\/Text>\s*<\/Text>/,
  '<Image source={require("../../assets/images/logo.png")} style={{ width: 100, height: 32, resizeMode: "contain" }} />'
);

fs.writeFileSync(file, content, 'utf8');
console.log("Injected Logo properly");