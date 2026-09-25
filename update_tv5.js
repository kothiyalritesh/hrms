const fs = require('fs');
const file = 'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/TVDisplayScreen.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  'Animated, LayoutChangeEvent,',
  'Animated, LayoutChangeEvent, Image, Easing,'
);

fs.writeFileSync(file, content, 'utf8');
console.log("Injected imports properly");