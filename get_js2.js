const https = require('https');
https.get('https://bop.in/HRMS/_expo/static/js/web/index-f80e5d1062b1898bc849672409c191ee.js', (res) => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => console.log('Len:', data.length, 'End:', data.slice(-100)));
});
