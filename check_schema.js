const fs = require('fs');
const path = require('path');

const dir = 'supabase/migrations';
const files = fs.readdirSync(dir).sort();
let attendanceLogsSchema = "";
let smartOfficeLogsSchema = "";
let profilesSchema = "";

for (const f of files) {
  const content = fs.readFileSync(path.join(dir, f), 'utf-8');
  if (content.toLowerCase().includes('create table public.attendance_logs') || content.toLowerCase().includes('create table if not exists public.attendance_logs') || content.toLowerCase().includes('alter table public.attendance_logs')) {
    const matches = content.match(/create table.*?attendance_logs[\s\S]*?\);/i);
    if (matches) attendanceLogsSchema += matches[0] + "\n\n";
    
    const alters = content.match(/alter table.*?attendance_logs.*?;/gi);
    if (alters) attendanceLogsSchema += alters.join("\n") + "\n\n";
  }
  
  if (content.toLowerCase().includes('create table public.smartoffice_device_logs') || content.toLowerCase().includes('create table if not exists public.smartoffice_device_logs') || content.toLowerCase().includes('alter table public.smartoffice_device_logs')) {
    const matches = content.match(/create table.*?smartoffice_device_logs[\s\S]*?\);/i);
    if (matches) smartOfficeLogsSchema += matches[0] + "\n\n";
  }
}

console.log("ATTENDANCE LOGS:");
console.log(attendanceLogsSchema.substring(0, 1500));
console.log("\nSMARTOFFICE:");
console.log(smartOfficeLogsSchema.substring(0, 1500));
