const fs = require('fs');
let content = fs.readFileSync('screens/admin/AdminDashboardScreen.tsx', 'utf8');

// Replace the old onRefresh
content = content.replace(
  /const onRefresh = async \(\) => \{\s+setRefreshing\(true\);\s+try \{\s+DashboardSummaryService\.invalidateAdmin\(\);\s+await loadAdminData\(true\);\s+\} finally \{\s+setRefreshing\(false\);\s+\}\s+\};/m,
  'const { refreshing, onRefresh } = useScreenRefresh(async () => {\n    DashboardSummaryService.invalidateAdmin();\n    await loadAdminData(true);\n  });'
);

fs.writeFileSync('screens/admin/AdminDashboardScreen.tsx', content);
console.log('Fixed AdminDashboardScreen.tsx');
