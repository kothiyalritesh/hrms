-- Match Deepti Dhingra's HRMS account with biometric ID 248335.
BEGIN;

-- Remove the biometric ID from Deepti's duplicate profile.
UPDATE profiles
SET smartoffice_employee_code = NULL
WHERE id = '7830f1ca-f1fa-4975-a8ad-7f603e3973ae'
  AND smartoffice_employee_code = '248335';

-- Assign the biometric ID to Deepti's actual app profile.
UPDATE profiles
SET smartoffice_employee_code = '248335',
    smartoffice_synced_at = NOW()
WHERE id = '3e805687-5532-4ff7-ab82-95e7f5f6d7b7';

COMMIT;
