import xml.etree.ElementTree as ET
import math

root = ET.parse('Rewari_Haryana_Reference_Roads_Only.kml').getroot()
for e in root.iter():
    if '}' in e.tag: e.tag = e.tag.split('}', 1)[1]

segs = []
for pm in root.iter('Placemark'):
    name = pm.findtext('name') or ''
    if 'circular road' in name.lower():
        ls = pm.find('.//LineString')
        if ls is not None:
            ce = ls.find('coordinates')
            if ce is not None and ce.text:
                coords = [[float(x) for x in pt.split(',')[:2]] for pt in ce.text.strip().split() if len(pt.split(','))>=2]
                segs.append({'name': name, 'coords': coords})

for s in segs:
    print(s['name'])
    print('  start:', s['coords'][0], 'end:', s['coords'][-1])

all_pts = [p for s in segs for p in s['coords']]
min_x = min(p[0] for p in all_pts)
max_x = max(p[0] for p in all_pts)
min_y = min(p[1] for p in all_pts)
max_y = max(p[1] for p in all_pts)
cx = sum(p[0] for p in all_pts) / len(all_pts)
cy = sum(p[1] for p in all_pts) / len(all_pts)
print(f"Circular road bounds: lng [{min_x}, {max_x}], lat [{min_y}, {max_y}]")
print(f"Center: lng {cx}, lat {cy}")
