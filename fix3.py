import re

with open('d:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/AttendanceRegularizationScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Add useTheme import if not there
if 'useTheme' not in content:
    content = content.replace('import { useAuth } from "@/contexts/AuthContext";', 'import { useAuth } from "@/contexts/AuthContext";\nimport { useTheme } from "@/hooks/useTheme";')

# Add const { theme } = useTheme();
if 'const { theme } = useTheme();' not in content:
    content = content.replace('const { user } = useAuth();', 'const { user } = useAuth();\n  const { theme } = useTheme();')

# Replace inline styles instead of styles object
content = content.replace('style={styles.container}', 'style={[styles.container, { backgroundColor: theme.backgroundRoot }]}')
content = content.replace('style={styles.filters}', 'style={[styles.filters, { backgroundColor: theme.backgroundDefault }]}')
content = content.replace('style={[styles.filter, filter === value && styles.active]}', 'style={[styles.filter, { borderColor: theme.border }, filter === value && [styles.active, { backgroundColor: theme.primary, borderColor: theme.primary }]]}')
content = content.replace('style={styles.card}', 'style={[styles.card, { backgroundColor: theme.backgroundDefault }]}')
content = content.replace('style={styles.reasonBox}', 'style={[styles.reasonBox, { backgroundColor: theme.backgroundSecondary }]}')
content = content.replace('style={styles.modal}', 'style={[styles.modal, { backgroundColor: theme.backgroundDefault }]}')
content = content.replace('style={styles.input}', 'style={[styles.input, { color: theme.text, borderColor: theme.border }]}')
content = content.replace('style={styles.cancel}', 'style={[styles.cancel, { backgroundColor: theme.backgroundSecondary }]}')

# errorBox
content = content.replace('style={styles.errorBox}', 'style={[styles.errorBox, { borderColor: theme.error, backgroundColor: theme.errorBg }]}')

# Button backgrounds
content = content.replace('backgroundColor: "#10B981"', 'backgroundColor: theme.success')
content = content.replace('backgroundColor: "#EF4444"', 'backgroundColor: theme.error')
content = content.replace('modal?.approve ? "#10B981" : "#EF4444"', 'modal?.approve ? theme.success : theme.error')

# ActivityIndicator colors
content = content.replace('color="#6D1B6D"', 'color={theme.primary}')
content = content.replace('color="#B91C1C"', 'color={theme.error}')
content = content.replace('color="#9CA3AF"', 'color={theme.textTertiary}')

with open('d:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/AttendanceRegularizationScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
