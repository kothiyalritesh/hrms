const fs = require("fs");
let code = fs.readFileSync("screens/HelpSupportScreen.tsx", "utf-8");

code = code.replace(/user\?\.org_id/g, `(user as any)?.org_id`);

fs.writeFileSync("screens/HelpSupportScreen.tsx", code);
console.log("Updated HelpSupportScreen");
