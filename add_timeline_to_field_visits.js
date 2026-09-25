const fs = require('fs');
let content = fs.readFileSync('screens/admin/FieldVisitAdminScreen.tsx', 'utf8');

if (!content.includes('LocationTimelineModal')) {
    content = content.replace(
        'import MarkedLocationReviewPanel from "@/components/MarkedLocationReviewPanel";',
        'import MarkedLocationReviewPanel from "@/components/MarkedLocationReviewPanel";\nimport LocationTimelineModal, { PingPoint } from "@/components/LocationTimelineModal";'
    );

    content = content.replace(
        'const [today, setToday] = useState("");',
        `const [today, setToday] = useState("");
  const [timelineUser, setTimelineUser] = useState<{ id: string; name: string; date: string } | null>(null);
  const [timelinePings, setTimelinePings] = useState<PingPoint[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

  const openTimeline = useCallback(async (userId: string, name: string, date: string) => {
    setTimelineUser({ id: userId, name, date });
    setTimelineLoading(true);
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const dayStartUTC = new Date(new Date(date + "T00:00:00Z").getTime() - IST_OFFSET_MS);
    const dayEndUTC = new Date(dayStartUTC.getTime() + 24 * 60 * 60 * 1000 - 1);
    const { data } = await supabase.from("location_tracking")
      .select("latitude, longitude, recorded_at, accuracy")
      .eq("user_id", userId)
      .gte("recorded_at", dayStartUTC.toISOString())
      .lte("recorded_at", dayEndUTC.toISOString())
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .order("recorded_at", { ascending: true })
      .limit(2000);
    const pings: PingPoint[] = [];
    if (data) {
      for (const d of data) {
        if (d.latitude && d.longitude) {
          pings.push({
            latitude: d.latitude,
            longitude: d.longitude,
            recorded_at: d.recorded_at,
            accuracy: d.accuracy,
          });
        }
      }
    }
    setTimelinePings(pings);
    setTimelineLoading(false);
  }, []);`
    );

    content = content.replace(
        '</ThemedView>\n  );\n}',
        `  <LocationTimelineModal
        visible={!!timelineUser}
        employeeName={timelineUser?.name ?? ""}
        date={timelineUser?.date ?? ""}
        pings={timelinePings}
        loading={timelineLoading}
        onClose={() => setTimelineUser(null)}
      />\n    </ThemedView>\n  );\n}`
    );

    content = content.replace(
        'function DetailModal({ visit, onClose }: { visit: any; onClose: () => void }) {',
        'function DetailModal({ visit, onClose, openTimeline }: { visit: any; onClose: () => void; openTimeline?: (uid: string, name: string, date: string) => void }) {'
    );

    content = content.replace(
        '</View>\n          </View>\n\n          <ScrollView style={d.body} showsVerticalScrollIndicator={false}>',
        `  {openTimeline && (
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#EFF6FF', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: '#BFDBFE' }}
                onPress={() => { onClose(); openTimeline(visit.user_id, visit.profiles?.name || visit.employee_name || 'Employee', visit.date); }}
              >
                <Feather name="map" size={14} color="#1D4ED8" />
                <Text style={{ color: '#1D4ED8', fontSize: 13, fontWeight: '600', marginLeft: 6 }}>View Timeline</Text>
              </TouchableOpacity>
            )}
            </View>
          </View>

          <ScrollView style={d.body} showsVerticalScrollIndicator={false}>`
    );

    content = content.replace(
        '<DetailModal visit={selectedVisit} onClose={() => setSelectedVisit(null)} />',
        '<DetailModal visit={selectedVisit} onClose={() => setSelectedVisit(null)} openTimeline={openTimeline} />'
    );

    fs.writeFileSync('screens/admin/FieldVisitAdminScreen.tsx', content);
    console.log('LocationTimelineModal added.');
} else {
    console.log('LocationTimelineModal already present.');
}
