const fs = require('fs');

let code = fs.readFileSync('screens/UpcomingBirthdaysScreen.tsx', 'utf8');

// Add imports
const imports = `import { useNavigation } from "@react-navigation/native";
import { StackNavigationProp } from "@react-navigation/stack";
import { useAuth } from "@/contexts/AuthContext";`;
code = code.replace(/import \{ supabase \} from "@\/lib\/supabase";/, `${imports}\n$&`);

// Add hooks
const hooks = `  const navigation = useNavigation<StackNavigationProp<any>>();
  const { user } = useAuth();
  const isHRAdmin = ["SYSTEM_ADMIN", "ADMIN", "HR", "HRD"].includes(user?.role?.toUpperCase() || "");`;
code = code.replace(/const \[birthdays, setBirthdays\] = useState<Birthday\[\]>\(\[\]\);/, `${hooks}\n  $&`);

// Add button
const button = `      />
      {isHRAdmin && (
        <View style={{ paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm }}>
          <TouchableOpacity 
            style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: theme.primary, padding: Spacing.md, borderRadius: BorderRadius.md, gap: 8 }}
            onPress={() => navigation.navigate("Admin", { screen: "EmployeeBirthdayManagement" })}
          >
            <Feather name="settings" size={16} color="#fff" />
            <ThemedText style={{ color: "#fff", fontWeight: "600" }}>Manage Birthdays</ThemedText>
          </TouchableOpacity>
        </View>
      )}`;
code = code.replace(/subtitle=\{\`\$\{birthdays\.length\} birthday\$\{birthdays\.length !== 1 \? "s" : ""\}\} in next 30 days\`\}\n\s*\/>/, `${button}`);

fs.writeFileSync('screens/UpcomingBirthdaysScreen.tsx', code);
console.log("Updated UpcomingBirthdaysScreen");
