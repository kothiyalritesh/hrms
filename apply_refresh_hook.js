const fs = require('fs');

function applyHook(file) {
  let content = fs.readFileSync(file, 'utf8');
  if (content.includes('useScreenRefresh')) return;
  
  content = content.replace(
    /import \{ useTheme \} from "@\/hooks\/useTheme";/,
    'import { useTheme } from "@/hooks/useTheme";\nimport { useScreenRefresh } from "@/hooks/useScreenRefresh";'
  );

  // Replace manual state and onRefresh with hook
  if (file.includes('DashboardScreen')) {
    content = content.replace(/const \[refreshing, setRefreshing\] = useState\(false\);/, '');
    content = content.replace(
      /const onRefresh = async \(\) => \{\n      setRefreshing\(true\);\n      if \(user\?\.id\) DashboardSummaryService\.invalidateEmployee\(user\.id\);\n      await loadData\(true\);\n      setRefreshing\(false\);\n    \};/,
      'const { refreshing, onRefresh } = useScreenRefresh(async () => {\n      if (user?.id) DashboardSummaryService.invalidateEmployee(user.id);\n      await loadData(true);\n    });'
    );
  }
  
  if (file.includes('AdminDashboardScreen')) {
    content = content.replace(/const \[refreshing, setRefreshing\] = useState\(false\);/, '');
    content = content.replace(
      /const onRefresh = async \(\) => \{\n    setRefreshing\(true\);\n    try \{\n      await loadData\(\);\n    \} finally \{\n      setRefreshing\(false\);\n    \}\n  \};/,
      'const { refreshing, onRefresh } = useScreenRefresh(async () => {\n    await loadData();\n  });'
    );
  }

  fs.writeFileSync(file, content);
  console.log('Applied hook to ' + file);
}

applyHook('screens/DashboardScreen.tsx');
applyHook('screens/admin/AdminDashboardScreen.tsx');
