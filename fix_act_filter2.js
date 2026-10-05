const fs = require("fs");
let code = fs.readFileSync("screens/MyActivityLogsScreen.tsx", "utf-8");
code = code.replace(/const \[page, setPage\] = useState\(0\);/, `const [page, setPage] = useState(0);\n  const [filter, setFilter] = useState("all");`);
fs.writeFileSync("screens/MyActivityLogsScreen.tsx", code);
