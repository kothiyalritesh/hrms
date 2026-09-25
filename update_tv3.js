const fs = require('fs');
const file = 'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/TVDisplayScreen.tsx';
let content = fs.readFileSync(file, 'utf8');

// Replace using regex for the modal
content = content.replace(
  /\{\/\*.*FRAUD MODAL.*\*\/\}/g,
  `{/* Ticker Tape */}
        {alerts.length > 0 && (
          <View style={{ backgroundColor: "#8b0000", overflow: "hidden", height: 35, justifyContent: "center" }}>
            <Animated.View style={{ flexDirection: "row", transform: [{ translateX: tickerAnim.interpolate({ inputRange: [0, 1], outputRange: [1200, -2000] }) }] }}>
              {alerts.map((a, i) => (
                <Text key={i} style={{ color: "#fff", fontWeight: "700", marginRight: 80, fontSize: 16 }}>
                  🚨 {a.name} - {a.sub || a.text}
                </Text>
              ))}
            </Animated.View>
          </View>
        )}
  
        {/* 🔴 FRAUD MODAL 🔴 */}`
);

fs.writeFileSync(file, content, 'utf8');
console.log("Injected Ticker properly");