const fs = require('fs');
const path = require('path');
const p = path.resolve('screens/ProfileScreen.tsx');
let content = fs.readFileSync(p, 'utf-8');

const regex = /<MenuItem\s*icon="help-circle"\s*title="Help & Support"\s*onPress=\{\(\) =>\s*Alert\.alert\(\s*"Contact HR",\s*"Please contact HR department for any assistance\.",\s*\)\s*\}\s*\/>/m;

const replacement = `<MenuItem
              icon="help-circle"
              title="Help & Support"
              onPress={() => navigation.navigate("HelpSupport" as never)}
            />`;

if (regex.test(content)) {
  content = content.replace(regex, replacement);
  fs.writeFileSync(p, content, 'utf-8');
  console.log("Updated ProfileScreen.tsx Help & Support onPress");
} else {
  console.log("Could not find Help & Support MenuItem in ProfileScreen.tsx");
}
