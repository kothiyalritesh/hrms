const fs = require('fs');
const path = 'd:\\download\\RealtyHRM-fixed\\RealtyHRM-fixed\\screens\\admin\\TVDisplayScreen.tsx';
let code = fs.readFileSync(path, 'utf8');

// Fix 1: Import Easing
if (!code.includes('Easing,')) {
    code = code.replace('import { StyleSheet, View, Text, ScrollView, Modal, Image,', 'import { StyleSheet, View, Text, ScrollView, Modal, Image, Easing,');
    if (!code.includes('Easing,')) {
         code = code.replace('import { StyleSheet, View, Text, ScrollView, Modal,', 'import { StyleSheet, View, Text, ScrollView, Modal, Image, Easing,');
    }
}

// Fix 2: Property 'visit_type' does not exist on type 'CanonicalAttendanceDay'
code = code.replace('visit_type: row.visit_type || "field_visit",', 'visit_type: (row as any).visit_type || "field_visit",');

// Fix 3: row is not defined in loop
code = code.replace(
    'const tName = (row as any).team_name || "Unassigned";',
    'const row = canonicalRows.find(r => r.user_id === p.id) || {};\n        const tName = (row as any).team_name || "Unassigned";'
);

// Fix 4: Property 'rawTime' does not exist on type 'FeedItem'
code = code.replace(
    '  isNew?: boolean;    // highlight newest entry\n}',
    '  isNew?: boolean;    // highlight newest entry\n  rawTime?: string;\n}'
);

fs.writeFileSync(path, code);
console.log('Fixed TS issues');
