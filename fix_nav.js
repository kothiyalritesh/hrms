const fs = require('fs');
const path = require('path');
const p = path.resolve('navigation/AdminStackNavigator.tsx');
let content = fs.readFileSync(p, 'utf-8');

const regex = /function lazyScreen<T extends React\.ComponentType<any>>\([\s\S]*?<Lazy \{\.\.\.props\} \/>\s*<\/React\.Suspense>\s*\);\s*};\s*}/;

const replacement = `function lazyScreen<T extends React.ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
  permission?: string
) {
  const Lazy = React.lazy(loader);
  const DeferredScreen = function (props: React.ComponentProps<T>) {
    return (
      <React.Suspense
        fallback={
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator />
          </View>
        }
      >
        <Lazy {...props} />
      </React.Suspense>
    );
  };
  return permission ? withPermissionGuard(DeferredScreen, permission) : DeferredScreen;
}`;

if (regex.test(content)) {
  content = content.replace(regex, replacement);
  fs.writeFileSync(p, content, 'utf-8');
  console.log("Updated lazyScreen to use withPermissionGuard!");
} else {
  console.log("Could not match lazyScreen regex");
}
