const fs = require('fs');
const monthly = fs.readFileSync('fix_monthly_attendance.sql', 'utf-8');
const canonical = fs.readFileSync('fix_canonical.sql', 'utf-8');
const migration = fs.readFileSync('supabase/migrations/20260928000000_fix_weekly_off_display.sql', 'utf-8');

fs.writeFileSync('supabase/migrations/20260928000000_fix_weekly_off_display.sql', canonical + '\n\n' + monthly + '\n\n' + migration, 'utf-8');
console.log("Combined everything");
