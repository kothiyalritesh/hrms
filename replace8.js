const fs = require('fs');
const file = 'components/ActiveJourneyCard.tsx';
const lines = fs.readFileSync(file, 'utf8').split('\n');

const newLines = `  return (
    <View style={styles.card}>
      <View style={styles.headingRow}>
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <ThemedText style={styles.liveText}>LIVE JOURNEY</ThemedText>
        </View>
        {route ? (
          <ThemedText style={styles.trafficText}>Traffic-aware</ThemedText>
        ) : null}
      </View>

      <ThemedText style={styles.destination} numberOfLines={1}>
        {destination.name}
      </ThemedText>

      {loading && !route ? (
        <View style={styles.loading}>
          <ActivityIndicator color="#6D1B6D" />
          <ThemedText style={styles.loadingText}>
            Calculating the best driving route...
          </ThemedText>
        </View>
      ) : (
        <>
          <View style={styles.metrics}>
            <View>
              <ThemedText style={styles.metricValue}>
                {route?.durationSeconds ? formatEta(route.durationSeconds) : origin && destination ? formatEta(haversineDistanceM(origin.latitude, origin.longitude, destination.latitude, destination.longitude) / 8.33) : "..."}
              </ThemedText>
              <ThemedText style={styles.metricLabel}>
                {route?.durationSeconds ? "estimated arrival" : "estimated arrival (fallback)"}
              </ThemedText>
            </View>
            <View style={styles.metricDivider} />
            <View>
              <ThemedText style={styles.metricValue}>
                {route?.distanceM ? formatDistance(route.distanceM) : origin && destination ? formatDistance(haversineDistanceM(origin.latitude, origin.longitude, destination.latitude, destination.longitude)) : "..."}
              </ThemedText>
              <ThemedText style={styles.metricLabel}>{route?.distanceM ? "road distance" : "straight-line dist."}</ThemedText>
            </View>
          </View>

          {origin && destination && (
            <MapView
              ref={mapRef}
              provider={PROVIDER_GOOGLE}
              style={styles.map}
              initialRegion={{
                latitude: origin.latitude,
                longitude: origin.longitude,
                latitudeDelta: 0.08,
                longitudeDelta: 0.08,
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
                <Polyline coordinates={routeCoordinates} strokeColor="#6D1B6D" strokeWidth={6} />
              ) : (
                <Polyline coordinates={[origin, destination]} strokeColor="#6D1B6D" strokeWidth={4} lineDashPattern={[10, 10]} />
              )}
            </MapView>
          )}
        </>
      )}

      {origin && destination && (
        <View style={{ marginTop: 12 }}>
          <TouchableOpacity
            style={styles.navigateButton}
            onPress={() =>
              void openGoogleMapsNavigation(
                { latitude: destination.latitude, longitude: destination.longitude },
                origin
              )
            }
          >
            <Feather name="navigation" size={16} color="#FFFFFF" />
            <ThemedText style={styles.navigateButtonText}>
              Start turn-by-turn navigation
            </ThemedText>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );`.split('\n');

const startIdx = lines.findIndex(l => l.includes("return (") && l.includes("<View style={styles.card}>") === false);
// Wait, the line is just `  return (`
const exactStart = lines.findIndex(l => l.trim() === "return (");
const endIdx = lines.findIndex((l, i) => i > exactStart && l.trim() === ");");

if (exactStart !== -1 && endIdx !== -1) {
  lines.splice(exactStart, endIdx - exactStart + 1, ...newLines);
  fs.writeFileSync(file, lines.join('\n'));
} else {
  console.log("NOT FOUND", exactStart, endIdx);
}
