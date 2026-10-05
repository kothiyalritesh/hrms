const fs = require("fs");
let code = fs.readFileSync("screens/admin/AnonymousFeedbackScreen.tsx", "utf-8");

code = code.replace(/totalPages=\{Math\.ceil\(total \/ PAGE_SIZE\)\}/, `pageSize={PAGE_SIZE} total={total}`);

fs.writeFileSync("screens/admin/AnonymousFeedbackScreen.tsx", code);
console.log("Updated AnonymousFeedbackScreen");
