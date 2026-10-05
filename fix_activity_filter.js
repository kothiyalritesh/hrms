const fs = require("fs");
let code = fs.readFileSync("screens/MyActivityLogsScreen.tsx", "utf-8");

code = code.replace(/const \[page, setPage\] = useState\(0\);\n\s*const \[total, setTotal\] = useState\(0\);/, `const [page, setPage] = useState(0);\n  const [total, setTotal] = useState(0);\n  const [filter, setFilter] = useState("all");`);

fs.writeFileSync("screens/MyActivityLogsScreen.tsx", code);
console.log("Updated MyActivityLogsScreen filter state");
