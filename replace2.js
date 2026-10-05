const fs = require('fs');
const file = 'components/ActiveJourneyCard.tsx';
let content = fs.readFileSync(file, 'utf8');

const regex = /return \(\s*<View style=\{styles\.card\}>\s*<View style=\{styles\.header\}>[\s\S]*?<\/View>\s*\);\s*\}/;

const newBlock = `return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.dot} />
        <ThemedText style={styles.title}>LIVE JOURNEY</ThemedText>
      </View>
      <ThemedText style={styles.destinationName} numberOfLines={1}>
        {destination.name}
      </ThemedText>

      {origin && (
        <>
          <View style={styles.metricsRow}>
            <View style={styles.metricItem}>
              <ThemedText style={styles.metricValue}>
                {distanceFromEnd ? formatDistance(distanceFromEnd) : (formatDistance(haversineDistanceM(origin.latitude, origin.longitude, destination.latitude, destination.longitude)))}
              </ThemedText>
              <ThemedText style={styles.metricLabel}>{distanceFromEnd ? "driving distance" : "straight-line dist."}</ThemedText>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricItem}>
              <ThemedText style={styles.metricValue}>
                {route?.durationSeconds ? formatEta(route.durationSeconds) : formatEta(haversineDistanceM(origin.latitude, origin.longitude, destination.latitude, destination.longitude) / 8.33)}
              </ThemedText>
              <ThemedText style={styles.metricLabel}>{route?.durationSeconds ? "estimated arrival" : "estimated arrival (fallback)"}</ThemedText>
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
              <Polyline coordinates={routeCoordinates} strokeColor="#6D1B6D" strokeWidth={6} />
            ) : (
              <Polyline coordinates={[origin, destination]} strokeColor="#6D1B6D" strokeWidth={4} lineDashPattern={[10, 10]} />
            )}
          </MapView>
        </>
      )}

      <View style={{ marginTop: 16 }}>
        <TouchableOpacity
          style={styles.navigateButton}
          onPress={() =>
            void openGoogleMapsNavigation(
              { latitude: destination.latitude, longitude: destination.longitude },
              destination.name,
            )
          }
        >
          <Feather name="navigation" size={16} color="#FFFFFF" />
          <ThemedText style={styles.navigateButtonText}>Start turn-by-turn navigation</ThemedText>
        </TouchableOpacity>
      </View>
    </View>
  );
}`;

content = content.replace(regex, newBlock);
fs.writeFileSync(file, content);
