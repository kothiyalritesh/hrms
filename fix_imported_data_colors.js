const fs = require("fs");
let code = fs.readFileSync("screens/admin/SmartOfficeImportedData.tsx", "utf-8");

code = code.replace(/backgroundColor: "#fff"/g, `backgroundColor: theme.background`);
code = code.replace(/backgroundColor: "#f9f9f9"/g, `backgroundColor: theme.backgroundSecondary`);
code = code.replace(/backgroundColor: "#f3f4f6"/g, `backgroundColor: theme.backgroundSecondary`);
code = code.replace(/color: "#000"/g, `color: theme.text`);
code = code.replace(/color: "#1f2937"/g, `color: theme.text`);
code = code.replace(/color: "#4b5563"/g, `color: theme.textSecondary`);
code = code.replace(/color: "#374151"/g, `color: theme.textSecondary`);
code = code.replace(/borderColor: "#eee"/g, `borderColor: theme.border`);
code = code.replace(/borderColor: "#e5e7eb"/g, `borderColor: theme.border`);
code = code.replace(/borderColor: "#ddd"/g, `borderColor: theme.border`);

// also inject theme if missing
if (!code.includes("const { theme } = useTheme();")) {
  code = code.replace(/export function SmartOfficeImportedData\(\) \{/, `export function SmartOfficeImportedData() {\n  const { theme } = useTheme();`);
  if (!code.includes("useTheme")) {
    code = code.replace(/import React/, `import { useTheme } from "@/hooks/useTheme";\nimport React`);
  }
}

fs.writeFileSync("screens/admin/SmartOfficeImportedData.tsx", code);
console.log("Updated SmartOfficeImportedData colors");
