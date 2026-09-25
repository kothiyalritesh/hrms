const fs = require('fs');
let content = fs.readFileSync('screens/admin/TeamHierarchyScreen.tsx', 'utf8');

// Replace the Team view rendering
const newRenderBlock = `          {/* Render each Associate Partner as a Team Root */
          associatePartners.map((ap) => {
            // Build the full tree for this AP
            const fullTree = buildTree(ap.id, profiles);
            
            // Filter tree to only show branches that match the search
            const tree = filterTree(fullTree);
            
            // If there's a search, and this AP doesn't match AND no children match, hide it
            if (search && !matchSearch(ap) && tree.length === 0) {
              return null;
            }

            // Calculate total team size from fullTree
            let teamSize = 0;
            const countNodes = (nodes: TreeNode[]) => {
              for (const n of nodes) {
                teamSize++;
                countNodes(n.children);
              }
            };
            countNodes(fullTree);

            return (
              <View key={ap.id} style={[s.teamCard, { backgroundColor: theme.backgroundDefault, marginBottom: 16 }]}>
                {/* Team header row */}
                <View style={[s.teamHeader, { backgroundColor: theme.primary + "10" }]}>
                  <View style={[s.teamAvatar, { backgroundColor: theme.primary + "20" }]}>
                    <Feather name="star" size={16} color={theme.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <ThemedText type="body" style={{ fontWeight: "700" }}>
                      {ap.name}'s Team
                    </ThemedText>
                    <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                      {ap.role?.replace(/_/g, " ")} A {teamSize} member{teamSize !== 1 ? "s" : ""}
                    </ThemedText>
                  </View>
                  {canEdit && (
                    <Pressable
                      style={[s.setHeadBtn, { borderColor: theme.primary }]}
                      onPress={() => openAssignModal(ap)}
                    >
                      <Feather name="edit-2" size={13} color={theme.primary} />
                      <ThemedText type="caption" style={{ color: theme.primary, fontWeight: "600" }}>
                        Edit Head
                      </ThemedText>
                    </Pressable>
                  )}
                </View>

                {/* Team tree */}
                <View style={{ padding: Spacing.md }}>
                  {tree.length === 0 ? (
                    <ThemedText type="caption" style={{ color: theme.textSecondary, fontStyle: "italic" }}>
                      No members matching search in this team
                    </ThemedText>
                  ) : (
                    tree.map((node) => (
                      <AgentNode
                        key={node.profile.id}
                        node={node}
                        depth={0}
                        onAssign={openAssignModal}
                        onUnassign={handleUnassign}
                        canEdit={canEdit}
                        theme={theme}
                      />
                    ))
                  )}
                </View>
              </View>
            );
          })}

          {/* Unrooted Employees (Not reporting to any AP) */}
          {(() => {
            // Find all profiles that are not APs and not admins
            const nonRootProfiles = profiles.filter(p => !isAP(p.role) && !isAdmin(p.role));
            
            // Filter out those who eventually report to an AP
            const unrootedProfiles = nonRootProfiles.filter((m) => {
              let cur: Profile | undefined = m;
              const seen = new Set<string>();
              while (cur && cur.reports_to) {
                if (seen.has(cur.id)) return true; // cycle detected, unrooted
                seen.add(cur.id);
                const parent = profiles.find((p) => p.id === cur!.reports_to);
                if (parent && isAP(parent.role)) return false; // Roots to AP, so it's not unrooted
                cur = parent;
              }
              return true; // No AP found in chain
            });

            // Apply search filter
            const visibleUnrooted = unrootedProfiles.filter(matchSearch);

            if (visibleUnrooted.length === 0) return null;`;

content = content.replace(
  /\{filteredTeams\.map\(\(teamName\) => \{[\s\S]*?if \(noTeamAgents\.length === 0\) return null;/m,
  newRenderBlock + '\n\n            if (visibleUnrooted.length === 0) return null;'
);

// We need to fix the second block that renders noTeamAgents
content = content.replace(
  /if \(visibleUnrooted\.length === 0\) return null;[\s\S]*?if \(visibleUnrooted\.length === 0\) return null;/,
  'if (visibleUnrooted.length === 0) return null;'
);

const unrootedRenderBlock = `            return (
              <View style={[s.teamCard, { backgroundColor: theme.backgroundDefault, borderColor: Colors.light.warning, borderWidth: 1 }]}>
                <View style={[s.teamHeader, { backgroundColor: Colors.light.warning + "15" }]}>
                  <View style={[s.teamAvatar, { backgroundColor: Colors.light.warning + "30" }]}>
                    <Feather name="alert-triangle" size={16} color={Colors.light.warning} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <ThemedText type="body" style={{ fontWeight: "700" }}>Unassigned / Unrooted Employees</ThemedText>
                    <ThemedText type="caption" style={{ color: theme.textSecondary }}>Not reporting to any Team Head</ThemedText>
                  </View>
                </View>
                <View style={{ padding: Spacing.md }}>
                  {visibleUnrooted.map((agent) => (
                    <View key={agent.id} style={[s.agentRow, { marginLeft: 0 }]}>
                      <View style={{ flex: 1 }}>
                        <ThemedText type="caption" style={{ fontWeight: "700", color: theme.text }}>
                          {agent.name}
                        </ThemedText>
                        <ThemedText type="caption" style={{ color: theme.textSecondary, fontSize: 11 }}>
                          {agent.role?.replace(/_/g, " ")}
                          {agent.employee_number ? \` A #\${agent.employee_number}\` : ""}
                        </ThemedText>
                      </View>
                      {canEdit && (
                        <Pressable style={[s.iconBtn, { backgroundColor: Colors.light.primary + "15" }]} onPress={() => openAssignModal(agent)}>
                          <Feather name="git-branch" size={13} color={Colors.light.primary} />
                        </Pressable>
                      )}
                    </View>
                  ))}
                </View>
              </View>
            );
          })()}`;

content = content.replace(
  /return \([\s\S]*?<\/View>\n            \);\n          \}\)\(\)\}/m,
  unrootedRenderBlock
);

fs.writeFileSync('screens/admin/TeamHierarchyScreen.tsx', content);
console.log('Fixed hierarchy grouping.');
