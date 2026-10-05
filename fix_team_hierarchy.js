const fs = require("fs");
let code = fs.readFileSync("screens/admin/TeamHierarchyScreen.tsx", "utf-8");
code = code.replace(/\{teamMembers\.length\} member\{teamMembers\.length !== 1 \? "s" : ""\}/, `{allTeamMembers.length} member{allTeamMembers.length !== 1 ? "s" : ""}`);
fs.writeFileSync("screens/admin/TeamHierarchyScreen.tsx", code);
console.log("Updated TeamHierarchyScreen");
