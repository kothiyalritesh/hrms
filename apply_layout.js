const fs = require("fs");
let code = fs.readFileSync("screens/admin/SiteVisitObserverScreen.tsx", "utf-8");

// We need to inject useWindowDimensions
if (!code.includes("useWindowDimensions")) {
  code = code.replace(/import \{ View, StyleSheet, TouchableOpacity, ScrollView \} from "react-native";/, `import { View, StyleSheet, TouchableOpacity, ScrollView, useWindowDimensions, FlatList } from "react-native";`);
}

// Add isDesktop check
if (!code.includes("const isDesktop")) {
  code = code.replace(/const allEmployees = \(observerData\?\.employees \?\? \[\]\) as any\[\];/, `const { width } = useWindowDimensions();\n  const isDesktop = width >= 768;\n\n  const allEmployees = (observerData?.employees ?? []) as any[];`);
}

// Replace the Map + Bottom Panel with the split layout
const startMarker = `{/* Map View */}`;
const endMarker = `</ThemedView>`;

const oldJSX = code.substring(code.indexOf(startMarker), code.lastIndexOf(endMarker));

const newJSX = `{/* Map View & Layout Split */}
      <View style={{ flex: 1, flexDirection: isDesktop ? 'row' : 'column' }}>
        {/* Left/Top: Map */}
        <View style={{ flex: isDesktop ? 0.6 : 1, position: 'relative' }}>
          <SiteVisitObserverMap
            employees={filteredEmployees}
            selectedEmployee={selectedEmployee}
            selectedVisit={selectedVisit}
            onSelectEmployee={(emp: any) => {
              setSelectedEmployee(emp);
              if (emp.visits && emp.visits.length > 0) {
                setSelectedVisit(emp.visits[0]);
              } else {
                setSelectedVisit(null);
              }
            }}
            polylineCoords={polylineCoords}
            breadcrumbs={cleanedBreadcrumbs}
            isPlaying={isPlaying}
            activePlaybackPoint={activePlaybackPoint}
            playbackIndex={playbackIndex}
            playbackSpeed={playbackSpeed}
            playbackProgress={playbackProgress}
            elapsedTimeStr={elapsedTimeStr}
            totalTimeStr={totalTimeStr}
            onTogglePlay={togglePlay}
            onRestart={restart}
            onSetSpeed={setPlaybackSpeed}
            onScrub={scrubToProgress}
          />
          
          {/* Mobile Bottom Panel overlay */}
          {!isDesktop && (
            selectedEmployee ? (
              <ObserverDetailDrawer
                employee={selectedEmployee}
                selectedVisit={selectedVisit}
                onSelectVisit={setSelectedVisit}
                onClose={() => {
                  setSelectedEmployee(null);
                  setSelectedVisit(null);
                }}
                routeQuality={routeQuality}
              />
            ) : (
              <View style={[s.bottomPanel, { backgroundColor: theme.backgroundDefault, borderTopColor: theme.border }]}>
                <ThemedText type="caption" style={[s.panelTitle, { color: theme.textSecondary }]}>
                  ACTIVE FIELD EMPLOYEES ({filteredEmployees.length})
                </ThemedText>

                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.employeeScroll}>
                  {filteredEmployees.map((emp: any) => {
                    const isSelected = (selectedEmployee as any)?.employee_id === emp.employee_id;
                    return (
                      <TouchableOpacity
                        key={\`tab-\${emp.employee_id}\`}
                        style={[
                          s.employeeChip,
                          { backgroundColor: theme.backgroundRoot, borderColor: theme.border },
                          isSelected && { borderColor: theme.primary, backgroundColor: "#F3E8FF" },
                        ]}
                        onPress={() => {
                          setSelectedEmployee(emp);
                          if (emp.visits && emp.visits.length > 0) {
                            setSelectedVisit(emp.visits[0]);
                          } else {
                            setSelectedVisit(null);
                          }
                        }}
                      >
                        <ThemedText style={[s.empChipName, isSelected && { color: theme.primary }]}>
                          {toTitleCase(emp.name)}
                        </ThemedText>
                        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                          {emp.visits?.length ?? 0} visit{emp.visits?.length !== 1 ? "s" : ""}
                        </ThemedText>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )
          )}
        </View>

        {/* Desktop Right Side: Employee List or Details */}
        {isDesktop && (
          <View style={{ flex: 0.4, borderLeftWidth: 1, borderColor: theme.border, backgroundColor: theme.backgroundDefault }}>
            {selectedEmployee ? (
              <ObserverDetailDrawer
                employee={selectedEmployee}
                selectedVisit={selectedVisit}
                onSelectVisit={setSelectedVisit}
                onClose={() => {
                  setSelectedEmployee(null);
                  setSelectedVisit(null);
                }}
                routeQuality={routeQuality}
              />
            ) : (
              <View style={{ flex: 1 }}>
                <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: theme.border }}>
                  <ThemedText type="h3">Active Field Employees</ThemedText>
                  <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                    {filteredEmployees.length} matching result{filteredEmployees.length !== 1 ? 's' : ''}
                  </ThemedText>
                </View>
                <FlatList
                  data={filteredEmployees}
                  keyExtractor={(e: any) => e.employee_id}
                  contentContainerStyle={{ padding: 16, gap: 12 }}
                  renderItem={({ item: emp }: any) => {
                    const isSelected = (selectedEmployee as any)?.employee_id === emp.employee_id;
                    const trackingStatus = emp.tracking?.status ?? emp.tracking_status;
                    return (
                      <TouchableOpacity
                        style={[
                          s.desktopEmpCard,
                          { backgroundColor: theme.backgroundRoot, borderColor: theme.border },
                          isSelected && { borderColor: theme.primary, backgroundColor: "#F3E8FF" }
                        ]}
                        onPress={() => {
                          setSelectedEmployee(emp);
                          if (emp.visits && emp.visits.length > 0) {
                            setSelectedVisit(emp.visits[0]);
                          } else {
                            setSelectedVisit(null);
                          }
                        }}
                      >
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <View style={{ flex: 1 }}>
                            <ThemedText type="defaultSemiBold">{toTitleCase(emp.name)}</ThemedText>
                            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                              {emp.department || "No Dept"} • {emp.visits?.length ?? 0} visit{emp.visits?.length !== 1 ? 's' : ''}
                            </ThemedText>
                          </View>
                          <View style={[s.statusBadgeDesktop, { backgroundColor: trackingStatus === 'IN_TRANSIT' ? '#3B82F620' : trackingStatus === 'AT_SITE' ? '#10B98120' : '#6B728020' }]}>
                            <ThemedText type="caption" style={{ color: trackingStatus === 'IN_TRANSIT' ? '#3B82F6' : trackingStatus === 'AT_SITE' ? '#10B981' : '#6B7280', fontSize: 10, fontWeight: 'bold' }}>
                              {trackingStatus?.replace('_', ' ')}
                            </ThemedText>
                          </View>
                        </View>
                      </TouchableOpacity>
                    );
                  }}
                />
              </View>
            )}
          </View>
        )}
      </View>\n`;

code = code.replace(oldJSX, newJSX);

// Add desktop card styles
code = code.replace(/employeeScroll: \{/, `desktopEmpCard: { padding: 12, borderRadius: 8, borderWidth: 1 },\n  statusBadgeDesktop: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },\n  employeeScroll: {`);

fs.writeFileSync("screens/admin/SiteVisitObserverScreen.tsx", code);
console.log("Applied Desktop Split Layout to SiteVisitObserverScreen");
