const https = require('https');

https.get('https://bop.in/HRMS/index.html', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const regex = /_expo\/static\/js\/web\/index-[^"']+\.js/g;
    const matches = data.match(regex);
    console.log('Index bundle on bop.in:', matches);
  });
});

