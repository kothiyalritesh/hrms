const https = require('https');

https.get('https://bop.in/HRMS/_expo/static/js/web/index-89f1d16af064a03cf2e83f1163b1b8a0.js', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    let idx = 0;
    while ((idx = data.indexOf('detectSessionInUrl', idx + 1)) !== -1) {
      console.log('detectSessionInUrl match:', data.substring(idx - 100, idx + 200));
    }
  });
});

