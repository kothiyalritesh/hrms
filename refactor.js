const fs = require('fs');
let src = fs.readFileSync('screens/admin/AttendanceControlScreenNew.tsx', 'utf8');

const mapStartStr = "        ) : activeTab === 'app' && (";
const mapCodeStr = "          grouped.map(({ date, appOnly, bioOnly, both, otherAttendance, noAttendance }) => {";
const mapStartIdx = src.indexOf(mapCodeStr);

if (mapStartIdx === -1) {
    console.error("Could not find grouped.map");
    process.exit(1);
}

// Find the end of `grouped.map(...)`
let parens = 0;
let foundParens = false;
let mapEndIdx = -1;
for (let i = mapStartIdx; i < src.length; i++) {
    if (src[i] === '(') { parens++; foundParens = true; }
    else if (src[i] === ')') parens--;
    
    if (foundParens && parens === 0) {
        mapEndIdx = i;
        break;
    }
}

// We will replace everything from `grouped.map` to `mapEndIdx` + 1 with the FlatList.
const beforeMap = src.substring(0, mapStartIdx);
const afterMap = src.substring(mapEndIdx + 1);

const flatListStr = `          <FlatList
            data={grouped}
            keyExtractor={(item) => item.date}
            renderItem={renderDateGroup}
            removeClippedSubviews={true}
            maxToRenderPerBatch={5}
            windowSize={7}
            initialNumToRender={3}
            scrollEnabled={false}
          />`;

src = beforeMap + flatListStr + afterMap;

// Now insert `renderDateGroup` right before `return (` of the main component.
// The main return is `return (\n    <View style={[s.container, { backgroundColor: theme.backgroundRoot, flex: 1 }]}>`
const mainReturnRegex = /  return \([\r\n\s]*<View style=\{\{ flex: 1, backgroundColor: theme\.backgroundRoot \}\}>/;
const match = src.match(mainReturnRegex);
const mainReturnIdx = match ? match.index : -1;
if (mainReturnIdx === -1) { console.error("Could not find main return"); process.exit(1); }

const renderDateGroupStr = `
  const renderDateGroup = useCallback(
    ({ item: group }: { item: DateGroup }) => {
      const { date, appOnly, bioOnly, both, otherAttendance, noAttendance } = group;
      const expanded = expandedDates.has(date);
      const presentCount = both.length + appOnly.length + bioOnly.length + otherAttendance.length;
      const absentCount = noAttendance.filter((r) =>
        ["ABSENT", "NO_DATA", "CONFIG_REQUIRED"].includes(String(r.status).toUpperCase()),
      ).length;
      const bothUserIds = [...new Set(both.map((r) => r.user_id))];

      return (
        <DateGroupRow
          date={date}
          expanded={expanded}
          presentCount={presentCount}
          absentCount={absentCount}
          bothUserIds={bothUserIds}
          both={both}
          appOnly={appOnly}
          bioOnly={bioOnly}
          otherAttendance={otherAttendance}
          noAttendance={noAttendance}
          today={today}
          textColor={textColor}
          theme={theme}
          deviceAllPunches={deviceAllPunches}
          devicePunchMap={devicePunchMap}
          fmtPunch={fmtPunch}
          onToggle={toggleDate}
          onTimeline={openTimeline}
          onCorrect={correctAttendance}
        />
      );
    },
    [expandedDates, today, textColor, theme, deviceAllPunches, devicePunchMap, fmtPunch, openTimeline, correctAttendance],
  );

`;

src = src.substring(0, mainReturnIdx) + renderDateGroupStr + src.substring(mainReturnIdx);


// Now insert DateGroupRow ABOVE the main component export.
// `export default function AttendanceControlScreenNew() {`
const componentExportStr = "export default function AttendanceControlScreenNew() {";
const componentExportIdx = src.indexOf(componentExportStr);

// I need to extract the original body of `grouped.map` to put into `DateGroupRow`.
// Let's read it from the original source.
const originalSrc = fs.readFileSync('screens/admin/AttendanceControlScreenNew.tsx', 'utf8');
const origMapStartIdx = originalSrc.indexOf(mapCodeStr);
let arrowIdx = originalSrc.indexOf('=>', origMapStartIdx);
let bodyStartIdx = originalSrc.indexOf('{', arrowIdx) + 1;
let bodyEndIdx = originalSrc.lastIndexOf('}', mapEndIdx); // wait, mapEndIdx is from the old code

let origParens = 0;
let origFoundParens = false;
let origMapEndIdx = -1;
for (let i = origMapStartIdx; i < originalSrc.length; i++) {
    if (originalSrc[i] === '(') { origParens++; origFoundParens = true; }
    else if (originalSrc[i] === ')') origParens--;
    
    if (origFoundParens && origParens === 0) {
        origMapEndIdx = i;
        break;
    }
}
bodyEndIdx = originalSrc.lastIndexOf('}', origMapEndIdx);

let mapBody = originalSrc.substring(bodyStartIdx, bodyEndIdx);

// Now in `mapBody`, we need to replace all references to:
// openTimeline -> onTimeline
// correctAttendance -> onCorrect
// toggleDate -> onToggle
mapBody = mapBody.replace(/openTimeline\(/g, "onTimeline(");
mapBody = mapBody.replace(/correctAttendance\(/g, "onCorrect(");
mapBody = mapBody.replace(/toggleDate\(/g, "onToggle(");

const dateGroupRowStr = `
const DateGroupRow = memo(function DateGroupRow({
  date, expanded, presentCount, absentCount,
  bothUserIds, both, appOnly, bioOnly, otherAttendance, noAttendance,
  today, textColor, theme, deviceAllPunches, devicePunchMap,
  fmtPunch, onToggle, onTimeline, onCorrect,
}: {
  date: string;
  expanded: boolean;
  presentCount: number;
  absentCount: number;
  bothUserIds: string[];
  both: AttendanceRecord[];
  appOnly: AttendanceRecord[];
  bioOnly: AttendanceRecord[];
  otherAttendance: AttendanceRecord[];
  noAttendance: AttendanceRecord[];
  today: string;
  textColor: string;
  theme: any;
  deviceAllPunches: Record<string, string[]>;
  devicePunchMap: Record<string, { first: string; last: string | null }>;
  fmtPunch: (t: string) => string;
  onToggle: (date: string) => void;
  onTimeline: (id: string, name: string, date: string) => void;
  onCorrect: (r: AttendanceRecord) => void;
}) {
  ${mapBody}
});
`;

src = src.substring(0, componentExportIdx) + dateGroupRowStr + src.substring(componentExportIdx);

fs.writeFileSync('screens/admin/AttendanceControlScreenNew.tsx', src);
console.log("Refactoring complete.");
