const https = require('https');

https.get('https://bop.in/HRMS/_expo/static/js/web/index-89f1d16af064a03cf2e83f1163b1b8a0.js', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('common size:', data.length);
    const idx = data.indexOf('Unable to establish a secure session');
    if (idx !== -1) {
      console.log('Found in common:', data.substring(idx - 200, idx + 200));
    } else {
      console.log('Not in common');
    }
  });
});
