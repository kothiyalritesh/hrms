const fs = require("fs");
let code = fs.readFileSync("screens/admin/AdminDashboardScreen.tsx", "utf-8");

code = code.replace(/import \{ useAuth \} from "@\/hooks\/useAuth";/, `import { useAuth } from "@/hooks/useAuth";\nimport { usePermissions } from "@/hooks/usePermissions";`);

code = code.replace(/const \{ user, isHR, isHRD \} = useAuth\(\);/, `const { user, isHR, isHRD } = useAuth();\n  const { hasPermission } = usePermissions();\n  const [refreshing, setRefreshing] = useState(false);`);

fs.writeFileSync("screens/admin/AdminDashboardScreen.tsx", code);
console.log("Updated AdminDashboardScreen variables");
