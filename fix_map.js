const fs = require('fs');

function patchMap(file) {
  let content = fs.readFileSync(file, 'utf-8');
  content = content.replace(/playbackBar:\s*\{[^}]*bottom:\s*12/g, (match) => {
    return match.replace('bottom: 12', 'top: 12');
  });
  content = content.replace(/edgePadding:\s*\{\s*top:\s*60,\s*right:\s*60,\s*bottom:\s*200,\s*left:\s*60\s*\}/g, 'edgePadding: { top: 120, right: 60, bottom: 60, left: 60 }');
  fs.writeFileSync(file, content, 'utf-8');
}

patchMap('components/SiteVisitObserverMap.tsx');
patchMap('components/SiteVisitObserverMap.web.tsx');
console.log("Moved playback bar to top");
