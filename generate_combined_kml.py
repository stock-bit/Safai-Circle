"""
Rewari Combined Road KML Generator
===================================
User Strategy:
  - Inside the Circular Road: Use Reference (yellow/orange) road data
  - Outside the Circular Road: Use MC/ULB (blue) road data
  - Strict Boundary: Confined within Municipal Council Rewari (32 Wards)
  - No 2m micro-clipping or overlap deductions - simple, robust, gap-free!
"""

import xml.etree.ElementTree as ET
import zipfile, math, os, sys

WARD_FILE = 'Final Wardbandi Rewari KMZ.kmz'
ULB_FILE = 'MC_Rewari_ULB_Roads_Only_No_Beats.kml'
REF_FILE = 'Rewari_Haryana_Reference_Roads_Only.kml'
OUTPUT_KML = 'Rewari_Clean_Roads_Combined.kml'

def haversine_km(c1, c2):
    lon1, lat1 = c1[0], c1[1]
    lon2, lat2 = c2[0], c2[1]
    R = 6371.0
    dLat = math.radians(lat2 - lat1)
    dLon = math.radians(lon2 - lon1)
    a = math.sin(dLat/2)**2 + math.cos(math.radians(lat1))*math.cos(math.radians(lat2))*math.sin(dLon/2)**2
    return 2 * R * math.asin(math.sqrt(a))

def line_len_km(coords):
    return sum(haversine_km(coords[i], coords[i+1]) for i in range(len(coords)-1))

def point_in_poly(pt, ring):
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

# 1. Load Ward Boundaries
print("1. Loading Rewari Ward Boundaries (32 Wards)...")
ward_rings = []
with zipfile.ZipFile(WARD_FILE) as z:
    for name in z.namelist():
        if name.endswith('.kml'):
            kml_data = z.read(name)
            break

root_w = ET.fromstring(kml_data)
for e in root_w.iter():
    if '}' in e.tag: e.tag = e.tag.split('}')[-1]

for pm in root_w.iter('Placemark'):
    w_name = pm.findtext('name') or ''
    for poly in pm.iter('Polygon'):
        for ib in poly.iter('outerBoundaryIs'):
            for lr in ib.iter('LinearRing'):
                ce = lr.find('coordinates')
                if ce is not None and ce.text:
                    ring = []
                    for pt in ce.text.strip().split():
                        parts = pt.split(',')
                        if len(parts) >= 2:
                            ring.append([float(parts[0]), float(parts[1])])
                    if ring:
                        min_x = min(p[0] for p in ring)
                        max_x = max(p[0] for p in ring)
                        min_y = min(p[1] for p in ring)
                        max_y = max(p[1] for p in ring)
                        ward_rings.append({'name': w_name, 'bbox': (min_x, min_y, max_x, max_y), 'ring': ring})

print(f"   Loaded {len(ward_rings)} ward polygons.")

def is_in_rewari_wards(pt):
    px, py = pt[0], pt[1]
    for w in ward_rings:
        b = w['bbox']
        if b[0] <= px <= b[2] and b[1] <= py <= b[3]:
            if point_in_poly(pt, w['ring']):
                return True
    return False

# 2. Extract Circular Road Loop Polygon from Reference Data
print("2. Extracting Circular Road Rewari Loop geometry...")
root_ref = ET.parse(REF_FILE).getroot()
for e in root_ref.iter():
    if '}' in e.tag: e.tag = e.tag.split('}')[-1]

circ_segments = []
circ_all_pts = []
for pm in root_ref.iter('Placemark'):
    name = pm.findtext('name') or ''
    if 'circular road' in name.lower():
        ls = pm.find('.//LineString')
        if ls is not None:
            ce = ls.find('coordinates')
            if ce is not None and ce.text:
                coords = []
                for pt in ce.text.strip().split():
                    parts = pt.split(',')
                    if len(parts) >= 2:
                        coords.append([float(parts[0]), float(parts[1])])
                if len(coords) >= 2:
                    circ_segments.append({'name': name, 'coords': coords, 'len': line_len_km(coords)})
                    circ_all_pts.extend(coords)

print(f"   Found {len(circ_segments)} Circular Road segments forming the central ring.")
circ_ring = circ_all_pts
cx = sum(p[0] for p in circ_ring) / len(circ_ring)
cy = sum(p[1] for p in circ_ring) / len(circ_ring)
circ_radius_km = sum(math.hypot((p[0]-cx)*98.0, (p[1]-cy)*111.0) for p in circ_ring) / len(circ_ring)
print(f"   Circular Road Center: ({cx:.5f}, {cy:.5f}), Approx radius: {circ_radius_km:.2f} km")

# Function to test if a point is inside the circular road loop
def is_inside_circular_road(pt):
    return point_in_poly(pt, circ_ring)

# 3. Load and Filter Reference Roads (Inside Circular Road)
print("3. Filtering Reference roads inside Circular Road...")
ref_inside = []
ref_outside_count = 0
for pm in root_ref.iter('Placemark'):
    name = pm.findtext('name') or ''
    # Skip boundary extent polygon
    if 'approximate' in name.lower() and 'extent' in name.lower():
        continue
    ls = pm.find('.//LineString')
    if ls is not None:
        ce = ls.find('coordinates')
        if ce is not None and ce.text:
            coords = []
            for pt in ce.text.strip().split():
                parts = pt.split(',')
                if len(parts) >= 2:
                    coords.append([float(parts[0]), float(parts[1])])
            if len(coords) >= 2:
                mid = coords[len(coords)//2]
                if is_in_rewari_wards(mid):
                    if is_inside_circular_road(mid):
                        ref_inside.append({
                            'name': name or f"Ref Road {len(ref_inside)+1}",
                            'coords': coords,
                            'len_km': line_len_km(coords),
                            'source': 'Reference (Inside Circular Road)'
                        })
                    else:
                        ref_outside_count += 1

print(f"   Reference roads inside Circular Road: {len(ref_inside)} features, {sum(r['len_km'] for r in ref_inside):.2f} km")

# 4. Load and Filter ULB Roads (Outside Circular Road, Inside Municipal Wards)
print("4. Filtering ULB roads outside Circular Road (within Municipal Wards)...")
root_ulb = ET.parse(ULB_FILE).getroot()
for e in root_ulb.iter():
    if '}' in e.tag: e.tag = e.tag.split('}')[-1]

ulb_outside = []
ulb_inside_count = 0
for pm in root_ulb.iter('Placemark'):
    name = pm.findtext('name') or ''
    ls = pm.find('.//LineString')
    if ls is not None:
        ce = ls.find('coordinates')
        if ce is not None and ce.text:
            coords = []
            for pt in ce.text.strip().split():
                parts = pt.split(',')
                if len(parts) >= 2:
                    coords.append([float(parts[0]), float(parts[1])])
            if len(coords) >= 2:
                mid = coords[len(coords)//2]
                if is_in_rewari_wards(mid):
                    if not is_inside_circular_road(mid):
                        ulb_outside.append({
                            'name': name or f"MC Road {len(ulb_outside)+1}",
                            'coords': coords,
                            'len_km': line_len_km(coords),
                            'source': 'MC/ULB (Outside Circular Road)'
                        })
                    else:
                        ulb_inside_count += 1

print(f"   ULB roads outside Circular Road: {len(ulb_outside)} features, {sum(r['len_km'] for r in ulb_outside):.2f} km")

# 5. Add Circular Road Segments
circ_road_features = []
for s in circ_segments:
    circ_road_features.append({
        'name': s['name'],
        'coords': s['coords'],
        'len_km': s['len'],
        'source': 'Circular Road (Boundary Ring)'
    })

total_features = len(ref_inside) + len(ulb_outside) + len(circ_road_features)
total_km = sum(r['len_km'] for r in ref_inside) + sum(r['len_km'] for r in ulb_outside) + sum(r['len_km'] for r in circ_road_features)

print("=" * 65)
print("COMBINED ROAD NETWORK SUMMARY:")
print(f"  Inner Core: {len(ref_inside)} Reference roads ({sum(r['len_km'] for r in ref_inside):.2f} km)")
print(f"  Outer Wards: {len(ulb_outside)} MC/ULB roads ({sum(r['len_km'] for r in ulb_outside):.2f} km)")
print(f"  Circular Road Ring: {len(circ_road_features)} segments ({sum(r['len_km'] for r in circ_road_features):.2f} km)")
print(f"  TOTAL COMBINED ROADS: {total_features} features")
print(f"  TOTAL COMBINED LENGTH: {total_km:.2f} km")
print("=" * 65)

# 6. Generate Single KML File for Google Earth
print(f"6. Writing single KML output to {OUTPUT_KML}...")

def esc(text):
    return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')

with open(OUTPUT_KML, 'w', encoding='utf-8') as f:
    f.write('<?xml version="1.0" encoding="UTF-8"?>\n')
    f.write('<kml xmlns="http://www.opengis.net/kml/2.2">\n')
    f.write('<Document>\n')
    f.write('  <name>Rewari Clean Roads Network (Combined)</name>\n')
    f.write('  <description>Municipal Council Rewari Clean Road Network combining dense Reference roads inside Circular Road and MC/ULB roads outside Circular Road within municipal wards.</description>\n')
    
    # Styles
    # Emerald Green for ULB Outer Roads
    f.write('  <Style id="ulb_outer_style">\n')
    f.write('    <LineStyle><color>ff00aa33</color><width>2.5</width></LineStyle>\n')
    f.write('  </Style>\n')
    # Orange / Yellow for Reference Inner Roads
    f.write('  <Style id="ref_inner_style">\n')
    f.write('    <LineStyle><color>ff0088ff</color><width>2.5</width></LineStyle>\n')
    f.write('  </Style>\n')
    # Vivid Magenta for Circular Road Ring
    f.write('  <Style id="circ_ring_style">\n')
    f.write('    <LineStyle><color>ffff00ff</color><width>4.5</width></LineStyle>\n')
    f.write('  </Style>\n')
    # Ward boundary style (thin black/slate)
    f.write('  <Style id="ward_boundary_style">\n')
    f.write('    <LineStyle><color>ff333333</color><width>1.8</width></LineStyle>\n')
    f.write('    <PolyStyle><fill>0</fill></PolyStyle>\n')
    f.write('  </Style>\n')

    # Folder 1: Circular Road Ring
    f.write('  <Folder>\n')
    f.write('    <name>0. Circular Road Boundary (Ring)</name>\n')
    f.write(f'    <description>The physical Circular Road loop of Rewari ({len(circ_road_features)} segments, {sum(r["len_km"] for r in circ_road_features):.2f} km)</description>\n')
    for r in circ_road_features:
        f.write('    <Placemark>\n')
        f.write(f'      <name>{esc(r["name"])}</name>\n')
        f.write(f'      <description>Category: Circular Road Ring | Length: {r["len_km"]:.3f} km</description>\n')
        f.write('      <styleUrl>#circ_ring_style</styleUrl>\n')
        f.write('      <LineString><coordinates>' + ' '.join(f"{c[0]},{c[1]},0" for c in r['coords']) + '</coordinates></LineString>\n')
        f.write('    </Placemark>\n')
    f.write('  </Folder>\n')

    # Folder 2: Reference Roads (Inside Circular Road)
    f.write('  <Folder>\n')
    f.write('    <name>1. Inner Core Roads (Reference Data Inside Circular Road)</name>\n')
    f.write(f'    <description>{len(ref_inside)} features, {sum(r["len_km"] for r in ref_inside):.2f} km total length</description>\n')
    for r in ref_inside:
        f.write('    <Placemark>\n')
        f.write(f'      <name>{esc(r["name"])}</name>\n')
        f.write(f'      <description>Source: Reference Dataset | Length: {r["len_km"]:.3f} km | Zone: Inside Circular Road</description>\n')
        f.write('      <styleUrl>#ref_inner_style</styleUrl>\n')
        f.write('      <LineString><coordinates>' + ' '.join(f"{c[0]},{c[1]},0" for c in r['coords']) + '</coordinates></LineString>\n')
        f.write('    </Placemark>\n')
    f.write('  </Folder>\n')

    # Folder 3: ULB Roads (Outside Circular Road)
    f.write('  <Folder>\n')
    f.write('    <name>2. Outer Ward Roads (MC / ULB Data Outside Circular Road)</name>\n')
    f.write(f'    <description>{len(ulb_outside)} features, {sum(r["len_km"] for r in ulb_outside):.2f} km total length</description>\n')
    for r in ulb_outside:
        f.write('    <Placemark>\n')
        f.write(f'      <name>{esc(r["name"])}</name>\n')
        f.write(f'      <description>Source: Municipal Council Rewari (ULB) | Length: {r["len_km"]:.3f} km | Zone: Outer Wards</description>\n')
        f.write('      <styleUrl>#ulb_outer_style</styleUrl>\n')
        f.write('      <LineString><coordinates>' + ' '.join(f"{c[0]},{c[1]},0" for c in r['coords']) + '</coordinates></LineString>\n')
        f.write('    </Placemark>\n')
    f.write('  </Folder>\n')

    # Folder 4: Rewari Ward Boundaries (32 Wards)
    f.write('  <Folder>\n')
    f.write('    <name>3. Rewari Ward Boundaries (32 Wards)</name>\n')
    f.write('    <description>32 Municipal Ward Boundaries of Municipal Council Rewari</description>\n')
    for w in ward_rings:
        f.write('    <Placemark>\n')
        f.write(f'      <name>Ward {esc(w["name"])}</name>\n')
        f.write(f'      <description>Municipal Ward {esc(w["name"])} Boundary</description>\n')
        f.write('      <styleUrl>#ward_boundary_style</styleUrl>\n')
        f.write('      <Polygon><outerBoundaryIs><LinearRing><coordinates>' + ' '.join(f"{c[0]},{c[1]},0" for c in w['ring']) + '</coordinates></LinearRing></outerBoundaryIs></Polygon>\n')
        f.write('    </Placemark>\n')
    f.write('  </Folder>\n')

    f.write('</Document>\n')
    f.write('</kml>\n')

size_bytes = os.path.getsize(OUTPUT_KML)
print(f"Successfully generated {OUTPUT_KML} ({size_bytes:,} bytes)!")
