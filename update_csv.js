const fs = require('fs');
let sql = fs.readFileSync('supabase/migrations/20260927_update_import_rpc.sql', 'utf8');

sql = sql.replace(
  /'is_active', true/,
  `'weekly_off_day', CASE WHEN nullif(btrim((v_row->>'weekly_off_day')::text), '') IS NOT NULL THEN (v_row->>'weekly_off_day')::integer ELSE NULL END,
      'is_active', true`
);

fs.writeFileSync('supabase/migrations/20260927_update_import_rpc_fixed.sql', sql, 'utf8');
console.log("Updated RPC migration file");
