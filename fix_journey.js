const fs = require("fs");
let code = fs.readFileSync("components/ActiveJourneyCard.tsx", "utf-8");

if (!code.includes("haversineDistanceM")) {
  code = code.replace(/import \{/, `import { haversineDistanceM } from "@/services/location/geo";\nimport {`);
  
  const fallbackJSX = `
      ) : (
        <View style={styles.metrics}>
          <View>
            <ThemedText style={styles.metricValue}>
              {origin && destination ? formatEta(haversineDistanceM(origin.latitude, origin.longitude, destination.latitude, destination.longitude) / 8.33) : "..."}
            </ThemedText>
            <ThemedText style={styles.metricLabel}>
              estimated arrival (fallback)
            </ThemedText>
          </View>
          <View style={styles.metricDivider} />
          <View>
            <ThemedText style={styles.metricValue}>
              {origin && destination ? formatDistance(haversineDistanceM(origin.latitude, origin.longitude, destination.latitude, destination.longitude)) : "..."}
            </ThemedText>
            <ThemedText style={styles.metricLabel}>straight-line dist.</ThemedText>
          </View>
        </View>
      )}
`;
  code = code.replace(/\) : \(\s*<ThemedText style=\{styles\.unavailable\}>\s*Route is waiting for precise GPS and an internet connection\.\s*<\/ThemedText>\s*\)\}/, fallbackJSX);
  fs.writeFileSync("components/ActiveJourneyCard.tsx", code);
  console.log("Injected ActiveJourneyCard fallback");
} else {
  console.log("ActiveJourneyCard already has fallback");
}
