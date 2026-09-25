const fs = require('fs');
let content = fs.readFileSync('screens/admin/TeamHierarchyScreen.tsx', 'utf8');

// Replace matchSearch and tree building
const newBlock = `  const matchSearch = (p: Profile) =>
    !search ||
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.team ?? "").toLowerCase().includes(search.toLowerCase()) ||
    (p.role ?? "").toLowerCase().includes(search.toLowerCase());

  // Function to filter a tree: keep a node if it matches, or if any descendants match.
  // We don't filter out ancestors of matched nodes.
  function filterTree(nodes: TreeNode[]): TreeNode[] {
    if (!search) return nodes;
    const filtered: TreeNode[] = [];
    for (const node of nodes) {
      const children = filterTree(node.children);
      if (children.length > 0 || matchSearch(node.profile)) {
        filtered.push({ ...node, children });
      }
    }
    return filtered;
  }

  const filteredTeams = teamNames.filter((t) =>
    !search ||
    t.toLowerCase().includes(search.toLowerCase()) ||
    agents.filter((a) => a.team?.trim().toLowerCase() === t.toLowerCase()).some(matchSearch)
  );`;

content = content.replace(
  /const matchSearch = \(p: Profile\) =>[\s\S]*?const filteredTeams = teamNames\.filter\(\(t\) =>[\s\S]*?\);/,
  newBlock
);

const newRenderBlock = `          {filteredTeams.map((teamName) => {
            // Get all agents for this team (unfiltered by search to build full tree first)
            const allTeamMembers = agents.filter(
              (a) => a.team?.trim().toLowerCase() === teamName.trim().toLowerCase()
            );
            const headId = getTeamHeadId(teamName);
            const head = headId ? profiles.find((p) => p.id === headId) : null;
            
            // Build full tree first
            const fullTree = headId ? buildTree(headId, allTeamMembers) : [];
            
            // Then filter tree preserving paths to matches
            const tree = filterTree(fullTree);

            // Unrooted members (those whose chain doesn't lead to headId)
            const allUnrooted = headId
              ? allTeamMembers.filter((m) => {
                  let cur: Profile | undefined = m;
                  while (cur && cur.reports_to) {
                    if (cur.reports_to === headId) return false;
                    cur = profiles.find((p) => p.id === cur!.reports_to);
                  }
                  return true;
                })
              : allTeamMembers;
              
            const unrooted = allUnrooted.filter(matchSearch);`;

content = content.replace(
  /\{filteredTeams\.map\(\(teamName\) => \{[\s\S]*?const unrooted = headId[\s\S]*?: teamMembers;/m,
  newRenderBlock
);

fs.writeFileSync('screens/admin/TeamHierarchyScreen.tsx', content);
console.log('Fixed hierarchy search logic.');
