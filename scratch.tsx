 date, appOnly, bioOnly, both, otherAttendance, noAttendance }) => {
            const expanded = expandedDates.has(date);
            const presentCount =
              both.length + appOnly.length + bioOnly.length + otherAttendance.length;
            const absentCount = noAttendance.filter((item) =>
              ["ABSENT", "NO_DATA", "CONFIG_REQUIRED"].includes(
                String(item.status).toUpperCase(),
              ),
            ).length;

            const renderRecord = (item: AttendanceRecord) => {
              const isBio = item.smartoffice_imported === true || item.attendance_type === 'BIOMETRIC';
              const cinTime = fmt(item.checkin_time);
              const coutTime = item.checkout_time ? fmt(item.checkout_time) : null;
              const statusColor = item.status === 'CHECKED_OUT' ? Colors.light.success
                : item.status === 'CHECKED_IN' ? Colors.light.info : Colors.light.error;
              const isLate = isServerConfirmedLate(item);
              return (
                <View key={item.id} style={[s.recordCard, { backgroundColor: theme.backgroundDefault }]}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <View style={{ flex: 1 }}>
                      <ThemedText style={[s.empName, { color: textColor }]}>{item.employee_name}</ThemedText>
                      <ThemedText style={[s.meta, { color: theme.textSecondary }]}>{(item as any).check_in_office_name ?? item.office_name}</ThemedText>
                      <View style={{ flexDirection: 'row', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
                        <View style={s.timeChip}>
                          <Feather name="log-in" size={11} color="#10B981" />
                          <ThemedText style={[s.timeText, { color: textColor }]}>{cinTime}</ThemedText>
                        </View>
                        {coutTime && (
                          <View style={s.timeChip}>
                            <Feather name="log-out" size={11} color="#EF4444" />
                            <ThemedText style={[s.timeText, { color: textColor }]}>{coutTime}</ThemedText>
                          </View>
                        )}
                        {item.distance_from_office ? (
                          <View style={s.timeChip}>
                            <Feather name="map-pin" size={11} color="#6B7280" />
                            <ThemedText style={[s.timeText, { color: textColor }]}>{item.distance_from_office}m</ThemedText>
                          </View>
                        ) : null}
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <View style={[s.statusBadge, { backgroundColor: statusColor + '20' }]}>
                        <ThemedText style={[s.statusText, { color: statusColor }]}>
                          {attendanceStatusLabel(item, today)}
                        </ThemedText>
                      </View>
                      {isLate && (
                        <View style={[s.statusBadge, { backgroundColor: Colors.light.warning + '20' }]}>
                          <ThemedText style={[s.statusText, { color: Colors.light.warning }]}>Late</ThemedText>
                        </View>
                      )}
                      {item.warning && <Feather name="alert-triangle" size={14} color={Colors.light.warning} />}
                      {!isBio && (
                        <TouchableOpacity style={s.timelineBtn} onPress={() => openTimeline(item.user_id, item.employee_name, item.date)}>
                          <Feather name="map-pin" size={11} color="#3B82F6" />
                          <ThemedText style={s.timelineBtnText}>Timeline</ThemedText>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                </View>
              );
            };

            // "Both" section: dedupe by user, split left=App / right=Bio
            const bothUserIds = [...new Set(both.map(r => r.user_id))];
            const fmtPunch = (t: string) => t.slice(0,5).replace(/^(\d{2}):(\d{2})/, (_, h, m) => { const n=parseInt(h); return `${n%12||12}:${m} ${n>=12?'pm':'am'}`; });
            const renderBothSection = () => {
              if (bothUserIds.length === 0) return null;
              return (
                <View>
                  <View style={[s.sectionHeader, { backgroundColor: '#05966915', borderLeftColor: '#059669' }]}>
                    <Feather name="check-circle" size={12} color="#059669" />
                    <ThemedText style={[s.sectionHeaderText, { color: '#059669' }]}>App + Biometric ({bothUserIds.length})</ThemedText>
                  </View>
                  {bothUserIds.map(uid => {
                    const appRec = both.find(r => r.user_id === uid)!;
                    const ref = appRec;
                    const bioPunches = deviceAllPunches[`${uid}_${date}`] ?? [];
                    const rawPunch = devicePunchMap[`${uid}_${date}`];
                    const isLate = isServerConfirmedLate(ref);

                    let gapMins: number | null = null;
                    if (appRec?.app_checkin_time && rawPunch?.first) {
                      const rawMs = new Date(`${date}T${rawPunch.first}+05:30`).getTime();
                      const appMs = toIST(appRec.app_checkin_time).getTime();
                      gapMins = Math.round((appMs - rawMs) / 60000);
                    }
                    const bigGap = gapMins !== null && Math.abs(gapMins) >= 15;
                    const gapLabel = gapMins !== null && gapMins !== 0
                      ? `App ${gapMins > 0 ? Math.abs(gapMins)+'m AFTER' : Math.abs(gapMins)+'m BEFORE'} device`
                      : null;
                    const lastPunchHour = rawPunch?.last
                      ? parseInt(rawPunch.last.split(':')[0], 10)
                      : rawPunch?.first ? parseInt(rawPunch.first.split(':')[0], 10) : 25;
                    const noCheckoutPunch = bioPunches.length > 0 && lastPunchHour < 18;
                    const borderColor = bigGap ? '#EF4444' : noCheckoutPunch ? '#F59E0B' : '#059669';

                    return (
                      <View key={uid} style={[s.recordCard, { backgroundColor: theme.backgroundDefault, borderLeftColor: borderColor, padding: 0, overflow: 'hidden' }]}>
                        {/* Header */}
                        <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6 }}>
                          <ThemedText style={[s.empName, { color: textColor }]}>{ref.employee_name}</ThemedText>
                          <ThemedText style={[s.meta, { color: theme.textSecondary }]}>{ref.office_name}</ThemedText>
                          {bigGap && gapLabel && (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                              <Feather name="alert-triangle" size={10} color="#EF4444" />
                              <ThemedText style={{ fontSize: 11, color: '#EF4444', fontWeight: '700' }}>{gapLabel}</ThemedText>
                            </View>
                          )}
                          {noCheckoutPunch && (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                              <Feather name="alert-circle" size={10} color="#F59E0B" />
                              <ThemedText style={{ fontSize: 11, color: '#F59E0B', fontWeight: '700' }}>No checkout punch before 6 PM</ThemedText>
                            </View>
                          )}
                        </View>
                        {/* Left / Right split */}
                        <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: theme.backgroundRoot }}>
                          {/* LEFT — App */}
                          <View style={{ flex: 1, padding: 10, borderRightWidth: 1, borderRightColor: theme.backgroundRoot, backgroundColor: '#0EA5E908' }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                              <Feather name="smartphone" size={11} color="#0EA5E9" />
                              <ThemedText style={{ fontSize: 11, fontWeight: '700', color: '#0EA5E9' }}>App</ThemedText>
                              {isLate && <View style={[s.statusBadge, { backgroundColor: '#F59E0B20' }]}><ThemedText style={[s.statusText, { color: '#F59E0B' }]}>Late</ThemedText></View>}
                            </View>
                            {appRec ? (
                              <>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                  <Feather name="log-in" size={10} color="#10B981" />
                                  <ThemedText style={[s.timeText, { color: textColor }]}>{fmt(appRec.app_checkin_time ?? undefined)}</ThemedText>
                                </View>
                                {appRec.checkout_time ? (
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
                                    <Feather name="log-out" size={10} color="#EF4444" />
                                    <ThemedText style={[s.timeText, { color: textColor }]}>{fmt(appRec.checkout_time)}</ThemedText>
                                  </View>
                                ) : (
                                  <ThemedText style={{ fontSize: 11, color: appRec.date < today ? '#F59E0B' : '#10B981', marginTop: 3 }}>
                                    {appRec.date < today ? 'P-NC | Present - No Checkout' : 'Active'}
                                  </ThemedText>
                                )}
                                <TouchableOpacity style={[s.timelineBtn, { marginTop: 6 }]} onPress={() => openTimeline(uid, ref.employee_name, ref.date)}>
                                  <Feather name="map-pin" size={10} color="#3B82F6" />
                                  <ThemedText style={s.timelineBtnText}>Timeline</ThemedText>
                                </TouchableOpacity>
                                {appRec && (
                                  <TouchableOpacity style={[s.timelineBtn, { marginTop: 6 }]} onPress={() => correctAttendance(appRec)}>
                                    <Feather name="edit-2" size={10} color="#6D1B6D" />
                                    <ThemedText style={[s.timelineBtnText, { color: "#6D1B6D" }]}>Correct</ThemedText>
                                  </TouchableOpacity>
                                )}
                              </>
                            ) : (
                              <ThemedText style={{ fontSize: 11, color: theme.textSecondary, fontStyle: 'italic' }}>No app record</ThemedText>
                            )}
                          </View>
                          {/* RIGHT — Biometric */}
                          <View style={{ flex: 1, padding: 10, backgroundColor: '#7C3AED08' }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                              <Feather name="cpu" size={11} color="#7C3AED" />
                              <ThemedText style={{ fontSize: 11, fontWeight: '700', color: '#7C3AED' }}>Biometric</ThemedText>
                              <ThemedText style={{ fontSize: 10, color: theme.textSecondary }}>({bioPunches.length} log{bioPunches.length !== 1 ? 's' : ''})</ThemedText>
                            </View>
                            {bioPunches.length === 0 ? (
                              <ThemedText style={{ fontSize: 11, color: theme.textSecondary, fontStyle: 'italic' }}>No device punches</ThemedText>
                            ) : (
                              bioPunches.map((t, i) => (
                                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                                  <ThemedText style={{ fontSize: 10, color: theme.textSecondary, width: 14 }}>{i + 1}.</ThemedText>
                                  <ThemedText style={[s.timeText, { color: textColor }]}>{fmtPunch(t)}</ThemedText>
                                </View>
                              ))
                            )}
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              );
            };

            return (
              <View key={date} style={{ marginBottom: 12 }}>
                <TouchableOpacity style={[s.dateHeader, { backgroundColor: theme.primary }]} onPress={() => toggleDate(date)}>
                  <View>
                    <ThemedText style={s.dateHeaderText}>{fmtDate(date)}</ThemedText>
                    <ThemedText style={s.dateHeaderSub}>
                      {presentCount} checked in | {absentCount} absent
                      {noAttendance.length > absentCount
                        ? ` | ${noAttendance.length - absentCount} off/leave/configuration`
                        : ""}
                    </ThemedText>
                  </View>
                  <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color="#fff" />
                </TouchableOpacity>

                {expanded && (
                  <>
                    {renderBothSection()}
                    {appOnly.length > 0 && (
                      <View>
                        <View style={[s.sectionHeader, { backgroundColor: '#0EA5E915', borderLeftColor: '#0EA5E9' }]}>
                          <Feather name="smartphone" size={12} color="#0EA5E9" />
                          <ThemedText style={[s.sectionHeaderText, { color: '#0EA5E9' }]}>App Only ({appOnly.length})</ThemedText>
                        </View>
                        {appOnly.map(item => {
                          const isLate = isServerConfirmedLate(item);
                          const bioPunches = deviceAllPunches[`${item.user_id}_${item.date}`] ?? [];
                          const fmtPunch = (t: string) => t.slice(0,5).replace(/^(\d{2}):(\d{2})/, (_, h, m) => { const n=parseInt(h); return `${n%12||12}:${m} ${n>=12?'pm':'am'}`; });
                          return (
                            <View key={item.id} style={[s.recordCard, { backgroundColor: theme.backgroundDefault, borderLeftColor: '#0EA5E9', padding: 0, overflow: 'hidden' }]}>
                              {/* Employee name + office header */}
                              <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6 }}>
                                <ThemedText style={[s.empName, { color: textColor }]}>{item.employee_name}</ThemedText>
                                <ThemedText style={[s.meta, { color: theme.textSecondary }]}>{(item as any).check_in_office_name ?? item.office_name}</ThemedText>
                              </View>
                              {/* Left / Right split */}
                              <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: theme.backgroundRoot }}>
                                {/* LEFT — App */}
                                <View style={{ flex: 1, padding: 10, borderRightWidth: 1, borderRightColor: theme.backgroundRoot, backgroundColor: '#0EA5E908' }}>
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                                    <Feather name="smartphone" size={11} color="#0EA5E9" />
                                    <ThemedText style={{ fontSize: 11, fontWeight: '700', color: '#0EA5E9' }}>App</ThemedText>
                                    {isLate && <View style={[s.statusBadge, { backgroundColor: '#F59E0B20' }]}><ThemedText style={[s.statusText, { color: '#F59E0B' }]}>Late</ThemedText></View>}
                                  </View>
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                    <Feather name="log-in" size={10} color="#10B981" />
                                    <ThemedText style={[s.timeText, { color: textColor }]}>{fmt(item.app_checkin_time ?? undefined)}</ThemedText>
                                  </View>
                                  {item.checkout_time ? (
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
                                      <Feather name="log-out" size={10} color="#EF4444" />
                                      <ThemedText style={[s.timeText, { color: textColor }]}>{fmt(item.checkout_time)}</ThemedText>
                                    </View>
                                  ) : (
                                    <ThemedText style={{ fontSize: 11, color: item.date < today ? '#F59E0B' : '#10B981', marginTop: 3 }}>
                                      {item.date < today ? 'P-NC | Present - No Checkout' : 'Active'}
                                    </ThemedText>
                                  )}
                                  <TouchableOpacity style={[s.timelineBtn, { marginTop: 6 }]} onPress={() => openTimeline(item.user_id, item.employee_name, item.date)}>
                                    <Feather name="map-pin" size={10} color="#3B82F6" />
                                    <ThemedText style={s.timelineBtnText}>Timeline</ThemedText>
                                  </TouchableOpacity>
                                  <TouchableOpacity style={[s.timelineBtn, { marginTop: 6 }]} onPress={() => correctAttendance(item)}>
                                    <Feather name="edit-2" size={10} color="#6D1B6D" />
                                    <ThemedText style={[s.timelineBtnText, { color: "#6D1B6D" }]}>Correct</ThemedText>
                                  </TouchableOpacity>
                                </View>
                                {/* RIGHT — Biometric */}
                                <View style={{ flex: 1, padding: 10, backgroundColor: '#7C3AED08' }}>
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                                    <Feather name="cpu" size={11} color="#7C3AED" />
                                    <ThemedText style={{ fontSize: 11, fontWeight: '700', color: '#7C3AED' }}>Biometric</ThemedText>
                                    <ThemedText style={{ fontSize: 10, color: theme.textSecondary }}>({bioPunches.length} log{bioPunches.length !== 1 ? 's' : ''})</ThemedText>
                                  </View>
                                  {bioPunches.length === 0 ? (
                                    <ThemedText style={{ fontSize: 11, color: theme.textSecondary, fontStyle: 'italic' }}>No device punches</ThemedText>
                                  ) : (
                                    bioPunches.map((t, i) => (
                                      <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                                        <ThemedText style={{ fontSize: 10, color: theme.textSecondary, width: 14 }}>{i + 1}.</ThemedText>
                                        <ThemedText style={[s.timeText, { color: textColor }]}>{fmtPunch(t)}</ThemedText>
                                      </View>
                                    ))
                                  )}
                                </View>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    )}
                    {bioOnly.length > 0 && (
                      <View>
                        <View style={[s.sectionHeader, { backgroundColor: '#7C3AED15', borderLeftColor: '#7C3AED' }]}>
                          <Feather name="cpu" size={12} color="#7C3AED" />
                          <ThemedText style={[s.sectionHeaderText, { color: '#7C3AED' }]}>Biometric Only ({bioOnly.length})</ThemedText>
                        </View>
                        {bioOnly.map(item => {
                          const punch = devicePunchMap[`${item.user_id}_${item.date}`];
                          // punch.last before 18:00 means no checkout punch — flag yellow
                          const lastPunchHour = punch?.last
                            ? parseInt(punch.last.split(':')[0], 10)
                            : punch?.first
                              ? parseInt(punch.first.split(':')[0], 10)
                              : 25;
                          const noCheckout = lastPunchHour < 18;
                          return (
                            <View key={item.id} style={[s.recordCard, { backgroundColor: theme.backgroundDefault, borderLeftColor: noCheckout ? '#F59E0B' : '#7C3AED' }]}>
                              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <View style={{ flex: 1 }}>
                                  <ThemedText style={[s.empName, { color: textColor }]}>{item.employee_name}</ThemedText>
                                  <ThemedText style={[s.meta, { color: theme.textSecondary }]}>{(item as any).check_in_office_name ?? item.office_name}</ThemedText>
                                  <View style={{ gap: 4, marginTop: 6 }}>
                                    <View style={[s.sourceRow, { backgroundColor: '#7C3AED12' }]}>
                                      <Feather name="cpu" size={10} color="#7C3AED" />
                                      <ThemedText style={[s.sourceLbl, { color: '#7C3AED' }]}>Bio</ThemedText>
                                      {punch ? (
                                        <>
                                          <ThemedText style={[s.timeText, { color: textColor }]}>
                                            {punch.first.slice(0,5).replace(/^(\d{2}):(\d{2})/, (_, h, m) => { const n=parseInt(h); return `${n%12||12}:${m} ${n>=12?'pm':'am'}`; })}
                                          </ThemedText>
                                          {punch.last && punch.last !== punch.first && (
                                            <ThemedText style={[s.timeText, { color: theme.textSecondary }]}>
                                              {' → '}{punch.last.slice(0,5).replace(/^(\d{2}):(\d{2})/, (_, h, m) => { const n=parseInt(h); return `${n%12||12}:${m} ${n>=12?'pm':'am'}`; })}
                                            </ThemedText>
                                          )}
                                        </>
                                      ) : (
                                        <ThemedText style={[s.timeText, { color: textColor }]}>{fmt(item.biometric_first_in ?? item.checkin_time)}</ThemedText>
                                      )}
                                    </View>
                                    {noCheckout && (
                                      <View style={[s.sourceRow, { backgroundColor: '#F59E0B15', marginTop: 2 }]}>
                                        <Feather name="alert-circle" size={10} color="#F59E0B" />
                                        <ThemedText style={{ fontSize: 11, color: '#F59E0B', fontWeight: '700' }}>No checkout punch before 6 PM</ThemedText>
                                      </View>
                                    )}
                                  </View>
                                </View>
                                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                                  {noCheckout ? (
                                    <View style={[s.statusBadge, { backgroundColor: '#F59E0B20' }]}>
                                      <ThemedText style={[s.statusText, { color: '#F59E0B' }]}>No Out</ThemedText>
                                    </View>
                                  ) : (
                                    <View style={[s.statusBadge, { backgroundColor: '#7C3AED20' }]}>
                                      <ThemedText style={[s.statusText, { color: '#7C3AED' }]}>Bio</ThemedText>
                                    </View>
                                  )}
                                </View>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    )}
                    {otherAttendance.length > 0 && (
                      <View>
                        <View style={[s.sectionHeader, { backgroundColor: '#2563EB15', borderLeftColor: '#2563EB' }]}>
                          <Feather name="map-pin" size={12} color="#2563EB" />
                          <ThemedText style={[s.sectionHeaderText, { color: '#2563EB' }]}>Other Verified Attendance ({otherAttendance.length})</ThemedText>
                        </View>
                        {otherAttendance.map((item) => (
                          <View key={item.id} style={[s.recordCard, { backgroundColor: theme.backgroundDefault, borderLeftColor: '#2563EB' }]}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                              <View style={{ flex: 1 }}>
                                <ThemedText style={[s.empName, { color: textColor }]}>{item.employee_name}</ThemedText>
                                <ThemedText style={[s.meta, { color: theme.textSecondary }]}>{(item as any).check_in_office_name ?? (item.office_name || 'Office not assigned')}</ThemedText>
                                <ThemedText style={[s.timeText, { color: textColor, marginTop: 6 }]}>
                                  {item.first_in_source || item.attendance_type || 'Verified'} · {fmt(item.checkin_time)}
                                </ThemedText>
                              </View>
                              
                                <View style={[s.statusBadge, { backgroundColor: '#2563EB20' }]}>
                                  <ThemedText style={[s.statusText, { color: '#2563EB' }]}>{attendanceStatusLabel(item, today)}</ThemedText>
                                </View>
                              </View>
                              {((item as any).active_site_name || (item as any).active_field_visit_name) && (
                                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                                  <View style={[s.statusBadge, { backgroundColor: '#8B5CF620', flexDirection: 'row', alignItems: 'center', gap: 4 }]}>
                                    <Feather name="map-pin" size={10} color="#8B5CF6" />
                                    <ThemedText style={[s.statusText, { color: '#8B5CF6' }]}>Site: {(item as any).active_site_name || (item as any).active_field_visit_name}</ThemedText>
                                  </View>
                                </View>
                              )}

                          </View>
                        ))}
                      </View>
                    )}
                    {noAttendance.length > 0 && (
                      <View>
                        <View style={[s.sectionHeader, { backgroundColor: '#64748B15', borderLeftColor: '#64748B' }]}>
                          <Feather name="user-x" size={12} color="#64748B" />
                          <ThemedText style={[s.sectionHeaderText, { color: '#64748B' }]}>No Check-In ({noAttendance.length})</ThemedText>
                        </View>
                        {noAttendance.map((item) => {
                          const emptyState = attendanceEmptyStateCopy(item.status);
                          const configurationRequired = item.status === 'CONFIG_REQUIRED';
                          const accent = configurationRequired ? '#D97706' : item.status === 'ABSENT' ? '#DC2626' : '#64748B';
                          return (
                            <View key={item.id} style={[s.recordCard, { backgroundColor: theme.backgroundDefault, borderLeftColor: accent }]}>
                              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                                <View style={{ flex: 1 }}>
                                  <ThemedText style={[s.empName, { color: textColor }]}>{item.employee_name}</ThemedText>
                                  <ThemedText style={[s.meta, { color: theme.textSecondary }]}>{(item as any).check_in_office_name ?? (item.office_name || 'Office not assigned')}</ThemedText>
                                  <ThemedText style={{ fontSize: 11, color: theme.textSecondary, marginTop: 5 }}>{emptyState.detail}</ThemedText>
                                </View>
                                <View style={[s.statusBadge, { backgroundColor: `${accent}20` }]}>
                                  <ThemedText style={[s.statusText, { color: accent }]}>{emptyState.label}</ThemedText>
                                </View>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </>
                )}
              </View>
            );
          