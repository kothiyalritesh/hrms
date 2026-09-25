const https = require('https');

https.get('https://bop.in/HRMS/sw.js', (res) => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    const m = d.match(/_expo\/static\/js\/web\/index-[^"']+/g);
    console.log('Index bundles in sw.js:', m);
  });
});

