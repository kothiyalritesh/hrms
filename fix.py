import re

with open('d:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/AttendanceRegularizationScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Add useTheme import if not there
if 'useTheme' not in content:
    content = content.replace('import { useAuth } from "@/contexts/AuthContext";', 'import { useAuth } from "@/contexts/AuthContext";\nimport { useTheme } from "@/hooks/useTheme";')

# Add const theme = useTheme();
if 'const theme = useTheme();' not in content:
    content = content.replace('const { user } = useAuth();', 'const { user } = useAuth();\n  const theme = useTheme();')

# Replace styles
content = content.replace('style={styles.container}', 'style={[styles.container, { backgroundColor: theme.backgroundDefault }]}')
content = content.replace('style={styles.filters}', 'style={[styles.filters, { backgroundColor: theme.surface }]}')
content = content.replace('styles.filter,', 'styles.filter, { borderColor: theme.border },')
content = content.replace('styles.active,', 'styles.active, { backgroundColor: theme.primary, borderColor: theme.primary },')
content = content.replace('style={styles.card}', 'style={[styles.card, { backgroundColor: theme.surface }]}')
content = content.replace('style={styles.reasonBox}', 'style={[styles.reasonBox, { backgroundColor: theme.backgroundDefault }]}')
content = content.replace('style={styles.modal}', 'style={[styles.modal, { backgroundColor: theme.surface }]}')
content = content.replace('style={styles.input}', 'style={[styles.input, { color: theme.text, borderColor: theme.border }]}')
content = content.replace('style={styles.cancel}', 'style={[styles.cancel, { backgroundColor: theme.backgroundDefault }]}')
content = content.replace('color: "#6B7280"', 'color: theme.textSecondary')
content = content.replace('color="#6D1B6D"', 'color={theme.primary}')
content = content.replace('backgroundColor: "#F5EAF5"', 'backgroundColor: theme.primary + "1A"') # 10% opacity
content = content.replace('color: "#6D1B6D"', 'color: theme.primary')
content = content.replace('color="#9CA3AF"', 'color={theme.textSecondary}')

with open('d:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/AttendanceRegularizationScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
