const fs = require('fs');
const path = require('path');
const p = path.resolve('screens/admin/UserManagementScreen.tsx');
let content = fs.readFileSync(p, 'utf-8');

const regex = /const downloadSampleCSV = \(\) => \{\s*const sample = \[\s*"SN,Emp Name,CONTACT,TEAM,DESIGNATION,OFFICE",\s*"1,Neha Kapoor,9876543201,Noida Sales,Sales Manager,Noida Office",\s*"2,Rahul Sharma,9876543210,Noida Sales,Sales Executive,Noida Office",\s*"3,Priya Singh,9123456789,Noida Sales,Telecaller,Noida Office",\s*"4,Amit Kumar,9988776655,Noida Sales,Agent,Noida Office",\s*\]\.join\("\\n"\);/;

const replacement = `const downloadSampleCSV = () => {
    // Phase 4: Expanded Sample CSV with all fields (backward compatible)
    const sample = [
      "SN,name,phone,email,role,office,employee_number,team,date_of_birth,gender,joining_date",
      "1,Neha Kapoor,9876543201,neha@example.com,SALES_MANAGER,Noida Office,EMP001,Noida Sales,1990-05-15,FEMALE,2023-01-10",
      "2,Rahul Verma,9876543202,rahul@example.com,SALES_EXECUTIVE,Gurgaon Office,EMP002,,1992-08-22,MALE,2023-02-15"
    ].join("\\n");`;

if (regex.test(content)) {
  content = content.replace(regex, replacement);
  
  content = content.replace(/Columns: SN.*OFFICE/, "Columns: name, phone, email, role, office, employee_number, team, date_of_birth, gender, joining_date");
  
  fs.writeFileSync(p, content, 'utf-8');
  console.log("Updated CSV template in UserManagementScreen.tsx");
} else {
  console.log("Regex didn't match.");
}
