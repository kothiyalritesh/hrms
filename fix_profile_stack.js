const fs = require("fs");
let code = fs.readFileSync("navigation/ProfileStackNavigator.tsx", "utf-8");

code = code.replace(/MyTeam: undefined;/, `MyTeam: undefined;\n  HelpSupport: undefined;`);
code = code.replace(/const MyTeamScreen = .*?;/, `$& \nconst HelpSupportScreen = deferredScreen(() => import("@/screens/HelpSupportScreen"));`);
code = code.replace(/<\/Stack\.Navigator>/, `  <Stack.Screen name="HelpSupport" component={HelpSupportScreen} options={{ headerTitle: "Help & Support" }} />\n    </Stack.Navigator>`);

fs.writeFileSync("navigation/ProfileStackNavigator.tsx", code);
console.log("Updated ProfileStackNavigator");
