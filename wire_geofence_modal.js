const fs = require('fs');
let content = fs.readFileSync('screens/DashboardScreen.tsx', 'utf8');

if (!content.includes('GeofenceReasonModal')) {
  // 1. Import
  content = content.replace(
    'import { AttendanceService } from "@/services/attendance.service";',
    'import { AttendanceService } from "@/services/attendance.service";\nimport GeofenceReasonModal from "@/components/modals/GeofenceReasonModal";'
  );

  // 2. State
  content = content.replace(
    'const [checkInMsg, setCheckInMsg] = useState<{',
    `const [geofenceEvent, setGeofenceEvent] = useState<{ id: string; distance: number } | null>(null);
  const [checkInMsg, setCheckInMsg] = useState<{`
  );

  // 3. Check for unjustified events in loadData
  const geofenceCheckCode = `
      // Check for recent geofence violations that need a reason
      const fifteenMinsAgo = new Date(Date.now() - 15 * 60000).toISOString();
      const { data: geoEvents } = await supabase
        .from("geofence_events")
        .select("id, distance_m")
        .eq("user_id", user.id)
        .eq("event_type", "OFFICE_EXIT")
        .gte("created_at", fifteenMinsAgo)
        .order("created_at", { ascending: false })
        .limit(1);
        
      if (geoEvents && geoEvents.length > 0) {
        // Check if a reason was already submitted
        const { data: reasons } = await supabase
          .from("geofence_reasons")
          .select("id")
          .eq("event_id", geoEvents[0].id);
          
        if (!reasons || reasons.length === 0) {
          setGeofenceEvent({ id: geoEvents[0].id, distance: geoEvents[0].distance_m });
        }
      }
`;

  content = content.replace(
    /setAttendanceLoading\(false\);\n    \}\n  \}, \[user\?\.id\]\);/g,
    `setAttendanceLoading(false);\n    }\n${geofenceCheckCode}  }, [user?.id]);`
  );

  // 4. Render modal at the end
  content = content.replace(
    '</ThemedView>\n  );\n}',
    `  <GeofenceReasonModal
        visible={!!geofenceEvent}
        eventId={geofenceEvent?.id || ""}
        distance={geofenceEvent?.distance || 0}
        onClose={() => setGeofenceEvent(null)}
        onSubmitSuccess={() => {
          setGeofenceEvent(null);
          loadData();
        }}
      />
    </ThemedView>
  );
}`
  );

  fs.writeFileSync('screens/DashboardScreen.tsx', content);
  console.log('GeofenceReasonModal wired into DashboardScreen.');
}
