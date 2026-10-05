const fs = require("fs");

// Fix AdminDashboardScreen
let code = fs.readFileSync("screens/admin/AdminDashboardScreen.tsx", "utf-8");
if (!code.includes("const [refreshing, setRefreshing] = useState(false);")) {
  code = code.replace(/const \[loading, setLoading\] = useState\(true\);/, `const [refreshing, setRefreshing] = useState(false);\n  const [loading, setLoading] = useState(true);`);
}
code = code.replace(/color="#EC4899"/, `accent="#EC4899"`);
if (!code.match(/icon="file-text"[\s\S]*?accent=/)) {
  code = code.replace(/icon="file-text"\s+label="Audit Logs"\s+desc="System activity trail"/, `icon="file-text"\n              label="Audit Logs"\n              desc="System activity trail"\n              accent="#9CA3AF"`);
}
fs.writeFileSync("screens/admin/AdminDashboardScreen.tsx", code);

// Fix MyActivityLogsScreen
let actCode = fs.readFileSync("screens/MyActivityLogsScreen.tsx", "utf-8");
if (!actCode.includes("const [filter, setFilter] = useState")) {
  actCode = actCode.replace(/const \[page, setPage\] = useState<number>\(0\);\n\s*const \[total, setTotal\] = useState<number>\(0\);/, `const [page, setPage] = useState<number>(0);\n  const [total, setTotal] = useState<number>(0);\n  const [filter, setFilter] = useState("all");`);
  // also check if it didn't match type
  actCode = actCode.replace(/const \[page, setPage\] = useState\(0\);\n\s*const \[total, setTotal\] = useState\(0\);/, `const [page, setPage] = useState(0);\n  const [total, setTotal] = useState(0);\n  const [filter, setFilter] = useState("all");`);
}
fs.writeFileSync("screens/MyActivityLogsScreen.tsx", actCode);

// Fix AttendanceControlScreenNew
let attCode = fs.readFileSync("screens/admin/AttendanceControlScreenNew.tsx", "utf-8");
attCode = attCode.replace(/item\.active_site_name/g, `(item as any).active_site_name`);
attCode = attCode.replace(/item\.active_field_visit_name/g, `(item as any).active_field_visit_name`);
fs.writeFileSync("screens/admin/AttendanceControlScreenNew.tsx", attCode);

console.log("Fixed final types");
