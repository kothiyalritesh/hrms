const fs = require("fs");
let code = fs.readFileSync("services/attendance-import.service.ts", "utf-8");

code = code.replace(/employeeCode: row\['Employee Code'\] \|\| row\['Emp Code'\] \|\| row\['EmpCode'\] \|\| '',/, `employeeCode: row['Employee Code'] || row['Emp Code'] || row['EmpCode'] || row['employee_number'] || '',`);
code = code.replace(/employeeName: row\['EmployeeName'\] \|\| row\['Employee Name'\] \|\| row\['Name'\] \|\| '',/, `employeeName: row['EmployeeName'] || row['Employee Name'] || row['Name'] || row['name'] || '',`);

fs.writeFileSync("services/attendance-import.service.ts", code);
console.log("Updated attendance-import.service.ts mapping");
