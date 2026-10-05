const fs = require('fs');
const path = require('path');
const file = 'screens/admin/SiteVisitObserverScreen.tsx';
let content = fs.readFileSync(file, 'utf-8');

// Replace the mobile layout logic
const oldMobilePanel = `{/* Mobile Bottom Panel overlay */}
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
                <View style={[s.bottomPanel, { backgroundColor: theme.backgroundDefault, borderTopColor: theme.border }]}>`;

const newMobilePanel = `{/* Mobile Bottom Panel overlay */}
            {!isDesktop && (
              selectedEmployee ? (
                <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, elevation: 10, zIndex: 10, backgroundColor: theme.backgroundDefault, borderTopWidth: 1, borderTopColor: theme.border, shadowColor: "#000", shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.1, shadowRadius: 4 }}>
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
                </View>
              ) : (
                <View style={[s.bottomPanel, { position: 'absolute', bottom: 0, left: 0, right: 0, elevation: 10, zIndex: 10, backgroundColor: theme.backgroundDefault, borderTopColor: theme.border }]}>`;

if (content.includes('Mobile Bottom Panel overlay')) {
  content = content.replace(oldMobilePanel, newMobilePanel);
  fs.writeFileSync(file, content, 'utf-8');
  console.log("Updated SiteVisitObserverScreen mobile layout");
} else {
  console.log("Could not find mobile panel to replace");
}
