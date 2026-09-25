const https = require('https');

https.get('https://bop.in/HRMS/_expo/static/js/web/index-fcf8b866d9274062df111d531b2f0e20.js', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Bundle length:', data.length);
    console.log('Contains fuchvtzbgwzdpzfaizbj:', data.includes('fuchvtzbgwzdpzfaizbj'));
    console.log('Contains jidbrwpzfpbursihtvpg:', data.includes('jidbrwpzfpbursihtvpg'));
    
    let idx = 0;
    while ((idx = data.indexOf('supabase.co', idx + 1)) !== -1) {
      console.log('supabase.co match:', data.substring(idx - 30, idx + 40));
    }
  });
});

