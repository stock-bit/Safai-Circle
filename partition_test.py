import xml.etree.ElementTree as ET
import zipfile, math

# Load wards
with zipfile.ZipFile('Final Wardbandi Rewari KMZ.kmz') as z:
    for name in z.namelist():
        if name.endswith('.kml'):
            kml_data = z.read(name)
            break
root_w = ET.fromstring(kml_data)
for e in root_w.iter():
    if '}' in e.tag: e.tag = e.tag.split('}')[-1]

wards = []
for pm in root_w.iter('Placemark'):
    for poly in pm.iter('Polygon'):
        for ib in poly.iter('outerBoundaryIs'):
            for lr in ib.iter('LinearRing'):
                ce = lr.find('coordinates')
                if ce is not None and ce.text:
                    ring = [[float(x) for x in pt.split(',')[:2]] for pt in ce.text.strip().split() if len(pt.split(','))>=2]
                    if ring:
                        min_x = min(p[0] for p in ring)
                        max_x = max(p[0] for p in ring)
                        min_y = min(p[1] for p in ring)
                        max_y = max(p[1] for p in ring)
                        wards.append({'bbox': (min_x, min_y, max_x, max_y), 'ring': ring})

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

def is_in_wards(pt):
    for w in wards:
        b = w['bbox']
        if b[0] <= pt[0] <= b[2] and b[1] <= pt[1] <= b[3]:
            if pt_in_poly(pt, w['ring']):
                return True
    return False

def haversine(c1, c2):
    R = 6371.0
    dLat = math.radians(c2[1] - c1[1])
    dLon = math.radians(c2[0] - c1[0])
    a = math.sin(dLat/2)**2 + math.cos(math.radians(c1[1]))*math.cos(math.radians(c2[1]))*math.sin(dLon/2)**2
    return 2 * R * math.asin(math.sqrt(a))

def line_len(coords):
    return sum(haversine(coords[i], coords[i+1]) for i in range(len(coords)-1))

def get_roads(filename):
    root = ET.parse(filename).getroot()
    for e in root.iter():
        if '}' in e.tag: e.tag = e.tag.split('}')[-1]
    roads = []
    for pm in root.iter('Placemark'):
        name = pm.findtext('name') or ''
        # exclude extent polygon or bounding rectangles
        if 'approximate' in name.lower() and 'extent' in name.lower():
            continue
        ls = pm.find('.//LineString')
        if ls is not None:
            ce = ls.find('coordinates')
            if ce is not None and ce.text:
                coords = [[float(x) for x in pt.split(',')[:2]] for pt in ce.text.strip().split() if len(pt.split(','))>=2]
                if len(coords) >= 2:
                    mid = coords[len(coords)//2]
                    if is_in_wards(mid):
                        roads.append({'name': name, 'coords': coords, 'len': line_len(coords), 'mid': mid})
    return roads

ref_roads = get_roads('Rewari_Haryana_Reference_Roads_Only.kml')
ulb_roads = get_roads('MC_Rewari_ULB_Roads_Only_No_Beats.kml')

# Extract exact Circular road ring from the 5 placemarks
root_ref = ET.parse('Rewari_Haryana_Reference_Roads_Only.kml').getroot()
for e in root_ref.iter():
    if '}' in e.tag: e.tag = e.tag.split('}')[-1]

circ_ordered = []
# Ordered segments as determined earlier:
# 0: Jhajjar Chowk to Jain Public School
# 1: Jain Public School to Azad Chowk
# 2: Azad Chowk to Dharuhera Chowk
# 3: Dharuhera Chowk / Azad Chowk around to Balwal Chowk
# 4: Balwal Chowk to Jhajjar Chowk
for pm in root_ref.iter('Placemark'):
    name = pm.findtext('name') or ''
    if 'circular road' in name.lower():
        ce = pm.find('.//LineString/coordinates')
        if ce is not None and ce.text:
            coords = [[float(x) for x in pt.split(',')[:2]] for pt in ce.text.strip().split() if len(pt.split(','))>=2]
            circ_ordered.extend(coords)

circ_ring = circ_ordered
cx = sum(p[0] for p in circ_ring) / len(circ_ring)
cy = sum(p[1] for p in circ_ring) / len(circ_ring)

print("--- SCENARIO 1: Exact Historic Circular Road Loop Polygon ---")
ref_in_loop = [r for r in ref_roads if pt_in_poly(r['mid'], circ_ring)]
ulb_out_loop = [r for r in ulb_roads if not pt_in_poly(r['mid'], circ_ring)]
print(f"Ref inside Loop: {len(ref_in_loop)} roads, {sum(r['len'] for r in ref_in_loop):.2f} km")
print(f"ULB outside Loop: {len(ulb_out_loop)} roads, {sum(r['len'] for r in ulb_out_loop):.2f} km")
print(f"Total: {len(ref_in_loop) + len(ulb_out_loop)} roads, {sum(r['len'] for r in ref_in_loop) + sum(r['len'] for r in ulb_out_loop):.2f} km")

print("\n--- SCENARIO 2: Circular Zones by Radius from Circular Road Center ---")
for rad in [0.8, 1.0, 1.2, 1.5, 1.8, 2.0]:
    r_in = [r for r in ref_roads if math.hypot((r['mid'][0]-cx)*98.0, (r['mid'][1]-cy)*111.0) <= rad]
    u_out = [r for r in ulb_roads if math.hypot((r['mid'][0]-cx)*98.0, (r['mid'][1]-cy)*111.0) > rad]
    tot_len = sum(r['len'] for r in r_in) + sum(r['len'] for r in u_out)
    print(f"Radius {rad:.1f} km: Ref inside={len(r_in)} ({sum(r['len'] for r in r_in):.1f}km), ULB outside={len(u_out)} ({sum(r['len'] for r in u_out):.1f}km) => Total={len(r_in)+len(u_out)} roads, {tot_len:.2f} km")
