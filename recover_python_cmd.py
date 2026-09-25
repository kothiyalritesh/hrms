
import re

with open(r'd:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\TVDisplayScreen.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# Add imports
code = code.replace(
    'import { StyleSheet, View, Text, ScrollView, Modal,',
    'import { StyleSheet, View, Text, ScrollView, Modal, Image, Easing,'
)
code = code.replace(
    'import { supabase } from \"@/lib/supabase\";',
    'import { supabase } from \"@/lib/supabase\";\nimport { Audio } from \"expo-av\";'
)

# Fix FeedItem
code = code.replace(
    '  isNew?: boolean;    // highlight newest entry\n}',
    '  isNew?: boolean;    // highlight newest entry\n  rawTime: string;\n}'
)

# Add Fullscreen Button in Header and BOP Logo
header_find = '''        <View style={s.brand}>
          <Text style={s.brandBop}>
            bop<Text style={{ color: C.pink }}>.in</Text>
          </Text>
          <Text style={s.brandSub}>  LIVE ATTENDANCE</Text>
        </View>'''
header_repl = '''        <View style={s.brand}>
          <Image source={require('@/assets/images/logo.png')} style={{ width: 80, height: 30, resizeMode: 'contain', marginRight: 8 }} />
          <Text style={s.brandSub}>  LIVE ATTENDANCE</Text>
        </View>
        {IS_WEB && (
          <Pressable onPress={() => { if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen(); }} style={{ padding: 6, marginLeft: 10 }}>
            <Text style={{ color: C.text, fontSize: 18 }}>â›¶</Text>
          </Pressable>
        )}'''
code = code.replace(header_find, header_repl)

# Sound alert hook inside main component
sound_code = '''
  const prevFeedLengthRef = useRef(0);
  useEffect(() => {
    if (prevFeedLengthRef.current !== 0 && feed.length > prevFeedLengthRef.current) {
      if (feed.some(f => f.isNew && f.isIn)) {
        (async () => {
          try {
            const { sound } = await Audio.Sound.createAsync(require('@/assets/sounds/arrival_ping.wav'));
            await sound.playAsync();
          } catch(e) {}
        })();
      }
    }
    prevFeedLengthRef.current = feed.length;
  }, [feed]);
'''
code = code.replace('const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);', 'const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);\n' + sound_code)

# Add new states
state_code = '''
  const [lateCount, setLateCount] = useState(0);
  const [leaveCount, setLeaveCount] = useState(0);
  const [latePeople, setLatePeople] = useState<PersonItem[]>([]);
  const [leavePeople, setLeavePeople] = useState<PersonItem[]>([]);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [forecast, setForecast] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
'''
code = code.replace('const [fraudPeople,   setFraudPeople]   = useState<FraudPerson[]>([]);', state_code + '\n  const [fraudPeople,   setFraudPeople]   = useState<FraudPerson[]>([]);')
code = code.replace('const [modal,         setModal]         = useState<null|\"present\"|\"absent\"|\"meetings\"|\"route\">(null);', 'const [modal,         setModal]         = useState<null|\"present\"|\"absent\"|\"meetings\"|\"route\"|\"late\"|\"leave\">(null);')

# In load() queries
queries_find = '''      const [canonicalData, alertResult] = await Promise.all(['''
queries_repl = '''
      const tom = new Date();
      tom.setDate(tom.getDate() + 1);
      const tomStr = tom.toISOString().split('T')[0];
      const todayStart = today + 'T00:00:00+05:30';

      const [canonicalData, alertResult, visitsResult, leavesResult] = await Promise.all([
'''
code = code.replace(queries_find, queries_repl)

query_args_find = '''          .order(\"created_at\", { ascending: false })
          .limit(10),
      ]);'''
query_args_repl = '''          .order(\"created_at\", { ascending: false })
          .limit(10),
        supabase.from(\"field_visits\").select(\"user_id, status, created_at\").eq(\"status\", \"COMPLETED\").gte(\"created_at\", todayStart),
        supabase.from(\"leave_requests\").select(\"user_id, start_date, end_date\").eq(\"status\", \"approved\").lte(\"start_date\", tomStr).gte(\"end_date\", tomStr)
      ]);
'''
code = code.replace(query_args_find, query_args_repl)

# Processing stats
stats_find = '''const fraudList: FraudPerson[] = [];'''
stats_repl = '''
      const fraudList: FraudPerson[] = [];
      const lateList: PersonItem[] = [];
      const leaveList: PersonItem[] = [];
      let lateCnt = 0;
      let leaveCnt = 0;
      const teamStats = new Map<string, any>();
'''
code = code.replace(stats_find, stats_repl)

loop_find = '''        if (occupancy.isActivelyWorking) {'''
loop_repl = '''
        const tName = (row as any).team_name || "Unassigned";
        if (!teamStats.has(tName)) teamStats.set(tName, { name: tName, present: 0, total: 0 });
        teamStats.get(tName).total++;
        if (occupancy.isActivelyWorking) teamStats.get(tName).present++;

        if ((row as any).is_late) {
          lateCnt++;
          lateList.push({ name: p.name, sub: "Late Arrival" });
        }
        if (canonicalStatus === "ON_LEAVE") {
          leaveCnt++;
          leaveList.push({ name: p.name, sub: "On Leave" });
        }

        if (occupancy.isActivelyWorking) {'''
code = code.replace(loop_find, loop_repl)

# Fixing feed sort and meetCount
visit_fix_find = '''const v = visitMap.get(p.id);
            return v?.visit_type === \"meeting\" && v?.status === \"CHECKED_IN\";'''
code = code.replace(
    'visit_type: \"field_visit\",',
    'visit_type: row.visit_type || \"field_visit\",'
)
code = code.replace(
    'if (visit && visit.status === \"CHECKED_IN\") {',
    'if (visit && visit.status === \"CHECKED_IN\" && visit.visit_type === \"meeting\") {'
)

feed_push_in = '''        feedItems.push({
          key:    a.user_id + "_in_" + a.checkin_time,
          name:   prof.name ?? "Unknown",
          office: oName,
          time:   a.checkin_time ? toIST(a.checkin_time) : "â€”",
          isIn:   true,
          isNew:  feedItems.length === 0,
        });'''
feed_push_in_repl = '''        feedItems.push({
          key:    a.user_id + "_in_" + a.checkin_time,
          name:   prof.name ?? "Unknown",
          office: oName,
          time:   a.checkin_time ? toIST(a.checkin_time) : "â€”",
          isIn:   true,
          isNew:  feedItems.length === 0,
          rawTime: a.checkin_time || "",
        });'''
code = code.replace(feed_push_in, feed_push_in_repl)

feed_push_out = '''          feedItems.push({
            key:    a.user_id + "_out_" + a.checkout_time,
            name:   prof.name ?? "Unknown",
            office: oName,
            time:   toIST(a.checkout_time),
            isIn:   false,
            isNew:  false,
          });'''
feed_push_out_repl = '''          feedItems.push({
            key:    a.user_id + "_out_" + a.checkout_time,
            name:   prof.name ?? "Unknown",
            office: oName,
            time:   toIST(a.checkout_time),
            isIn:   false,
            isNew:  false,
            rawTime: a.checkout_time || "",
          });'''
code = code.replace(feed_push_out, feed_push_out_repl)

feed_sort = '''      feedItems.sort((a, b) => b.time.localeCompare(a.time));'''
feed_sort_repl = '''      feedItems.sort((a, b) => new Date(b.rawTime || 0).getTime() - new Date(a.rawTime || 0).getTime());'''
code = code.replace(feed_sort, feed_sort_repl)

# Processing Leaderboard & Forecast
process_add = '''
      // Leaderboard
      const vCounts = {};
      for (const v of visitsResult.data || []) {
        vCounts[v.user_id] = (vCounts[v.user_id] || 0) + 1;
      }
      const lb = Object.entries(vCounts).map(([uid, cnt]) => ({
        name: profMap.get(uid)?.name || 'Unknown', count: cnt
      })).sort((a: any, b: any) => b.count - a.count).slice(0, 3);
      setLeaderboard(lb);

      // Forecast
      const fc = (leavesResult.data || []).map((l: any) => ({
        name: profMap.get(l.user_id)?.name || 'Unknown'
      }));
      setForecast(fc);

      setTeams(Array.from(teamStats.values()));
'''
commit_find = '''      setPresent(presentCount);'''
commit_repl = process_add + '''
      setLateCount(lateCnt);
      setLeaveCount(leaveCnt);
      setLatePeople(lateList);
      setLeavePeople(leaveList);
      setPresent(presentCount);'''
code = code.replace(commit_find, commit_repl)


# Auto-scroll for LIVE CHECK-IN FEED
auto_scroll_anim = '''  const [autoRotate, setAutoRotate] = useState(true);'''
auto_scroll_repl = '''  const [autoRotate, setAutoRotate] = useState(true);
  const feedScrollAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (feed.length === 0) return;
    const totalH = feed.length * 66; // approx row height
    Animated.loop(
      Animated.timing(feedScrollAnim, {
        toValue: -totalH,
        duration: feed.length * 2000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();
  }, [feed.length]);
'''
code = code.replace(auto_scroll_anim, auto_scroll_repl)

# Update Stat Pills UI
stat_pills_find = '''        <StatPill value={fraudCount} label=\"FRAUD\"    color={C.purple} icon=\"âš ï¸\" onPress={() => setShowFraud(true)} />'''
stat_pills_repl = stat_pills_find + '''
        <StatPill value={lateCount} label=\"LATE\" color=\"#ef4444\" icon=\"â°\" onPress={() => setModal(\"late\")} />
        <StatPill value={leaveCount} label=\"ON LEAVE\" color=\"#6366f1\" icon=\"ðŸ–ï¸\" onPress={() => setModal(\"leave\")} />
'''
code = code.replace(stat_pills_find, stat_pills_repl)


# Modals for Late & Leave
modals_find = '''      {/* â”€â”€ FRAUD MODAL â”€â”€ */}'''
modals_repl = '''      {/* â”€â”€ LATE MODAL â”€â”€ */}
      <PeopleModal visible={modal === \"late\"} title={`â° Late Arrivals (${lateCount})`} dotColor=\"#ef4444\" emptyMsg=\"No late arrivals\" onClose={() => setModal(null)}>
        {latePeople.length === 0 ? <Text style={[s.fraudReason, { padding: 16 }]}>No late arrivals</Text> : latePeople.map((p, i) => <PersonRow key={i} name={p.name} sub={p.sub} dotColor=\"#ef4444\" />)}
      </PeopleModal>
      {/* â”€â”€ LEAVE MODAL â”€â”€ */}
      <PeopleModal visible={modal === \"leave\"} title={`ðŸ–ï¸ On Leave (${leaveCount})`} dotColor=\"#6366f1\" emptyMsg=\"No one on leave\" onClose={() => setModal(null)}>
        {leavePeople.length === 0 ? <Text style={[s.fraudReason, { padding: 16 }]}>No one on leave</Text> : leavePeople.map((p, i) => <PersonRow key={i} name={p.name} sub={p.sub} dotColor=\"#6366f1\" />)}
      </PeopleModal>
      {/* â”€â”€ FRAUD MODAL â”€â”€ */}'''
code = code.replace(modals_find, modals_repl)


# Panels Replacement for Teams & Forecast & Leaderboard & Feed Scroll
# In Web view
web_feed_find = '''<ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
              {(() => {
                const totalPages = Math.max(1, Math.ceil(feed.length / PAGE_SIZE));
                const page = feedPage % totalPages;
                const pageFeed = feed.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
                return feed.length === 0
                  ? <Text style={s.empty}>No check-ins today yet</Text>
                  : pageFeed.map(item => <FeedRow key={item.key} item={item} />);
              })()}
            </ScrollView>'''
web_feed_repl = '''<View style={{ flex: 1, overflow: 'hidden' }}>
              <Animated.View style={{ transform: [{ translateY: feedScrollAnim }] }}>
                {feed.length === 0 ? <Text style={s.empty}>No check-ins today yet</Text> : [...feed, ...feed].map((item, i) => <FeedRow key={item.key+'_'+i} item={item} />)}
              </Animated.View>
            </View>'''
code = code.replace(web_feed_find, web_feed_repl)
code = code.replace(web_feed_find.replace('flex: 1', 'flex: 1 '), web_feed_repl) # Just in case

mobile_feed_find = '''{(() => {
              const totalPages = Math.max(1, Math.ceil(feed.length / PAGE_SIZE));
              const page = feedPage % totalPages;
              const pageFeed = feed.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
              return feed.length === 0
                ? <Text style={s.empty}>No check-ins today yet</Text>
                : pageFeed.map(item => <FeedRow key={item.key} item={item} />);
            })()}'''
mobile_feed_repl = '''<View style={{ height: 400, overflow: 'hidden' }}>
              <Animated.View style={{ transform: [{ translateY: feedScrollAnim }] }}>
                {feed.length === 0 ? <Text style={s.empty}>No check-ins today yet</Text> : [...feed, ...feed].map((item, i) => <FeedRow key={item.key+'_'+i} item={item} />)}
              </Animated.View>
            </View>'''
code = code.replace(mobile_feed_find, mobile_feed_repl)


new_panels = '''
          <View style={s.panel}>
            <Text style={s.panelTitle}>TEAMS & FORECAST</Text>
            <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
              <Text style={[s.occName, {marginTop: 10, marginBottom: 5, color: C.teal}]}>Team Attendance</Text>
              {teams.map((t, i) => <OccupancyRow key={i} stat={{id: t.name, name: t.name, present: t.present, total: t.total}} />)}
              <Text style={[s.occName, {marginTop: 15, marginBottom: 5, color: C.pink}]}>Tomorrow's Leave Forecast</Text>
              {forecast.length === 0 ? <Text style={s.feedOffice}>No approved leaves</Text> : forecast.map((f, i) => <Text key={i} style={s.feedName}>â€¢ {f.name}</Text>)}
              <Text style={[s.occName, {marginTop: 15, marginBottom: 5, color: C.amber}]}>Site Visit Leaderboard</Text>
              {leaderboard.length === 0 ? <Text style={s.feedOffice}>No visits yet</Text> : leaderboard.map((l, i) => <Text key={i} style={s.feedName}>{i+1}. {l.name} ({l.count})</Text>)}
            </ScrollView>
          </View>
'''
code = code.replace('<View style={s.panel}>\n            <Text style={s.panelTitle}>OFFICE OCCUPANCY</Text>', new_panels + '\n          <View style={s.panel}>\n            <Text style={s.panelTitle}>OFFICE OCCUPANCY</Text>')


# Mobile equivalent for new panels
m_new_panels = '''
          <View style={s.mCol}>
            <Text style={[s.panelTitle, { marginBottom: 16 }]}>TEAMS & FORECAST</Text>
            <Text style={[s.occName, {marginTop: 10, marginBottom: 5, color: C.teal}]}>Team Attendance</Text>
            {teams.map((t, i) => <OccupancyRow key={i} stat={{id: t.name, name: t.name, present: t.present, total: t.total}} />)}
            <Text style={[s.occName, {marginTop: 15, marginBottom: 5, color: C.pink}]}>Tomorrow's Leave Forecast</Text>
            {forecast.length === 0 ? <Text style={s.feedOffice}>No approved leaves</Text> : forecast.map((f, i) => <Text key={i} style={s.feedName}>â€¢ {f.name}</Text>)}
            <Text style={[s.occName, {marginTop: 15, marginBottom: 5, color: C.amber}]}>Site Visit Leaderboard</Text>
            {leaderboard.length === 0 ? <Text style={s.feedOffice}>No visits yet</Text> : leaderboard.map((l, i) => <Text key={i} style={s.feedName}>{i+1}. {l.name} ({l.count})</Text>)}
          </View>
'''
code = code.replace('<View style={s.mCol}>\n            <Text style={[s.panelTitle, { marginBottom: 16 }]}>OFFICE OCCUPANCY</Text>', m_new_panels + '\n          <View style={s.mCol}>\n            <Text style={[s.panelTitle, { marginBottom: 16 }]}>OFFICE OCCUPANCY</Text>')

# Red Flag Ticker Tape (bottom)
ticker_anim_setup = '''
  const tickerAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (fraudPeople.length === 0) return;
    Animated.loop(
      Animated.timing(tickerAnim, {
        toValue: -SW * 2,
        duration: 15000 + fraudPeople.length * 2000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();
  }, [fraudPeople.length]);
'''
code = code.replace('const feedScrollAnim = useRef(new Animated.Value(0)).current;', 'const feedScrollAnim = useRef(new Animated.Value(0)).current;' + ticker_anim_setup)

ticker_ui = '''
      {fraudPeople.length > 0 && (
        <View style={{ backgroundColor: '#450a0a', paddingVertical: 8, overflow: 'hidden', borderTopWidth: 1, borderTopColor: '#7f1d1d' }}>
          <Animated.View style={{ flexDirection: 'row', transform: [{ translateX: tickerAnim }] }}>
             {[...fraudPeople, ...fraudPeople, ...fraudPeople].map((p, i) => (
                <Text key={i} style={{ color: '#fca5a5', fontSize: 14, fontWeight: '700', marginRight: 50 }}>
                   âš ï¸ {p.name} - {p.reason}
                </Text>
             ))}
          </Animated.View>
        </View>
      )}
    </View>
  );
}'''
code = code.replace('    </View>\n  );\n}', ticker_ui)

with open(r'd:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\TVDisplayScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

print('done')
