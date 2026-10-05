const fs = require('fs');
const file = 'components/ActiveJourneyCard.tsx';
let content = fs.readFileSync(file, 'utf8');

const startStr = "{routeCoordinates.length > 0 ? (";
const endStr = "      )}";

const startIdx = content.indexOf(startStr);
const endIdx = content.indexOf(endStr, startIdx);

if (startIdx !== -1 && endIdx !== -1) {
  const newBlock = `
        {origin && destination ? (
          <>
            <View style={styles.metrics}>
              <View>
                <ThemedText style={styles.metricValue}>
                  {route?.durationSeconds ? formatEta(route.durationSeconds) : formatEta(haversineDistanceM(origin.latitude, origin.longitude, destination.latitude, destination.longitude) / 8.33)}
                </ThemedText>
                <ThemedText style={styles.metricLabel}>
                  {route?.durationSeconds ? "estimated arrival" : "estimated arrival (fallback)"}
                </ThemedText>
              </View>
              <View style={styles.metricDivider} />
              <View>
                <ThemedText style={styles.metricValue}>
                  {distanceFromEnd ? formatDistance(distanceFromEnd) : formatDistance(haversineDistanceM(origin.latitude, origin.longitude, destination.latitude, destination.longitude))}
                </ThemedText>
                <ThemedText style={styles.metricLabel}>
                  {distanceFromEnd ? "driving distance" : "straight-line dist."}
                </ThemedText>
              </View>
            </View>

            <MapView
              ref={mapRef}
              provider={PROVIDER_GOOGLE}
              style={styles.map}
              initialRegion={{
                latitude: origin.latitude,
                longitude: origin.longitude,
                latitudeDelta: 0.05,
                longitudeDelta: 0.05,
              }}
            >
              <Marker
                coordinate={{ latitude: origin.latitude, longitude: origin.longitude }}
                title="Current location"
                pinColor="#10B981"
              />
              <Marker
                coordinate={{ latitude: destination.latitude, longitude: destination.longitude }}
                title={destination.name}
                pinColor="#6D1B6D"
              />
              {routeCoordinates.length > 1 ? (
                <Polyline
                  coordinates={routeCoordinates}
                  strokeColor="#6D1B6D"
                  strokeWidth={6}
                />
              ) : (
                <Polyline
                  coordinates={[origin, destination]}
                  strokeColor="#6D1B6D"
                  strokeWidth={4}
                  lineDashPattern={[10, 10]}
                />
              )}
            </MapView>
          </>
        ) : null}`;

  content = content.substring(0, startIdx) + newBlock + content.substring(endIdx + endStr.length);
  fs.writeFileSync(file, content);
} else {
  console.log("NOT FOUND");
}
