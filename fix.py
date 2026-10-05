import re
with open(r'd:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\LiveTrackingScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

target = r"ping?.recorded_at ?? (row.official_first_in ? row.official_first_in.replace(' ', 'T').replace(/([^Z+-])$/, '$1+05:30') : row.official_first_in)"
replacement = r"""ping?.recorded_at ?? (() => {
            const ts = row.official_first_in;
            if (!ts) return ts;
            const normalized = ts.trim().replace(' ', 'T');
            return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)
              ? normalized
              : normalized + '+05:30';
          })()"""

content = content.replace(target, replacement)

with open(r'd:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\LiveTrackingScreen.tsx', 'w', encoding='utf-8', newline='\n') as f:
    f.write(content)
