const fs = require("fs");
const path = require("path");

const dir = "supabase/migrations";
const files = fs.readdirSync(dir)
  .filter(f => f.startsWith("20260926") && f.endsWith(".sql"))
  .sort();

let combined = "-- ==========================================\n-- COMBINED HRMS MIGRATIONS (PHASE 3 & 4)\n-- Run this entire script in your Supabase SQL Editor\n-- ==========================================\n\n";

for (const f of files) {
  combined += `\n\n-- >>> START: ${f} <<<\n\n`;
  combined += fs.readFileSync(path.join(dir, f), "utf-8");
  combined += `\n\n-- <<< END: ${f} >>>\n`;
}

fs.writeFileSync("COMBINED_MIGRATIONS.sql", combined);
console.log(`Successfully combined ${files.length} migrations into COMBINED_MIGRATIONS.sql`);
