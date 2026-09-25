import re

with open('d:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/UserManagementScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Make sure Platform is imported
if 'Platform' not in content:
    content = content.replace("import {", "import { Platform,", 1)

# Replace Picker styling
old_style = r'style=\{\{\s*color:\s*theme\.text\s*\}\}'
new_style = r'style={[Platform.OS === "web" ? { height: 48, borderWidth: 0, backgroundColor: "transparent", outline: "none", paddingHorizontal: 12, width: "100%" } : {}, { color: theme.text }]}'

content = re.sub(old_style, new_style, content)

with open('d:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/UserManagementScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
