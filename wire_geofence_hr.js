const fs = require('fs');
let content = fs.readFileSync('screens/admin/LiveTrackingScreen.tsx', 'utf8');

if (!content.includes('metadata,profiles')) {
  // 1. Add metadata to select
  content = content.replace(
    'select("id,user_id,alert_type,message,distance_m,resolved,created_at,escalation_level,escalated_at,profiles(name)")',
    'select("id,user_id,alert_type,message,distance_m,resolved,created_at,escalation_level,escalated_at,metadata,profiles(name)")'
  );

  // 2. Add resolveWithAction function
  const functionBlock = `  const resolveWithAction = async (alertId: string, action: "APPROVED" | "REJECTED", eventId?: string) => {
    try {
      if (eventId) {
        // It's a geofence alert, use the credit score engine
        const { error } = await supabase.rpc("rpc_resolve_geofence_violation", {
          p_event_id: eventId,
          p_resolution: action,
          p_notes: "Resolved by admin from Live Tracking",
        });
        if (error) throw error;
      }
      // Also dismiss the alert card
      const { error: alertError } = await TrackingAdminService.resolveAlert(alertId);
      if (alertError) throw alertError;
      
      setAlerts((prev) => prev.filter((a) => a.id !== alertId));
    } catch (error: any) {
      Alert.alert(
        "Action Failed",
        error?.message || "The server did not confirm this action.",
      );
    }
  };`;

  content = content.replace(
    /const resolveAlert = async \(id: string\) => \{[\s\S]*?\}\s*\};/m,
    `const resolveAlert = async (id: string) => {
      try {
        const { error } = await TrackingAdminService.resolveAlert(id);
        if (error) throw error;
        setAlerts((prev) => prev.filter((a) => a.id !== id));
      } catch (error: any) {
        Alert.alert(
          "Alert not resolved",
          error?.message || "The server did not confirm this action.",
        );
      }
    };
    
${functionBlock}`
  );

  // 3. Add to AlertCard props
  content = content.replace(
    'function AlertCard({ alert, onResolve }: { alert: any; onResolve: (id: string) => void }) {',
    'function AlertCard({ alert, onResolve, onAction }: { alert: any; onResolve: (id: string) => void; onAction: (id: string, action: "APPROVED" | "REJECTED", eventId?: string) => void }) {'
  );

  // 4. Modify AlertCard rendering
  const cardButtons = `{(!alert.resolved && alert.alert_type === 'GEOFENCE_EXIT' && alert.metadata?.geofence_event_id) ? (
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <Pressable
                style={[styles.resolveBtn, { borderColor: '#10B981', backgroundColor: '#10B98115' }]}
                onPress={() => onAction(alert.id, 'APPROVED', alert.metadata.geofence_event_id)}
              >
                <ThemedText type="caption" style={{ color: '#065F46' }}>Approve</ThemedText>
              </Pressable>
              <Pressable
                style={[styles.resolveBtn, { borderColor: '#EF4444', backgroundColor: '#EF444415' }]}
                onPress={() => onAction(alert.id, 'REJECTED', alert.metadata.geofence_event_id)}
              >
                <ThemedText type="caption" style={{ color: '#991B1B' }}>Reject</ThemedText>
              </Pressable>
            </View>
          ) : !alert.resolved && (
            <Pressable
              style={[styles.resolveBtn, { borderColor: color }]}
              onPress={() => onResolve(alert.id)}
            >
              <ThemedText type="caption" style={{ color }}>Resolve</ThemedText>
            </Pressable>
          )}`;

  content = content.replace(
    /\{\!alert\.resolved && \([\s\S]*?<\/Pressable>\n          \)\}/m,
    cardButtons
  );

  // 5. Update AlertCard usage
  content = content.replace(
    /<AlertCard key=\{a\.id\} alert=\{a\} onResolve=\{resolveAlert\} \/>/g,
    '<AlertCard key={a.id} alert={a} onResolve={resolveAlert} onAction={resolveWithAction} />'
  );

  fs.writeFileSync('screens/admin/LiveTrackingScreen.tsx', content);
  console.log('Approve/Reject added to LiveTrackingScreen');
}
