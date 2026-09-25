const https = require('https');

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  return { status: res.status, text };
}

async function main() {
  console.log('Testing proxy version...');
  const ver = await post('https://bop.in/HRMS/otp-proxy.php', { action: 'version' });
  console.log('Proxy version response:', ver.status, ver.text);

  console.log('\nTesting proxy request for admin 9999999999...');
  const req = await post('https://bop.in/HRMS/otp-proxy.php', { action: 'request', phone: '9999999999' });
  console.log('Proxy request response:', req.status, req.text);
}

main().catch(console.error);

