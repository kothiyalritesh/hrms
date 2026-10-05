const fs = require("fs");
let code = fs.readFileSync("navigation/AdminStackNavigator.tsx", "utf-8");

code = code.replace(/import \{ getCommonScreenOptions \} from "@\/navigation\/screenOptions";/, `import { getCommonScreenOptions } from "@/navigation/screenOptions";\nimport { deferredScreen } from "@/navigation/deferredScreen";`);

fs.writeFileSync("navigation/AdminStackNavigator.tsx", code);
console.log("Updated AdminStackNavigator");
