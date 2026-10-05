const fs = require('fs');
let content = fs.readFileSync('screens/admin/UserManagementScreen.tsx', 'utf8');

// 1. Update downloadSampleCSV
content = content.replace(
  /"SN,name,phone,email,role,office,employee_number,team,date_of_birth,gender,joining_date",/,
  '"SN,name,phone,email,role,office,employee_number,team,date_of_birth,gender,joining_date,weekly_off",'
);
content = content.replace(
  /"1,Neha Kapoor,9876543201,neha@example\.com,SALES_MANAGER,Noida Office,EMP001,Noida Sales,1990-05-15,FEMALE,2023-01-10",/,
  '"1,Neha Kapoor,9876543201,neha@example.com,SALES_MANAGER,Noida Office,EMP001,Noida Sales,1990-05-15,FEMALE,2023-01-10,Sunday",'
);
content = content.replace(
  /"2,Rahul Verma,9876543202,rahul@example\.com,SALES_EXECUTIVE,Gurgaon Office,EMP002,,1992-08-22,MALE,2023-02-15"/,
  '"2,Rahul Verma,9876543202,rahul@example.com,SALES_EXECUTIVE,Gurgaon Office,EMP002,,1992-08-22,MALE,2023-02-15,"'
);

// 2. Add weeklyOffIdx
content = content.replace(
  /const joiningDateIdx = findExact\("joining date", "date of joining", "doj"\);/,
  'const joiningDateIdx = findExact("joining date", "date of joining", "doj");\n          const weeklyOffIdx = findExact("weekly off", "week off", "day off");'
);

// 3. Add to rows mapping
content = content.replace(
  /joining_date: joiningDateIdx >= 0 \? String\(cols\[joiningDateIdx\] \?\? ""\) : null,/,
  'joining_date: joiningDateIdx >= 0 ? String(cols[joiningDateIdx] ?? "") : null,\n              weekly_off_day: weeklyOffIdx >= 0 ? String(cols[weeklyOffIdx] ?? "") : null,'
);

// 4. Add to normalizedRows
content = content.replace(
  /return \{\n            row_number: row\.sn,/,
  `          let weeklyOffParsed: number | null = null;
          if (row.weekly_off_day) {
            const val = row.weekly_off_day.toLowerCase().trim();
            const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
            const index = days.findIndex(d => val.includes(d) || val === d.substring(0,3));
            if (index !== -1) weeklyOffParsed = index;
            else if (!isNaN(parseInt(val)) && parseInt(val) >= 0 && parseInt(val) <= 6) weeklyOffParsed = parseInt(val);
          }

          return {
            row_number: row.sn,`
);

content = content.replace(
  /office_name: matchedOffices\[0\]\.name,/,
  'office_name: matchedOffices[0].name,\n            weekly_off_day: weeklyOffParsed,'
);

// 5. Add to BulkPreviewRow interface
content = content.replace(
  /date_of_joining\?: string;/,
  'date_of_joining?: string;\n  weekly_off_day?: number | null;'
);

// 6. Update columns list in the UI
content = content.replace(
  /Columns: name, phone, email, role, office, employee_number, team, date_of_birth, gender, joining_date/,
  'Columns: name, phone, email, role, office, employee_number, team, date_of_birth, gender, joining_date, weekly_off'
);

fs.writeFileSync('screens/admin/UserManagementScreen.tsx', content, 'utf8');
console.log("Updated bulk import sheet functionality");
