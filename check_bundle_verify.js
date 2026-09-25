const https = require('https');

https.get('https://bop.in/HRMS/_expo/static/js/web/index-fcf8b866d9274062df111d531b2f0e20.js', res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    let idx = d.indexOf('action:"verify"');
    if (idx !== -1) {
      console.log('verify code in live bundle:', d.substring(idx - 100, idx + 800));
    } else {
      console.log('action:verify not found');
    }
  });
});

