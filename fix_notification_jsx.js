const fs = require("fs");
let code = fs.readFileSync("screens/admin/NotificationManagementScreen.tsx", "utf-8");

const startIdx = code.indexOf(`{activeTab === "broadcast" ? (`);
const endIdx = code.lastIndexOf(`</View>\n  );\n}\n\nconst styles = StyleSheet.create({`);

const jsxReplacement = `{activeTab === "broadcast" ? (
        <View style={styles.broadcastSection}>
          <ThemedText type="h3">Send Broadcast Notification</ThemedText>
          <Spacer height={Spacing.md} />

          <View style={styles.broadcastTypes}>
            {(
              [
                ["hr_announcement", "Announcement"],
                ["policy", "Policy"],
                ["emergency", "Emergency"],
              ] as const
            ).map(([value, label]) => (
              <Pressable
                key={value}
                style={[
                  styles.broadcastType,
                  {
                    backgroundColor:
                      broadcastType === value
                        ? Colors.light.primary
                        : theme.backgroundDefault,
                  },
                ]}
                onPress={() => setBroadcastType(value)}
              >
                <ThemedText
                  type="caption"
                  style={{
                    color:
                      broadcastType === value ? "#FFFFFF" : theme.textSecondary,
                    fontWeight: broadcastType === value ? "600" : "400",
                  }}
                >
                  {label}
                </ThemedText>
              </Pressable>
            ))}
          </View>

          <View style={{ marginBottom: Spacing.md, zIndex: 10 }}>
            <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: 4 }}>Target Audience</ThemedText>
            <Pressable 
              style={[styles.input, { backgroundColor: theme.backgroundDefault, borderColor: theme.border, borderWidth: 1 }]}
              onPress={() => setTargetAudienceDropdown(!targetAudienceDropdown)}
            >
              <ThemedText>{targetTeam ? \`Team: \${targetTeam}\` : "All Staff"}</ThemedText>
            </Pressable>
            {targetAudienceDropdown && (
              <View style={{ position: 'absolute', top: 60, left: 0, right: 0, backgroundColor: theme.backgroundDefault, borderWidth: 1, borderColor: theme.border, borderRadius: 8, zIndex: 100 }}>
                <ScrollView style={{ maxHeight: 200 }}>
                  <Pressable style={{ padding: 12, borderBottomWidth: 1, borderColor: theme.border }} onPress={() => { setTargetTeam(""); setTargetAudienceDropdown(false); }}>
                    <ThemedText>All Staff</ThemedText>
                  </Pressable>
                  {teams.map(t => (
                    <Pressable key={t.id} style={{ padding: 12, borderBottomWidth: 1, borderColor: theme.border }} onPress={() => { setTargetTeam(t.name); setTargetAudienceDropdown(false); }}>
                      <ThemedText>Team: {t.name}</ThemedText>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>

          <TextInput
            style={[
              styles.input,
              { backgroundColor: theme.backgroundDefault, color: theme.text },
            ]}
            placeholder="Notification Title"
            placeholderTextColor={theme.textSecondary}
            value={broadcastTitle}
            onChangeText={setBroadcastTitle}
          />

          <TextInput
            style={[
              styles.textArea,
              { backgroundColor: theme.backgroundDefault, color: theme.text },
            ]}
            placeholder="Notification Message"
            placeholderTextColor={theme.textSecondary}
            value={broadcastMessage}
            onChangeText={setBroadcastMessage}
            multiline
            numberOfLines={3}
          />

          <Pressable
            style={[
              styles.sendButton,
              {
                backgroundColor: Colors.light.primary,
                opacity:
                  sending || !broadcastTitle.trim() || !broadcastMessage.trim()
                    ? 0.5
                    : 1,
              },
            ]}
            onPress={sendBroadcastNotification}
            disabled={
              sending || !broadcastTitle.trim() || !broadcastMessage.trim()
            }
          >
            <Feather name="send" size={16} color="#FFFFFF" />
            <ThemedText type="caption" style={styles.sendButtonText}>
              {sending ? "Sending..." : "Send Broadcast"}
            </ThemedText>
          </Pressable>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <ThemedText type="h3">Monitoring Dashboard</ThemedText>
          <Spacer height={Spacing.md} />
          
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: Spacing.lg, flexGrow: 0 }}>
            {monitorStats.map((stat, idx) => (
              <View key={idx} style={{ backgroundColor: theme.backgroundDefault, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: theme.border, marginRight: 12, minWidth: 140 }}>
                <ThemedText type="caption" style={{ color: theme.textSecondary, textTransform: 'uppercase' }}>{stat.type.replace('_', ' ')}</ThemedText>
                <ThemedText type="h2" style={{ marginVertical: 4 }}>{stat.total_sent}</ThemedText>
                <ThemedText type="caption" style={{ color: '#10B981' }}>{stat.read_count} Read ({Math.round((stat.read_count/Math.max(1,stat.total_sent))*100)}%)</ThemedText>
              </View>
            ))}
          </ScrollView>

          <ThemedText type="h3">System Notifications</ThemedText>
          <PaginationControls page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
          <Spacer height={Spacing.md} />

          {loading ? (
            <View style={styles.centered}>
              <ThemedText>Loading notifications...</ThemedText>
            </View>
          ) : (
            <FlatList
              data={notifications}
              keyExtractor={(item) => item.id}
              renderItem={renderNotification}
              contentContainerStyle={styles.list}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      )}
`;

code = code.substring(0, startIdx) + jsxReplacement + code.substring(endIdx);

fs.writeFileSync("screens/admin/NotificationManagementScreen.tsx", code);
console.log("Updated NotificationManagementScreen jsx");
