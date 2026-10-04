import xml.etree.ElementTree as ET
import math, random

# Load all clean roads
tree = ET.parse('Rewari_Clean_Roads_Combined.kml')
root = tree.getroot()
for e in root.iter():
    if '}' in e.tag: e.tag = e.tag.split('}')[-1]

roads = []
for pm in root.iter('Placemark'):
    ls = pm.find('.//LineString/coordinates')
    if ls is not None and ls.text:
        coords = [[float(x) for x in pt.split(',')[:2]] for pt in ls.text.strip().split() if len(pt.split(','))>=2]
        if len(coords) >= 2:
            name = pm.findtext('name') or ''
            l = sum(math.hypot((coords[i+1][0]-coords[i][0])*98.0, (coords[i+1][1]-coords[i][1])*111.0) for i in range(len(coords)-1))
            mid = coords[len(coords)//2]
            roads.append({'name': name, 'coords': coords, 'len': l, 'mid': mid})

tot_len = sum(r['len'] for r in roads)
target_len = tot_len / 30.0
print(f"Total Roads: {len(roads)}, Total Length: {tot_len:.2f} km, Target: {target_len:.2f} km/beat")

# Seed 30 centers across Rewari using k-means++ style distance spacing
random.seed(42)
seeds = [roads[0]['mid']]
while len(seeds) < 30:
    dists = [min(math.hypot((r['mid'][0]-s[0])*98.0, (r['mid'][1]-s[1])*111.0) for s in seeds) for r in roads]
    max_idx = dists.index(max(dists))
    seeds.append(roads[max_idx]['mid'])

beats = [{'id': i+1, 'center': list(seeds[i]), 'roads': [], 'len': 0} for i in range(30)]

# Run balanced clustering iterations
for it in range(12):
    for b in beats:
        b['roads'] = []
        b['len'] = 0
    # Assign each road to best cluster balancing proximity and road length
    for r in roads:
        best_b = min(beats, key=lambda b: math.hypot((r['mid'][0]-b['center'][0])*98.0, (r['mid'][1]-b['center'][1])*111.0) * (1.0 + max(0, (b['len'] - target_len)/target_len)*2.2))
        best_b['roads'].append(r)
        best_b['len'] += r['len']
    # Recalculate centers
    for b in beats:
        if b['roads']:
            b['center'][0] = sum(r['mid'][0] for r in b['roads']) / len(b['roads'])
            b['center'][1] = sum(r['mid'][1] for r in b['roads']) / len(b['roads'])

# Sort beats geographically: Inner core first, then radiating out
circ_cx, circ_cy = 76.61758, 28.19800
for b in beats:
    b['dist_from_core'] = math.hypot((b['center'][0]-circ_cx)*98.0, (b['center'][1]-circ_cy)*111.0)
    b['angle'] = math.atan2(b['center'][1]-circ_cy, b['center'][0]-circ_cx) * 180 / math.pi

# Sort: First 5 beats are the inner core (< 0.9 km), remaining 25 by angle
beats.sort(key=lambda b: (0 if b['dist_from_core'] < 0.85 else 1, b['angle']))
for idx, b in enumerate(beats):
    b['id'] = idx + 1

lens = [b['len'] for b in beats]
print(f"Min Beat Length: {min(lens):.2f} km")
print(f"Max Beat Length: {max(lens):.2f} km")
print(f"Average Beat Length: {sum(lens)/len(lens):.2f} km")
print("\nGenerated 30 Balanced Beats:")
for b in beats:
    sw = 12 if b['dist_from_core'] < 0.9 else (11 if b['len'] >= 10.5 else 10)
    b['sweepers'] = sw
    tgt = int((b['len'] * 1000) / sw)
    print(f"  Beat {b['id']:02d}: {b['len']:5.2f} km | {len(b['roads']):3d} streets | {sw} Sweepers (~{tgt}m/worker)")
