const fs = require('fs');
let content = fs.readFileSync('screens/DashboardScreen.tsx', 'utf8');

// Replace the old onRefresh
content = content.replace(
  /const onRefresh = async \(\) => \{\s+setRefreshing\(true\);\s+if \(user\?\.id\) DashboardSummaryService\.invalidateEmployee\(user\.id\);\s+await loadData\(true\);\s+setRefreshing\(false\);\s+\};/m,
  'const { refreshing, onRefresh } = useScreenRefresh(async () => {\n    if (user?.id) DashboardSummaryService.invalidateEmployee(user.id);\n    await loadData(true);\n  });'
);

fs.writeFileSync('screens/DashboardScreen.tsx', content);
console.log('Fixed DashboardScreen.tsx');
