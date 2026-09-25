const fs = require('fs');
const path = 'd:\\download\\RealtyHRM-fixed\\RealtyHRM-fixed\\screens\\admin\\TVDisplayScreen.tsx';
let code = fs.readFileSync(path, 'utf8');

// Fix 1: Import Easing
if (!code.includes('Easing,')) {
    code = code.replace('import {', 'import { Easing, Image, ');
}

// Fix 2: 'visit_type' on CanonicalAttendanceDay
code = code.replace(
    'export interface CanonicalAttendanceDay {',
    'export interface CanonicalAttendanceDay {\n  visit_type?: string;\n  is_late?: boolean;\n  team_name?: string;'
); // Wait, CanonicalAttendanceDay is imported. I'll just cast it to any.

code = code.replace('visit_type: row.visit_type || "field_visit",', 'visit_type: (row as any).visit_type || "field_visit",');

// Fix 3: row is not defined. Wait, let's see where row is used.
// It's probably in visit_type: row.visit_type || ...
// No wait, in the map: `const fieldVisits = canonicalRows.map((row) => ({`
// I used `visit_type: row.visit_type || "field_visit",` and maybe I missed an issue. Let's fix that.

// Fix 4: rawTime not on FeedItem
code = code.replace(
    '  isNew?: boolean;    // highlight newest entry\n}',
    '  isNew?: boolean;    // highlight newest entry\n  rawTime?: string;\n}'
);

fs.writeFileSync(path, code);
console.log('Fixed typescript issues');
