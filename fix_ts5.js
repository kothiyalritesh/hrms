const fs = require('fs');
const path = 'd:\\download\\RealtyHRM-fixed\\RealtyHRM-fixed\\screens\\admin\\TVDisplayScreen.tsx';
let code = fs.readFileSync(path, 'utf8');

// Fix FeedItem pushing
code = code.replace(
    'isNew:  feedItems.length === 0,',
    'isNew:  feedItems.length === 0,\n          rawTime: a.checkin_time || "",'
);
code = code.replace(
    'isNew:  false,',
    'isNew:  false,\n            rawTime: a.checkout_time || "",'
);

fs.writeFileSync(path, code);
console.log('Fixed push object properties');
