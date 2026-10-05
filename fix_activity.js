const fs = require("fs");
let code = fs.readFileSync("screens/MyActivityLogsScreen.tsx", "utf-8");

code = code.replace(/import \{ useFocusEffect, useNavigation \} from "@react-navigation\/native";/, `import { useFocusEffect, useNavigation } from "@react-navigation/native";\nimport { supabase } from "@/lib/supabase";`);

fs.writeFileSync("screens/MyActivityLogsScreen.tsx", code);
console.log("Updated MyActivityLogsScreen");
