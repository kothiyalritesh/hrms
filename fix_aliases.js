const fs = require('fs');
let content = fs.readFileSync('services/canonical-attendance.service.ts', 'utf8');

const injection = `
/** Compatibility projection while older cards are migrated to v3 field names. */
export function withAttendanceV2Aliases(row: CanonicalAttendanceDay) {
  return {
    ...row,
    date: row.work_date,
    name: row.employee_name,
    team: row.team_name,
    reports_to: row.team_head_id,
    app_in: row.app_first_in,
    app_out: row.app_checkout,
    bio_in: row.biometric_first_in,
    bio_out: row.biometric_last_punch_evidence,
    final_in: row.official_first_in,
    final_out: row.official_last_out,
    report_status: row.attendance_status,
    suggested_status:
      row.official_first_in && !row.official_last_out ? "NO_CHECKOUT" : null,
  };
}
`;

if (!content.includes('withAttendanceV2Aliases')) {
  content += '\n' + injection;
  fs.writeFileSync('services/canonical-attendance.service.ts', content);
  console.log('Restored withAttendanceV2Aliases');
} else {
  console.log('Already present');
}
