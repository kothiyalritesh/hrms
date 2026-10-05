const fs = require('fs');
const path = require('path');
const p = path.resolve('screens/admin/UserManagementScreen.tsx');
let content = fs.readFileSync(p, 'utf-8');

const regex = /const rows = rawData\.slice\(1\)[\s\S]*?row_number: snIdx >= 0 \? String\(cols\[snIdx\]\) \: String\(i \+ 1\),?\n\s*\}\)\);/;

const replacement = `const emailIdx = findExact("email", "email address");
          const empNumIdx = findExact("employee number", "emp no", "emp id", "employee id");
          const dobIdx = findExact("date of birth", "dob", "birth date");
          const genderIdx = findExact("gender", "sex");
          const joiningDateIdx = findExact("joining date", "date of joining", "doj");

          const rows = rawData.slice(1)
            .map((cols: any[], i: number) => ({
              sn:          snIdx >= 0     ? String(cols[snIdx] ?? i + 1)     : String(i + 1),
              name:        String(cols[nameIdx] ?? "").trim(),
              phone:       phoneIdx >= 0  ? String(cols[phoneIdx] ?? "")    : "",
              email:       emailIdx >= 0  ? String(cols[emailIdx] ?? "")    : null,
              team:        teamIdx >= 0   ? String(cols[teamIdx] ?? "")     : null,
              designation: roleIdx >= 0   ? String(cols[roleIdx] ?? "")     : "",
              office:      officeIdx >= 0 ? String(cols[officeIdx] ?? "")   : "",
              employee_number: empNumIdx >= 0 ? String(cols[empNumIdx] ?? "") : null,
              date_of_birth: dobIdx >= 0 ? String(cols[dobIdx] ?? "") : null,
              gender: genderIdx >= 0 ? String(cols[genderIdx] ?? "") : null,
              joining_date: joiningDateIdx >= 0 ? String(cols[joiningDateIdx] ?? "") : null,
            }))
            .filter((row: any) => row.name || row.phone)
            .map((row: any, i: number) => ({
              ...row,
              row_number: snIdx >= 0 ? String(rawData[i+1][snIdx]) : String(i + 1),
            }));`;

if (regex.test(content)) {
  content = content.replace(regex, replacement);
  fs.writeFileSync(p, content, 'utf-8');
  console.log("Updated field mapping in UserManagementScreen.tsx");
} else {
  console.log("Regex didn't match row mapping in UserManagementScreen.tsx");
}
