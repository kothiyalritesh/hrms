const fs = require('fs');
const content = fs.readFileSync('dump-postgres-202609011610.sql', 'utf-8');
const match = content.match(/CREATE OR REPLACE FUNCTION public\.resolve_hrms_calendar_day[\s\S]*?LANGUAGE plpgsql/i) || content.match(/CREATE OR REPLACE FUNCTION public\.resolve_hrms_calendar_day[\s\S]*?\$\$/i);
if (match) {
  console.log(match[0]);
} else {
  console.log("Not found");
}
