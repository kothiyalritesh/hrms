import re

with open('d:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/UserManagementScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Add dropdownIconColor={theme.text} to all Pickers if they don't have it
content = re.sub(
    r'(<Picker\b(?![^>]*dropdownIconColor)[^>]*?)>',
    r'\1 dropdownIconColor={theme.text}>',
    content
)

with open('d:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/UserManagementScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
