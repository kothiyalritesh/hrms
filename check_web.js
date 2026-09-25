const https = require('https');
https.get('https://bop.in/HRMS/', (res) => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => {
    const match = data.match(/<script defer=\"defer\" src=\"(.*?)\">/);
    if(match) {
      console.log('Found main script:', match[1]);
    } else {
      console.log('HTML:', data.substring(0, 500));
    }
  });
}).on('error', console.error);
