# Office Capacity & Live Location Map Implementation

## Changes Made

### 1. Database Migration (`scripts/add_office_capacity.sql`)
- Added `capacity` column to `offices` table
- Default capacity: 50 (can be adjusted per office)
- Separate from `attendance_radius` (geofence radius)

```sql
ALTER TABLE offices 
ADD COLUMN IF NOT EXISTS capacity INTEGER DEFAULT 50;

UPDATE offices 
SET capacity = 50 
WHERE capacity IS NULL;
```

**Run this migration in Supabase SQL Editor**

### 2. MyTeamScreen.tsx Updates

#### Office Occupancy Section
- Changed from `attendance_radius` to `capacity` for occupancy calculations
- Now shows: `2/50 Present` where 50 = actual office capacity (not geofence radius)

#### Live Location Map
- Added **Live Location Map** section showing all team members on Google Maps
- Uses `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`; restrict the key to the production web origins and mobile app identifiers.
- Shows map on web, coordinates on mobile app
- Multiple pins for team members with driving directions

#### Team Size Calculation
- Changed from team attendance count to total team members count
- Now shows total team size: `All Team Members (2)` where 2 = total assigned members

### 3. ReportsScreen.tsx Updates

#### Office Occupancy Cards
- Updated to use `office.capacity` instead of `attendance_radius`
- Now shows: `Capacity: 50 | Geo-fence: 50m` in subtitle

## How It Works

### For Admin/HRD (ReportsScreen)
```
Before: "Sector 63 - 2/50 Present" (50 = geofence radius)
After:  "Sector 63 - 2/50 Present" (50 = actual office capacity)
```

### For Team Managers (MyTeamScreen)
```
Before: "Office Occupancy - 2/50" (50 = geofence radius)
After:  "Office Occupancy - 2/50" (50 = office capacity)

"All Team Members (2)" shows total assigned team members
"Live Location Map" shows all team members on Google Maps
```

## Google Maps Integration

### Existing API Key
```javascript
const GMAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
```

### Features
1. **Live Location Map** - Shows all checked-in team members
2. **Directions Mode** - Multiple stops with route
3. **Web Support** - Full interactive maps
4. **Mobile Support** - Coordinates display (no iframe)

## Next Steps

1. **Run the migration** in Supabase SQL Editor:
   - Open Supabase Dashboard → SQL Editor
   - Copy contents from `scripts/add_office_capacity.sql`
   - Execute the migration

2. **Configure Office Capacities** (optional):
   - Update specific office capacities:
   ```sql
   UPDATE offices SET capacity = 30 WHERE name = 'Sector 63';
   UPDATE offices SET capacity = 25 WHERE name = 'Gurugram';
   ```

3. **Test the changes**:
   - Open ReportsScreen as Admin/HRD
   - Open MyTeamScreen as Team Lead
   - Verify capacity numbers and live maps work

## Files Modified

1. `scripts/add_office_capacity.sql` (NEW)
2. `screens/MyTeamScreen.tsx` (UPDATED)
3. `screens/admin/ReportsScreen.tsx` (UPDATED)

## Benefits

✅ **Accurate Capacity Tracking** - Separate geofence from actual seating capacity
✅ **Team-Based Metrics** - Shows actual team size instead of office capacity
✅ **Live Location Maps** - Real-time tracking of all team members
✅ **Better UX** - Clearer occupancy percentages and team stats
