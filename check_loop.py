import xml.etree.ElementTree as ET
import zipfile, math

# 1. Load Wards
with zipfile.ZipFile('Final Wardbandi Rewari KMZ.kmz') as z:
    for name in z.namelist():
        if name.endswith('.kml'):
            kml_data = z.read(name)
            break
root = ET.fromstring(kml_data)
for e in root.iter():
    if '}' in e.tag: e.tag = e.tag.split('}')[-1]

wards = []
for pm in root.iter('Placemark'):
    w_name = pm.findtext('name') or ''
    for poly in pm.iter('Polygon'):
        for ib in poly.iter('outerBoundaryIs'):
            for lr in ib.iter('LinearRing'):
                coords_elem = lr.find('coordinates')
                if coords_elem is not None and coords_elem.text:
                    ring = [[float(x) for x in pt.split(',')[:2]] for pt in coords_elem.text.strip().split() if len(pt.split(','))>=2]
                    if ring:
                        min_x = min(p[0] for p in ring)
                        max_x = max(p[0] for p in ring)
                        min_y = min(p[1] for p in ring)
                        max_y = max(p[1] for p in ring)
                        wards.append({'name': w_name, 'bbox': (min_x, min_y, max_x, max_y), 'ring': ring})

def pt_in_poly(pt, ring):
    x, y = pt[0], pt[1]
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside

def is_pt_in_wards(pt):
    px, py = pt[0], pt[1]
    for w in wards:
        bx1, by1, bx2, by2 = w['bbox']
        if bx1 <= px <= bx2 and by1 <= py <= by2:
            if pt_in_poly(pt, w['ring']):
                return True
    return False

# 2. Inspect the Circular Road segments
root_ref = ET.parse('Rewari_Haryana_Reference_Roads_Only.kml').getroot()
for e in root_ref.iter():
    if '}' in e.tag: e.tag = e.tag.split('}')[-1]

circ_segs = []
for pm in root_ref.iter('Placemark'):
    name = pm.findtext('name') or ''
    if 'circular road' in name.lower():
        ls = pm.find('.//LineString')
        if ls is not None:
            ce = ls.find('coordinates')
            if ce is not None and ce.text:
                coords = [[float(x) for x in pt.split(',')[:2]] for pt in ce.text.strip().split() if len(pt.split(','))>=2]
                circ_segs.append(coords)

# Order circ_segs into a single ring
ring = []
for s in circ_segs:
    ring.extend(s)

print(f"Total points in circular road ring: {len(ring)}")
# Check if ring is roughly closed:
print("First point:", ring[0])
print("Last point:", ring[-1])

# Check how many reference roads are inside this circular road polygon
ref_roads = []
for pm in root_ref.iter('Placemark'):
    ls = pm.find('.//LineString')
    if ls is not None:
        ce = ls.find('coordinates')
        if ce is not None and ce.text:
            coords = [[float(x) for x in pt.split(',')[:2]] for pt in ce.text.strip().split() if len(pt.split(','))>=2]
            if coords:
                ref_roads.append({'name': pm.findtext('name') or '', 'coords': coords})

inside_circ_count = 0
for r in ref_roads:
    mid = r['coords'][len(r['coords'])//2]
    if pt_in_poly(mid, ring):
        inside_circ_count += 1

print(f"Ref roads strictly inside the Circular Road loop: {inside_circ_count} of {len(ref_roads)}")

# What about roads within distance of Circular road?
# Let's check the radius of Circular road from its center
cx = sum(p[0] for p in ring) / len(ring)
cy = sum(p[1] for p in ring) / len(ring)
dists = [math.hypot((p[0]-cx)*98.0, (p[1]-cy)*111.0) for p in ring]
print(f"Circular Road Center: [{cx:.5f}, {cy:.5f}]")
print(f"Circular Road Radius: min {min(dists):.2f} km, max {max(dists):.2f} km, avg {sum(dists)/len(dists):.2f} km")
