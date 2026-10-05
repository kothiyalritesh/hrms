const fs = require('fs');
let content = fs.readFileSync('screens/DashboardScreen.tsx', 'utf8');

const replacement = `
      <ScreenScrollView
        style={{ backgroundColor: theme.backgroundRoot }}
        contentContainerStyle={[isWeb && styles.webContentContainer]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.primary}
          />
        }
      >
        {isWeb && (
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 20, paddingTop: 10 }}>
             <Pressable 
               onPress={onRefresh} 
               disabled={refreshing}
               style={{ backgroundColor: C.primary, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, flexDirection: 'row', alignItems: 'center' }}>
               <Feather name="refresh-cw" size={14} color="#FFF" style={{ marginRight: 6 }} />
               <ThemedText style={{ color: '#FFF', fontWeight: 'bold' }}>{refreshing ? 'Reloading...' : 'Reload Data'}</ThemedText>
             </Pressable>
          </View>
        )}
`;

content = content.replace(
  /<ScreenScrollView\s*style=\{\{ backgroundColor: theme\.backgroundRoot \}\}\s*contentContainerStyle=\{\[isWeb && styles\.webContentContainer\]\}\s*refreshControl=\{\s*<RefreshControl\s*refreshing=\{refreshing\}\s*onRefresh=\{onRefresh\}\s*tintColor=\{C\.primary\}\s*\/>\s*\}\s*>/,
  replacement
);

fs.writeFileSync('screens/DashboardScreen.tsx', content);
console.log('Fixed DashboardScreen.tsx');
