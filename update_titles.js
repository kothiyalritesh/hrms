const fs = require('fs');

function patchNavigator(file) {
  let content = fs.readFileSync(file, 'utf-8');
  content = content.replace(/options=\{\{ headerTitle: "Leave Management" \}\}/g, 'options={{ headerTitle: "Leave History" }}');
  fs.writeFileSync(file, content, 'utf-8');
}

patchNavigator('navigation/ProfileStackNavigator.tsx');
patchNavigator('navigation/HomeStackNavigator.tsx');
console.log("Updated navigation titles");
