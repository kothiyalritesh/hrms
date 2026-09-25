const https = require('https');
https.get('https://bop.in/HRMS/', (res) => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => {
    console.log(data.match(/src="(\/HRMS\/static\/js\/main\.[a-z0-9]+\.js)"/)?.[1]);
  });
}).on('error', console.error);
