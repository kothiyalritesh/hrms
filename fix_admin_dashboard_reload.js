const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'screens/admin/AdminDashboardScreen.tsx');
let content = fs.readFileSync(filePath, 'utf8');

const searchPattern = /(<ScreenScrollView\s+refreshControl=\{\s+<RefreshControl[\s\S]*?\/>\s+\}\s+>)/;

const replacement = `$1
        {Platform.OS === 'web' && (
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10 }}>
            <Pressable 
              onPress={onRefresh} 
              disabled={refreshing}
              style={{ backgroundColor: theme.primary, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, flexDirection: 'row', alignItems: 'center' }}
            >
              <Feather name="refresh-cw" size={14} color="#FFF" style={{ marginRight: 6 }} />
              <ThemedText style={{ color: '#FFF', fontWeight: 'bold' }}>{refreshing ? 'Reloading...' : 'Reload Data'}</ThemedText>
            </Pressable>
          </View>
        )}`;

if (searchPattern.test(content)) {
  content = content.replace(searchPattern, replacement);
  fs.writeFileSync(filePath, content);
  console.log('✓ Fixed AdminDashboardScreen.tsx - Added web reload button');
} else {
  console.error('✗ Could not find ScreenScrollView pattern in AdminDashboardScreen.tsx');
  process.exit(1);
}
