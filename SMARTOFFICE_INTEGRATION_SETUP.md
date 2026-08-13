# SmartOffice Integration Setup

## Initial Configuration

1. Configure `SMARTOFFICE_API_KEY`, `SMARTOFFICE_API_ACCOUNT_NAME`, and
   `SMARTOFFICE_URL` only in the SmartOffice proxy Edge Function
   environment. Never place these values in client code or documentation.

2. **Run Database Migration**: Execute the SQL migration to add SmartOffice columns:
   ```sql
   -- Run this in your Supabase SQL editor
   \i scripts/add_smartoffice_integration.sql
   ```

3. **Update RLS Policies**: Add RLS policies for the new SmartOffice columns if needed:
   ```sql
   -- Allow admins to update SmartOffice sync fields
   ALTER POLICY "Admins can update profiles" ON profiles
   USING (
     auth.uid() IN (
       SELECT id FROM profiles 
       WHERE role IN ('ADMIN', 'SYSTEM_ADMIN', 'HR', 'HRD')
     )
   );
   ```

## Usage Instructions

### Admin Panel Access
- Navigate to Admin Panel → "SmartOffice Sync"
- Only HR/HRD/ADMIN roles can access this feature

### Sync Process
1. **Full Sync**: Fetches all employees from SmartOffice API and creates/updates local records
2. **Auto-Match**: Attempts to match existing employees based on name, email, phone
3. **Manual Match**: Review and manually match employees with multiple potential matches

### Employee Matching Logic
- **Exact matches**: Email or phone number match
- **Name matches**: Exact name or partial name matching
- **Manual review**: Multiple matches require admin decision

## API Endpoints Used

- `GetEmployeeDetails` - Fetch employee information
- `GetEmployeeAttendanceLogs` - Fetch attendance data (future use)
- Additional endpoints available for biometric device management

## Database Schema Changes

New columns added to `profiles` table:
- `smartoffice_employee_code` - Unique employee code from SmartOffice
- `smartoffice_department` - Department from SmartOffice
- `smartoffice_designation` - Job title from SmartOffice  
- `smartoffice_grade` - Employee grade
- `smartoffice_location` - Work location
- `smartoffice_company` - Company name
- `smartoffice_team` - Team assignment
- `smartoffice_synced_at` - Last sync timestamp

## Troubleshooting

### Common Issues
1. **API Connection Failed**: Check if the SmartOffice URL is correct and accessible
2. **Authentication Error**: Verify the API key is valid
3. **Duplicate Employees**: Use auto-match or manual matching to resolve duplicates

### Configuration Check
```typescript
// Test through the authenticated SmartOffice proxy.
import { smartOfficeService } from '@/services/smartoffice.service';

const testConnection = async () => {
  try {
    const employees = await smartOfficeService.getEmployeeDetails();
    console.log('Connection successful:', employees.length, 'employees found');
  } catch (error) {
    console.error('Connection failed:', error.message);
  }
};
```

### Data Validation
- Employees synced from SmartOffice are created as INACTIVE by default
- Admin must manually activate new employees
- Existing employees are updated with SmartOffice data but remain active

## Future Enhancements

Possible extensions:
1. **Real-time Sync**: Webhook integration for automatic updates
2. **Attendance Sync**: Import attendance logs from biometric devices  
3. **Photo Sync**: Import employee photos from SmartOffice
4. **Device Management**: Direct biometric device control from HRMS
5. **Scheduled Sync**: Automatic daily/weekly synchronization
