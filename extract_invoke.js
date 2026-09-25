const https = require('https');

https.get('https://bop.in/HRMS/_expo/static/js/web/index-89f1d16af064a03cf2e83f1163b1b8a0.js', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const idx = data.indexOf('otp-proxy.php');
    if (idx !== -1) {
      console.log(data.substring(idx - 400, idx + 800));
    }
  });
});

