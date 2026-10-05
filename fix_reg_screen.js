const fs = require('fs');
let code = fs.readFileSync('screens/admin/AttendanceRegularizationScreen.tsx', 'utf8');

code = code.replace(/style=\{styles\.container\}/g, 'style={[styles.container, { backgroundColor: theme.backgroundRoot }]}');
code = code.replace(/style=\{styles\.filters\}/g, 'style={[styles.filters, { backgroundColor: theme.backgroundDefault }]}');
code = code.replace(/style=\{\[styles\.filter, filter === f \? styles\.active : null\]\}/g, 'style={[styles.filter, { borderColor: theme.border }, filter === f ? { backgroundColor: theme.primary, borderColor: theme.primary } : null]}');
code = code.replace(/style=\{styles\.muted\}/g, 'style={[styles.muted, { color: theme.textSecondary }]}');
code = code.replace(/style=\{styles\.card\}/g, 'style={[styles.card, { backgroundColor: theme.backgroundDefault }]}');
code = code.replace(/style=\{styles\.badge\}/g, 'style={[styles.badge, { backgroundColor: theme.primary + "15" }]}');
code = code.replace(/style=\{styles\.badgeText\}/g, 'style={[styles.badgeText, { color: theme.primary }]}');
code = code.replace(/style=\{styles\.reasonBox\}/g, 'style={[styles.reasonBox, { backgroundColor: theme.backgroundSecondary }]}');
code = code.replace(/style=\{styles\.overlay\}/g, 'style={[styles.overlay, { backgroundColor: "rgba(0,0,0,0.5)" }]}');
code = code.replace(/style=\{styles\.modal\}/g, 'style={[styles.modal, { backgroundColor: theme.backgroundDefault }]}');
code = code.replace(/style=\{styles\.input\}/g, 'style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundRoot }]}');

// actions buttons
code = code.replace(/style=\{\[\s*styles\.button,\s*styles\.cancel\s*\]\}/g, 'style={[styles.button, styles.cancel, { backgroundColor: theme.backgroundSecondary }]}');
code = code.replace(/style=\{\[\s*styles\.button,\s*\]\}/g, 'style={[styles.button, { backgroundColor: theme.primary }]}');

// Name text color
code = code.replace(/style=\{styles\.name\}/g, 'style={[styles.name, { color: theme.text }]}');

// Title text color
code = code.replace(/style=\{styles\.title\}/g, 'style={[styles.title, { color: theme.text }]}');

fs.writeFileSync('screens/admin/AttendanceRegularizationScreen.tsx', code);
console.log("Replaced JSX inline styles");
