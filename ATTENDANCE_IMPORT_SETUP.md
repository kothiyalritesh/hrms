# Installation Instructions for Attendance Import Feature

## 1. Install xlsx library
```bash
npm install xlsx
npm install --save-dev @types/xlsx
```

## 2. Run database migration
Apply the migration to add smartoffice_imported column:
```bash
# Using Supabase CLI
supabase db reset

# Or apply manually in Supabase dashboard
```

## 3. Add route to navigation
Add this to your admin navigation:

```typescript
<Stack.Screen
  name="AttendanceImport"
  component={AttendanceImportScreen}
  options={{ title: 'Import Attendance' }}
/>
```

## 4. Usage
1. Export attendance report from SmartOffice as Excel
2. Upload the Excel file
3. Review automatic matches (green = exact, yellow = partial, red = unmatched)
4. Manually match partial/unmatched employees by clicking suggestions
5. Click "Import X Matched Records" to import attendance

## Features
- ✅ Parses SmartOffice Excel format
- ✅ Intelligent fuzzy name matching
- ✅ Removes duplicate entries (same employee, same date)
- ✅ Manual matching for partial matches
- ✅ Shows match confidence scores
- ✅ Bulk import with error handling
- ✅ Updates existing attendance or creates new records
