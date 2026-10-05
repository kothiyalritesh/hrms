const fs = require("fs");
let code = fs.readFileSync("screens/admin/AdminDashboardScreen.tsx", "utf-8");

const injection = `
            {isAdmin && (
              <ActionCard
                title="Anonymous Feedback"
                icon="message-square"
                color="#EC4899"
                onPress={() => navigation.navigate("AnonymousFeedback")}
              />
            )}
`;
code = code.replace(/<ActionCard\s*title="Audit Logs"\s*icon="activity"\s*color="#94A3B8"\s*onPress=\{\(\) => navigation\.navigate\("AuditLogs"\)\}\s*\/>\s*\)\}/, `$&${injection}`);

fs.writeFileSync("screens/admin/AdminDashboardScreen.tsx", code);
console.log("Updated AdminDashboardScreen");
