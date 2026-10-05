const fs = require("fs");
let code = fs.readFileSync("screens/admin/SmartOfficeEmployeeImport.tsx", "utf-8");

const buttonCode = `
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <ThemedText style={styles.sectionTitle}>
              Upload Excel / CSV
            </ThemedText>
            <Pressable onPress={() => {
              const headers = ["name", "phone", "email", "role", "office", "employee_number", "team", "date_of_birth", "gender", "joining_date"];
              const row = ["John Doe", "9876543210", "john@example.com", "Employee", "Delhi Office", "EMP001", "Sales", "1990-01-01", "Male", "2023-05-01"];
              const csv = [headers.join(","), row.join(",")].join("\\n");
              const blob = new Blob([csv], { type: "text/csv" });
              const url = window.URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "Employee_Import_Sample.csv";
              a.click();
            }} style={{ padding: 8, backgroundColor: theme.primary + "15", borderRadius: 8 }}>
              <ThemedText style={{ color: theme.primary, fontSize: 13, fontWeight: "600" }}>Download Sample Sheet</ThemedText>
            </Pressable>
          </View>
`;

code = code.replace(/<ThemedText style=\{styles\.sectionTitle\}>\s*Upload Excel \/ CSV\s*<\/ThemedText>/, buttonCode);

fs.writeFileSync("screens/admin/SmartOfficeEmployeeImport.tsx", code);
console.log("Updated SmartOfficeEmployeeImport for Sample Sheet");
