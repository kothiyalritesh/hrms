const fs = require("fs");
let code = fs.readFileSync("screens/admin/SiteVisitObserverScreen.tsx", "utf-8");

if (!code.includes("useWindowDimensions")) {
  code = code.replace(/import \{/, `import { useWindowDimensions, FlatList,`);
}

code = code.replace(/type="defaultSemiBold"/g, `style={{ fontWeight: "600", fontSize: 16 }}`);

fs.writeFileSync("screens/admin/SiteVisitObserverScreen.tsx", code);
