import xml.etree.ElementTree as ET
import math

def haversine_km(c1, c2):
    R = 6371.0
    dLat = math.radians(c2[1] - c1[1])
    dLon = math.radians(c2[0] - c1[0])
    a = math.sin(dLat/2)**2 + math.cos(math.radians(c1[1]))*math.cos(math.radians(c2[1]))*math.sin(dLon/2)**2
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

# Load roads from Rewari_Clean_Roads_Combined.kml
tree = ET.parse('Rewari_Clean_Roads_Combined.kml')
root = tree.getroot()
for e in root.iter():
    if '}' in e.tag: e.tag = e.tag.split('}')[-1]

circ_ring = []
inner_roads = []
outer_roads = []

for folder in root.findall('.//Folder'):
    fname = folder.findtext('name') or ''
    if 'Circular Road Boundary' in fname:
        for pm in folder.iter('Placemark'):
            ce = pm.find('.//LineString/coordinates')
            if ce is not None and ce.text:
                coords = [[float(x) for x in pt.split(',')[:2]] for pt in ce.text.strip().split() if len(pt.split(','))>=2]
                circ_ring.extend(coords)
    elif 'Inner Core Roads' in fname:
        for pm in folder.iter('Placemark'):
            name = pm.findtext('name') or ''
            ce = pm.find('.//LineString/coordinates')
            if ce is not None and ce.text:
                coords = [[float(x) for x in pt.split(',')[:2]] for pt in ce.text.strip().split() if len(pt.split(','))>=2]
                if len(coords) >= 2:
                    inner_roads.append({'name': name, 'coords': coords, 'len': line_len_km(coords), 'mid': coords[len(coords)//2]})
    elif 'Outer Ward Roads' in fname:
        for pm in folder.iter('Placemark'):
            name = pm.findtext('name') or ''
            ce = pm.find('.//LineString/coordinates')
            if ce is not None and ce.text:
                coords = [[float(x) for x in pt.split(',')[:2]] for pt in ce.text.strip().split() if len(pt.split(','))>=2]
                if len(coords) >= 2:
                    outer_roads.append({'name': name, 'coords': coords, 'len': line_len_km(coords), 'mid': coords[len(coords)//2]})

print(f"Loaded {len(inner_roads)} inner roads ({sum(r['len'] for r in inner_roads):.2f} km)")
print(f"Loaded {len(outer_roads)} outer roads ({sum(r['len'] for r in outer_roads):.2f} km)")
print(f"Circular Ring points: {len(circ_ring)}")

# Center of Circular Road
cx = sum(p[0] for p in circ_ring) / len(circ_ring)
cy = sum(p[1] for p in circ_ring) / len(circ_ring)
print(f"Circular Road Center: [{cx:.5f}, {cy:.5f}]")
