const fs = require('fs');

let code = fs.readFileSync('screens/admin/SiteVisitObserverScreen.tsx', 'utf8');
code = code.replace(/setObserverData\(\(prev\) =>/g, 'setObserverData((prev: any) =>');
code = code.replace(/findIndex\(\(emp\) =>/g, 'findIndex((emp: any) =>');
code = code.replace(/onSelectEmployee=\{\(emp\) =>/g, 'onSelectEmployee={(emp: any) =>');
code = code.replace(/\.filter\(\(emp\) => \{/g, '.filter((emp: any) => {');
code = code.replace(/\.some\(\(v\) =>/g, '.some((v: any) =>');
code = code.replace(/key=\{emp\.employee_id\}/g, 'key={emp.employee_id || Math.random().toString()}'); // To fix any key TS errors
fs.writeFileSync('screens/admin/SiteVisitObserverScreen.tsx', code);

let drawer = fs.readFileSync('components/observer/ObserverDetailDrawer.tsx', 'utf8');
drawer = drawer.replace(/employee\.visits\.map\(\(v, i\) => \(/g, 'employee.visits.map((v: any, i: number) => (');
drawer = drawer.replace(/employee\.tracking\.quality_status/g, 'employee.tracking.gps_quality');
drawer = drawer.replace(/employee\.tracking\.mocked/g, '(employee.tracking.source === "MOCK")');
fs.writeFileSync('components/observer/ObserverDetailDrawer.tsx', drawer);

console.log("Fixed explicit types and property names");
