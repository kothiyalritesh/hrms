const fs = require('fs');
let content = fs.readFileSync('navigation/AdminStackNavigator.tsx', 'utf8');

content = content.replace(
  /export type AdminStackParamList = \{/,
  'export type AdminStackParamList = {\n  PermissionsManager: undefined;\n  SiteVisitObserver: { visitId?: string } | undefined;\n  InTransit: undefined;'
);

fs.writeFileSync('navigation/AdminStackNavigator.tsx', content);
