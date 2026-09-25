const http = require('http');

async function main() {
  const tabs = JSON.parse(await new Promise((resolve) => {
    http.get('http://localhost:9223/json', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
  }));

  const target = tabs.find(t => t.url && t.url.includes('bop.in/HRMS'));
  console.log('Target tab:', target);
}

main();

