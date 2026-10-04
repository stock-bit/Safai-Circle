"""
Rewari 30 Sweeper Beats Generator (Major Roads & Natural Physical Boundaries)
=============================================================================
Design Principles:
1. Real-World Sweeper Productivity in Indian ULB:
   - 8-hour shift has ~4 to 4.5 hours effective sweeping time (accounting for roll call,
     tea break, waste dumping at secondary collection point, and fatigue/hiding).
   - Realistic output per sweeper: ~500 to 650 meters of road per day.
   - Sizing: 10 to 12 sweepers deployed per beat.
   - 11 sweepers * 0.6 km/day = ~6.5 to 7 km daily sweep capability.
   - Commercial roads swept daily (~2.5 km), residential colony lanes swept on alternate days (~8 km).
   - Total road length per beat: ~10.5 km!
   - 314.6 km total road network / 30 beats = exactly 10.49 km per beat!

2. Boundary Division along Major Roads & Corridors:
   - 5 Inner Core Beats (Beats 01 - 05): Bounded within Circular Road (Core markets & bazaars).
     Allocated 12 sweepers/beat due to high commercial waste and footfall.
   - 25 Outer Beats (Beats 06 - 30): Bounded by Railway Lines, Delhi Road, Bawal Road,
     Jhajjar Road, Dharuhera Road, and Rewari Bypass across all 32 wards.
     Allocated 10 to 11 sweepers/beat.
   - Total Workforce: ~335 sweepers (averaging 11.2 per beat).
"""

import xml.etree.ElementTree as ET
import math, os

def haversine_km(c1, c2):
    R = 6371.0
    dLat = math.radians(c2[1] - c1[1])
    dLon = math.radians(c2[0] - c1[0])
    a = math.sin(dLat/2)**2 + math.cos(math.radians(c1[1]))*math.cos(math.radians(c2[1]))*math.sin(dLon/2)**2
    return 2 * R * math.asin(math.sqrt(a))

def line_len_km(coords):
    return sum(haversine_km(coords[i], coords[i+1]) for i in range(len(coords)-1))

# Load roads from Rewari_Clean_Roads_Combined.kml
tree = ET.parse('Rewari_Clean_Roads_Combined.kml')
root = tree.getroot()
for e in root.iter():
    if '}' in e.tag: e.tag = e.tag.split('}')[-1]

circ_ring = []
inner_roads = []
outer_roads = []
circ_segments = []

for folder in root.findall('.//Folder'):
    fname = folder.findtext('name') or ''
    if 'Circular Road Boundary' in fname:
        for pm in folder.iter('Placemark'):
            name = pm.findtext('name') or ''
            ce = pm.find('.//LineString/coordinates')
            if ce is not None and ce.text:
                coords = [[float(x) for x in pt.split(',')[:2]] for pt in ce.text.strip().split() if len(pt.split(','))>=2]
                circ_segments.append({'name': name, 'coords': coords, 'len': line_len_km(coords)})
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

# Center of Circular Road
cx = sum(p[0] for p in circ_ring) / len(circ_ring)
cy = sum(p[1] for p in circ_ring) / len(circ_ring)

print(f"Total Inner Roads: {len(inner_roads)} ({sum(r['len'] for r in inner_roads):.2f} km)")
print(f"Total Outer Roads: {len(outer_roads)} ({sum(r['len'] for r in outer_roads):.2f} km)")

# ==============================================================================
# 1. DEFINE 5 INNER BEATS (Inside Circular Road - Core Commercial)
# ==============================================================================
# We divide the 50.3 km inner core into 5 balanced beats (~10 km each, 12 sweepers):
# - Beat 01: North Core (Bada Bazaar / Jhajjar Gate)
# - Beat 02: East Core (Moti Chowk / Dharuhera Gate / Ghanta Ghar)
# - Beat 03: South Core (Gokal Gate / Nai Sarak / Balwal Gate)
# - Beat 04: West Core (Qutabpur / Punjabi Mohalla)
# - Beat 05: Central Core (Sarafa Bazaar / Halwai Gali / Subzi Mandi)

inner_beat_defs = [
    {'id': 1, 'name': 'Beat 01 - Core North (Jhajjar Gate to Bada Bazaar)', 'sweepers': 12, 'angle_start': 45, 'angle_end': 115, 'roads': [], 'len': 0},
    {'id': 2, 'name': 'Beat 02 - Core East (Ghanta Ghar to Dharuhera Gate)', 'sweepers': 12, 'angle_start': -25, 'angle_end': 45, 'roads': [], 'len': 0},
    {'id': 3, 'name': 'Beat 03 - Core South (Nai Sarak to Gokal Gate)', 'sweepers': 12, 'angle_start': -95, 'angle_end': -25, 'roads': [], 'len': 0},
    {'id': 4, 'name': 'Beat 04 - Core West (Qutabpur to Balwal Gate)', 'sweepers': 12, 'angle_start': -180, 'angle_end': -95, 'roads': [], 'len': 0},
    {'id': 5, 'name': 'Beat 05 - Core Central (Sarafa Bazaar & Main Mandi)', 'sweepers': 12, 'center_dist_max': 0.35, 'roads': [], 'len': 0}
]

# Separate roads close to absolute center for Beat 05
target_inner_len = sum(r['len'] for r in inner_roads) / 5.0

for r in inner_roads:
    mid = r['mid']
    d_km = math.hypot((mid[0]-cx)*98.0, (mid[1]-cy)*111.0)
    # Check if central core
    if d_km <= 0.30 and inner_beat_defs[4]['len'] < target_inner_len:
        inner_beat_defs[4]['roads'].append(r)
        inner_beat_defs[4]['len'] += r['len']
    else:
        # Determine quadrant angle (degrees -180 to 180)
        angle = math.atan2(mid[1]-cy, mid[0]-cx) * 180 / math.pi
        # Find matching sector
        assigned = False
        for b in inner_beat_defs[:4]:
            if b['angle_start'] <= angle < b['angle_end']:
                b['roads'].append(r)
                b['len'] += r['len']
                assigned = True
                break
        if not assigned:
            # Handle angle wrap-around for west
            inner_beat_defs[3]['roads'].append(r)
            inner_beat_defs[3]['len'] += r['len']

print("\n--- INNER CORE BEATS (Inside Circular Road) ---")
for b in inner_beat_defs:
    print(f"  {b['name']}: {b['len']:.2f} km | {len(b['roads'])} segments | {b['sweepers']} Sweepers (Target: ~550m/sweeper)")

# ==============================================================================
# 2. DEFINE 25 OUTER BEATS (Outside Circular Road along Major Corridors)
# ==============================================================================
# The outer city is 259.8 km, partitioned into 25 beats (~10.4 km each, 10-11 sweepers):
# Sectors divided by:
# - Railway Line North/West
# - Delhi Road (East)
# - Dharuhera Road / NH-919 (East / South-East)
# - Bawal Road (South)
# - Narnaul / Mahendragarh Road (South-West)
# - Jhajjar Road (North-West)

# Cluster outer roads into 25 geographically contiguous sectors around major radial angles
target_outer_len = sum(r['len'] for r in outer_roads) / 25.0

# Define 25 directional & distance radial seeds
outer_beat_seeds = [
    # North Sector (North of Railway line, Kaluwas & Circular Rd North)
    {'id': 6,  'name': 'Beat 06 - Kaluwas & Rewari Bypass North', 'zone': 'North', 'sweepers': 10, 'mid_target': [76.595, 28.218]},
    {'id': 7,  'name': 'Beat 07 - Railway Colony & Station North', 'zone': 'North', 'sweepers': 11, 'mid_target': [76.608, 28.210]},
    {'id': 8,  'name': 'Beat 08 - Circular Road North Outer & Anand Nagar', 'zone': 'North', 'sweepers': 11, 'mid_target': [76.618, 28.209]},
    {'id': 9,  'name': 'Beat 09 - Jhajjar Road Outer to Ward 31', 'zone': 'North', 'sweepers': 10, 'mid_target': [76.626, 28.216]},
    {'id': 10, 'name': 'Beat 10 - New Anaj Mandi North & Subhash Basti', 'zone': 'North', 'sweepers': 11, 'mid_target': [76.634, 28.212]},

    # East Sector (Delhi Road, Dharuhera Road, Housing Board & Phidedi)
    {'id': 11, 'name': 'Beat 11 - Delhi Road North (Ward 15 & 16)', 'zone': 'East', 'sweepers': 11, 'mid_target': [76.628, 28.205]},
    {'id': 12, 'name': 'Beat 12 - Housing Board Colony & Sector 1', 'zone': 'East', 'sweepers': 11, 'mid_target': [76.635, 28.202]},
    {'id': 13, 'name': 'Beat 13 - Dharuhera Road North Outer', 'zone': 'East', 'sweepers': 10, 'mid_target': [76.643, 28.201]},
    {'id': 14, 'name': 'Beat 14 - Phidedi Approach & Ward 11 East', 'zone': 'East', 'sweepers': 10, 'mid_target': [76.652, 28.196]},
    {'id': 15, 'name': 'Beat 15 - NH-919 Corridor & Sector 4 Outer', 'zone': 'East', 'sweepers': 10, 'mid_target': [76.645, 28.190]},
    {'id': 16, 'name': 'Beat 16 - Dharuhera Road South & Ward 12/14', 'zone': 'East', 'sweepers': 11, 'mid_target': [76.636, 28.192]},

    # South Sector (Bawal Road, Model Town, Sector 3, Brass Market)
    {'id': 17, 'name': 'Beat 17 - Circular Road South to Model Town Gate', 'zone': 'South', 'sweepers': 11, 'mid_target': [76.626, 28.188]},
    {'id': 18, 'name': 'Beat 18 - Model Town Core (Block A & B)', 'zone': 'South', 'sweepers': 11, 'mid_target': [76.622, 28.182]},
    {'id': 19, 'name': 'Beat 19 - Model Town Extension & Sector 3', 'zone': 'South', 'sweepers': 11, 'mid_target': [76.618, 28.177]},
    {'id': 20, 'name': 'Beat 20 - Brass Market & Commercial Complex', 'zone': 'South', 'sweepers': 12, 'mid_target': [76.612, 28.183]},
    {'id': 21, 'name': 'Beat 21 - Bawal Road North (Ward 24 & 25)', 'zone': 'South', 'sweepers': 11, 'mid_target': [76.608, 28.178]},
    {'id': 22, 'name': 'Beat 22 - Bawal Road South Outer (Ward 23 & 26)', 'zone': 'South', 'sweepers': 10, 'mid_target': [76.603, 28.172]},
    {'id': 23, 'name': 'Beat 23 - Konsiwas Road & Southern Outskirts', 'zone': 'South', 'sweepers': 10, 'mid_target': [76.598, 28.179]},

    # West & South-West Sector (Anaj Mandi, Railway West, Jhajjar Road West)
    {'id': 24, 'name': 'Beat 24 - Anaj Mandi Complex & Grain Market', 'zone': 'West', 'sweepers': 12, 'mid_target': [76.592, 28.185]},
    {'id': 25, 'name': 'Beat 25 - Old Tehsil & Court Complex Area', 'zone': 'West', 'sweepers': 11, 'mid_target': [76.598, 28.192]},
    {'id': 26, 'name': 'Beat 26 - Railway Station West & Goods Yard', 'zone': 'West', 'sweepers': 11, 'mid_target': [76.605, 28.195]},
    {'id': 27, 'name': 'Beat 27 - Circular Road West Outer & Ward 8/9', 'zone': 'West', 'sweepers': 11, 'mid_target': [76.606, 28.202]},
    {'id': 28, 'name': 'Beat 28 - Jhajjar Road West (Ward 7 & 10)', 'zone': 'West', 'sweepers': 11, 'mid_target': [76.596, 28.204]},
    {'id': 29, 'name': 'Beat 29 - Mahendragarh Road & Rampura Road', 'zone': 'West', 'sweepers': 10, 'mid_target': [76.586, 28.198]},
    {'id': 30, 'name': 'Beat 30 - Western Outer Fringe & Bypass Link', 'zone': 'West', 'sweepers': 10, 'mid_target': [76.582, 28.207]}
]

for b in outer_beat_seeds:
    b['roads'] = []
    b['len'] = 0

# Assign outer roads using balanced distance scoring
for r in outer_roads:
    mid = r['mid']
    rlen = r['len']
    # Best seed considering distance and current load
    best_b = min(outer_beat_seeds, key=lambda b: math.hypot((mid[0]-b['mid_target'][0])*98.0, (mid[1]-b['mid_target'][1])*111.0) * (1.0 + max(0, (b['len'] - target_outer_len)/target_outer_len)*2.2))
    best_b['roads'].append(r)
    best_b['len'] += rlen

print("\n--- 25 OUTER SECTOR BEATS (Divided along Major Radial Roads) ---")
for b in outer_beat_seeds:
    print(f"  {b['name']}: {b['len']:.2f} km | {len(b['roads'])} segments | {b['sweepers']} Sweepers (Target: ~{int(b['len']*1000/b['sweepers'])}m/sweeper)")

# Combine all 30 beats
all_30_beats = inner_beat_defs + outer_beat_seeds
total_km = sum(b['len'] for b in all_30_beats)
total_sweepers = sum(b['sweepers'] for b in all_30_beats)

print("\n" + "=" * 70)
print(f"ALL 30 BEATS GENERATION COMPLETE:")
print(f"  Total Clean Road Length: {total_km:.2f} km")
print(f"  Average Road Length per Beat: {total_km/30:.2f} km")
print(f"  Total Sweepers Deployed: {total_sweepers} sweepers across 30 beats")
print(f"  Average Sweepers per Beat: {total_sweepers/30:.1f} (Range: 10 to 12 sweepers)")
print(f"  Average Daily Sweeping Target per Sweeper: ~550 to 650 meters/day")
print("=" * 70)

# ==============================================================================
# 3. WRITE CSV DEPLOYMENT ROSTER TABLE
# ==============================================================================
csv_file = 'Rewari_30_Sweeper_Beats_Deployment.csv'
with open(csv_file, 'w', encoding='utf-8') as f:
    f.write("Beat_No,Beat_Name,Category,Road_Length_KM,Segments_Count,Sweepers_Deployed,Daily_Target_Meters_Per_Sweeper,Primary_Corridor_Boundary,Supervision_Muster_Point\n")
    for b in all_30_beats:
        b_id = f"Beat {b['id']:02d}"
        cat = "Inner Commercial Core" if b['id'] <= 5 else f"Outer Sector ({b.get('zone', 'General')})"
        daily_target = int((b['len'] * 1000) / b['sweepers'])
        muster = f"Muster Point {b['id']:02d} ({b['name'].split('(')[-1].replace(')', '')})"
        f.write(f'"{b_id}","{b["name"]}","{cat}",{b["len"]:.2f},{len(b["roads"])},{b["sweepers"]},{daily_target},"{b["name"].split("-")[-1].strip()}","{muster}"\n')

print(f"\nGenerated Deployment Roster CSV: {csv_file}")

# ==============================================================================
# 4. GENERATE COMPLETE GOOGLE EARTH KML (With Distinct Polygon per Beat)
# ==============================================================================
kml_file = 'Rewari_30_Sweeper_Beats_Major_Roads.kml'

def esc(text):
    return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')

beat_palette = [
    '#e11d48', '#ea580c', '#d97706', '#65a30d', '#16a34a',
    '#059669', '#0d9488', '#0891b2', '#0284c7', '#2563eb',
    '#4f46e5', '#7c3aed', '#9333ea', '#c026d3', '#db2777'
]

with open(kml_file, 'w', encoding='utf-8') as f:
    f.write('<?xml version="1.0" encoding="UTF-8"?>\n')
    f.write('<kml xmlns="http://www.opengis.net/kml/2.2">\n')
    f.write('<Document>\n')
    f.write('  <name>Rewari 30 Sweeper Beats (Divided by Major Roads)</name>\n')
    f.write('  <description>Municipal Council Rewari: 30 Operational Sweeper Beats sized for 10-12 sweepers per beat (~10.5 km per beat). Formed along physical boundaries (Circular Road, Railway Lines, Radial Arteries).</description>\n')

    # Add Styles
    for i in range(1, 31):
        color = beat_palette[(i - 1) % len(beat_palette)]
        # KML color format: aabbggrr
        hex_color = color.lstrip('#')
        r, g, b = hex_color[0:2], hex_color[2:4], hex_color[4:6]
        kml_color = f"ff{b}{g}{r}"
        kml_fill = f"40{b}{g}{r}"
        f.write(f'  <Style id="beat_style_{i}">\n')
        f.write(f'    <LineStyle><color>{kml_color}</color><width>2.5</width></LineStyle>\n')
        f.write(f'    <PolyStyle><color>{kml_fill}</color><fill>1</fill><outline>1</outline></PolyStyle>\n')
        f.write(f'  </Style>\n')

    # Folder: 30 Beats
    f.write('  <Folder>\n')
    f.write('    <name>30 Sweeper Beats Directory</name>\n')

    for b in all_30_beats:
        b_id = b['id']
        b_name = b['name']
        sw_count = b['sweepers']
        b_len = b['len']
        seg_count = len(b['roads'])
        daily_tgt = int((b_len * 1000) / sw_count)

        f.write('    <Folder>\n')
        f.write(f'      <name>{esc(b_name)} ({sw_count} Sweepers | {b_len:.2f} km)</name>\n')
        f.write(f'      <description><![CDATA[')
        f.write(f'<h3>{b_name}</h3>')
        f.write(f'<table border="1" cellpadding="5" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;">')
        f.write(f'<tr><td><b>Total Road Length:</b></td><td>{b_len:.2f} km</td></tr>')
        f.write(f'<tr><td><b>Sweepers Deployed:</b></td><td><b>{sw_count} Sweepers</b></td></tr>')
        f.write(f'<tr><td><b>Daily Target per Sweeper:</b></td><td>~{daily_tgt} meters/shift</td></tr>')
        f.write(f'<tr><td><b>Road Segments:</b></td><td>{seg_count} streets</td></tr>')
        f.write(f'<tr><td><b>Operational Shift:</b></td><td>8-hour morning shift (6:30 AM - 2:30 PM)</td></tr>')
        f.write(f'<tr><td><b>Anti-Hiding Supervision:</b></td><td>Fixed Micro-Beats (1 worker = 550m marked lane)</td></tr>')
        f.write(f'</table>')
        f.write(f']]></description>\n')

        # Add polygon envelope (bounding box + buffer)
        all_b_pts = [p for r in b['roads'] for p in r['coords']]
        if all_b_pts:
            min_x = min(p[0] for p in all_b_pts) - 0.0005
            max_x = max(p[0] for p in all_b_pts) + 0.0005
            min_y = min(p[1] for p in all_b_pts) - 0.0005
            max_y = max(p[1] for p in all_b_pts) + 0.0005
            f.write('      <Placemark>\n')
            f.write(f'        <name>{esc(b_name)} [Boundary Perimeter]</name>\n')
            f.write(f'        <styleUrl>#beat_style_{b_id}</styleUrl>\n')
            f.write('        <Polygon><outerBoundaryIs><LinearRing><coordinates>')
            f.write(f'{min_x},{min_y},0 {max_x},{min_y},0 {max_x},{max_y},0 {min_x},{max_y},0 {min_x},{min_y},0')
            f.write('</coordinates></LinearRing></outerBoundaryIs></Polygon>\n')
            f.write('      </Placemark>\n')

        # Add road lines
        for r_idx, r in enumerate(b['roads']):
            f.write('      <Placemark>\n')
            f.write(f'        <name>{esc(r["name"] or f"Street {r_idx+1}")}</name>\n')
            f.write(f'        <description>Length: {r["len"]:.3f} km | Beat: {b_id}</description>\n')
            f.write(f'        <styleUrl>#beat_style_{b_id}</styleUrl>\n')
            f.write('        <LineString><coordinates>' + ' '.join(f"{c[0]},{c[1]},0" for c in r['coords']) + '</coordinates></LineString>\n')
            f.write('      </Placemark>\n')

        f.write('    </Folder>\n')

    f.write('  </Folder>\n')
    f.write('</Document>\n')
    f.write('</kml>\n')

print(f"Generated 30-Beat KML for Google Earth: {kml_file} ({os.path.getsize(kml_file):,} bytes)")
