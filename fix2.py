import re

with open('d:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/AttendanceRegularizationScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix styles inside component
content = content.replace('styles.white', '{ color: theme.backgroundDefault, fontWeight: "700" as const }')
content = content.replace('styles.errorTitle', '{ color: theme.errorText, fontWeight: "800" as const }')
content = content.replace('styles.errorText', '{ color: theme.errorText, marginTop: 2 }')
content = content.replace('styles.retryText', '{ color: theme.errorText, fontWeight: "800" as const }')
content = content.replace('styles.errorBox', '[styles.errorBox, { borderColor: theme.error, backgroundColor: theme.errorBg }]')
content = content.replace('styles.muted', '{ color: theme.textSecondary }')
content = content.replace('styles.badgeText', '{ color: theme.primary, fontWeight: "700" as const }')
content = content.replace('color="#B91C1C"', 'color={theme.error}')
content = content.replace('color="#10B981"', 'color={theme.success}')
content = content.replace('color="#EF4444"', 'color={theme.error}')
content = content.replace('backgroundColor: "#10B981"', 'backgroundColor: theme.success')
content = content.replace('backgroundColor: "#EF4444"', 'backgroundColor: theme.error')
content = content.replace('modal?.approve ? "#10B981" : "#EF4444"', 'modal?.approve ? theme.success : theme.error')

with open('d:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/AttendanceRegularizationScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
