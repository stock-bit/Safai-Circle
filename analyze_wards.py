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
                        cx = sum(p[0] for p in ring)/len(ring)
                        cy = sum(p[1] for p in ring)/len(ring)
                        wards.append({'name': w_name, 'bbox': (min_x, min_y, max_x, max_y), 'center': (cx, cy), 'ring': ring})

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

def parse_kml(filename):
    root = ET.parse(filename).getroot()
    for e in root.iter():
        if '}' in e.tag: e.tag = e.tag.split('}')[-1]
    roads = []
    for pm in root.iter('Placemark'):
        name = pm.findtext('name') or ''
        ls = pm.find('.//LineString')
        if ls is not None:
            ce = ls.find('coordinates')
            if ce is not None and ce.text:
                coords = [[float(x) for x in pt.split(',')[:2]] for pt in ce.text.strip().split() if len(pt.split(','))>=2]
                if len(coords) >= 2:
                    roads.append({'name': name, 'coords': coords})
    return roads

ref_all = parse_kml('Rewari_Haryana_Reference_Roads_Only.kml')
ulb_all = parse_kml('MC_Rewari_ULB_Roads_Only_No_Beats.kml')

# Filter to inside Rewari Wards
ref_in_wards = [r for r in ref_all if is_pt_in_wards(r['coords'][len(r['coords'])//2])]
ulb_in_wards = [r for r in ulb_all if is_pt_in_wards(r['coords'][len(r['coords'])//2])]

print(f"Ref inside Rewari wards: {len(ref_in_wards)} roads")
print(f"ULB inside Rewari wards: {len(ulb_in_wards)} roads")

# Let's count for each ward how many Reference roads vs ULB roads fall in it
ward_counts = {}
for w in wards:
    wname = w['name']
    r_count = sum(1 for r in ref_in_wards if pt_in_poly(r['coords'][len(r['coords'])//2], w['ring']))
    u_count = sum(1 for r in ulb_in_wards if pt_in_poly(r['coords'][len(r['coords'])//2], w['ring']))
    ward_counts[wname] = {'ref': r_count, 'ulb': u_count}

print("\nWard breakdown (Ward: Ref roads vs ULB roads):")
for wname in sorted(ward_counts.keys(), key=lambda x: int(x) if x.isdigit() else 999):
    c = ward_counts[wname]
    print(f"  Ward {wname:2s}: Ref={c['ref']:3d}, ULB={c['ulb']:3d}")
