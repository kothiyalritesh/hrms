const fs = require('fs');
const file = 'components/ActiveJourneyCard.tsx';
let content = fs.readFileSync(file, 'utf8');

// Replace the ternary operator that hides the map
content = content.replace(
  /\{routeCoordinates\.length > 0 \? \(\s*<>\s*<View style=\{styles\.metricsRow\}>\s*<View style=\{styles\.metricItem\}>\s*<ThemedText style=\{styles\.metricValue\}>\s*\{distanceFromEnd \? formatDistance\(distanceFromEnd\) : "\.\.\."\}\s*<\/ThemedText>\s*<ThemedText style=\{styles\.metricLabel\}>estimated arrival \(fallback\)<\/ThemedText>\s*<\/View>\s*<View style=\{styles\.metricDivider\} \/>\s*<View style=\{styles\.metricItem\}>\s*<ThemedText style=\{styles\.metricValue\}>\s*\{straightLineDistance \? formatDistance\(straightLineDistance\) : "\.\.\."\}\s*<\/ThemedText>\s*<ThemedText style=\{styles\.metricLabel\}>straight-line dist\.<\/ThemedText>\s*<\/View>\s*<\/View>\s*<MapView[\s\S]*?<\/MapView>\s*<\/>\s*\) : \([\s\S]*?<\/View>\s*\)/,
  `<>
            <View style={styles.metricsRow}>
              <View style={styles.metricItem}>
                <ThemedText style={styles.metricValue}>
                  {distanceFromEnd ? formatDistance(distanceFromEnd) : (origin && destination ? formatDistance(haversineDistanceM(origin.latitude, origin.longitude, destination.latitude, destination.longitude)) : "...")}
                </ThemedText>
                <ThemedText style={styles.metricLabel}>{distanceFromEnd ? "estimated arrival" : "straight-line dist."}</ThemedText>
              </View>
              <View style={styles.metricDivider} />
              <View style={styles.metricItem}>
                <ThemedText style={styles.metricValue}>
                  {route?.durationSeconds ? formatEta(route.durationSeconds) : "..."}
                </ThemedText>
                <ThemedText style={styles.metricLabel}>{route?.durationSeconds ? "driving time" : "driving time (unavailable)"}</ThemedText>
              </View>
            </View>

          <MapView
            ref={mapRef}
            provider={PROVIDER_GOOGLE}
            style={styles.map}
            initialRegion={{
              latitude: origin?.latitude ?? destination.latitude,
              longitude: origin?.longitude ?? destination.longitude,
              latitudeDelta: 0.05,
              longitudeDelta: 0.05,
            }}
          >
            {origin ? (
              <Marker
                coordinate={{
                  latitude: origin.latitude,
                  longitude: origin.longitude,
                }}
                title="Current location"
                pinColor="#10B981"
              />
            ) : null}
            <Marker
              coordinate={{
                latitude: destination.latitude,
                longitude: destination.longitude,
              }}
              title={destination.name}
              pinColor="#6D1B6D"
            />
            {routeCoordinates.length > 1 ? (
              <Polyline
                coordinates={routeCoordinates}
                strokeColor="#6D1B6D"
                strokeWidth={6}
              />
            ) : origin && destination ? (
              <Polyline
                coordinates={[origin, destination]}
                strokeColor="#6D1B6D"
                strokeWidth={4}
                lineDashPattern={[10, 10]}
              />
            ) : null}
          </MapView>
          
          <View style={{ marginTop: 12 }}>
            <TouchableOpacity
              style={styles.navigateButton}
              onPress={() =>
                void openGoogleMapsNavigation(
                  {
                    latitude: destination.latitude,
                    longitude: destination.longitude,
                  },
                  destination.name,
                )
              }
            >
              <Feather name="navigation" size={16} color="#FFFFFF" />
              <ThemedText style={styles.navigateButtonText}>
                Start turn-by-turn navigation
              </ThemedText>
            </TouchableOpacity>
          </View>
          </>`
);

fs.writeFileSync(file, content);
