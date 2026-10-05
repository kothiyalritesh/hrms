import re
with open(r'd:\download\RealtyHRM-fixed\RealtyHRM-fixed\screens\admin\LiveTrackingScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

target = r"ping?.recorded_at ?? (row.official_first_in ? row.official_first_in.replace(' ', 'T').replace(/([^Z+-])$/, '+05:30') : row.official_first_in)"
print(target in content)
