const fs = require("fs");
let code = fs.readFileSync("screens/ProfileScreen.tsx", "utf-8");

code = code.replace(/onPress=\{\(\) =>\s*Alert\.alert\(\s*"Help & Support",\s*"Contact HR at hr@realtyhrm.com"\s*\)\s*\}/, `onPress={() => navigation.navigate("HelpSupport" as never)}`);

fs.writeFileSync("screens/ProfileScreen.tsx", code);
console.log("Updated ProfileScreen for HelpSupport");
