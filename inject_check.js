const fs = require('fs');

const tvFile = 'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/TVDisplayScreen.tsx';
let tvContent = fs.readFileSync(tvFile, 'utf8');

// I will inject a temporary fetch to supabase using supabase-js right into the TVDisplayScreen load function
tvContent = tvContent.replace(
  'const [canonicalData, alertResult] = await Promise.all([',
  'const {data:d1} = await supabase.from("smartoffice_device_logs").select("id").limit(1);\n        const {data:d2} = await supabase.from("biometric_device_punches").select("id").limit(1);\n        console.log("SMARTOFFICE LOGS:", d1?.length, "BIOMETRIC PUNCHES:", d2?.length);\n        const [canonicalData, alertResult] = await Promise.all(['
);
fs.writeFileSync(tvFile, tvContent, 'utf8');
console.log("Injected table check");