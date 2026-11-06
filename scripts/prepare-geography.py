"""Build the public map data from published geoBoundaries and OTP GTFS files.
Usage: python3 scripts/prepare-geography.py BOUNDARIES.geojson NAMTANG_GTFS.zip
No invented coordinates or line colors. See site/data/SOURCES.md for attribution.
"""
import csv
import io
import json
import sys
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1] / 'site' / 'data'
admin = json.loads(Path(sys.argv[1]).read_text())
feature = next(f for f in admin['features'] if f['properties'].get('shapeISO') == 'TH-10')
# Precision remains roughly 0.1 m; retain the published polygon, including concavities.
coords = [[round(x,6),round(y,6)] for x,y in feature['geometry']['coordinates'][0]]
city = {'type':'Feature','properties':{'name':'Bangkok','source':'geoBoundaries gbOpen THA ADM1','iso':'TH-10'},'geometry':{'type':'Polygon','coordinates':[coords]}}
def signed_area(ring):
    return sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(ring,ring[1:]))/2
# RFC 7946 exterior counterclockwise; a reversed city ring is the mask's hole.
if signed_area(coords) < 0:
    coords.reverse()
bbox = [min(p[0] for p in coords),min(p[1] for p in coords),max(p[0] for p in coords),max(p[1] for p in coords)]
city['bbox'] = bbox
mask = {'type':'Feature','properties':{},'geometry':{'type':'Polygon','coordinates':[[[-180,-85],[180,-85],[180,85],[-180,85],[-180,-85]],list(reversed(coords))]}}
z = zipfile.ZipFile(sys.argv[2])
def rows(name):
    return csv.DictReader(io.TextIOWrapper(z.open(name),encoding='utf-8-sig'))
route_names = {'1':'BTS Sukhumvit','2':'BTS Silom','3':'MRT Blue','4':'MRT Purple','5':'Airport Rail Link','2025':'BTS Gold','2026':'SRT Dark Red','2027':'SRT Light Red','2224':'MRT Yellow','2436':'MRT Pink'}
routes = {r['route_id']:r for r in rows('routes.txt') if r['route_id'] in route_names}
assert set(routes) == set(route_names), 'One or more expected urban rail lines are missing from the feed.'
trips = {t['trip_id']:t for t in rows('trips.txt') if t['route_id'] in routes}
route_shapes = {r:set() for r in routes}
for trip in trips.values():
    if trip['shape_id']:
        route_shapes[trip['route_id']].add(trip['shape_id'])
needed_shapes = set().union(*route_shapes.values())
shapes = {shape:[] for shape in needed_shapes}
for row in rows('shapes.txt'):
    if row['shape_id'] in needed_shapes:
        shapes[row['shape_id']].append((int(row['shape_pt_sequence']),round(float(row['shape_pt_lon']),6),round(float(row['shape_pt_lat']),6)))
for key,points in shapes.items():
    shapes[key] = [[x,y] for _,x,y in sorted(points)]
features = []
for route_id,route in routes.items():
    lines = []
    seen = set()
    for shape_id in sorted(route_shapes[route_id]):
        line = shapes[shape_id]
        if len(line)<2:
            continue
        signature = min(json.dumps(line),json.dumps(list(reversed(line))))
        if signature not in seen:
            seen.add(signature)
            lines.append(line)
    assert lines, f'Missing route geometry for {route_id}'
    features.append({'type':'Feature','properties':{'route_id':route_id,'name':route_names[route_id],'color':'#'+route['route_color'].upper()},'geometry':{'type':'MultiLineString','coordinates':lines}})
stop_routes = {}
for row in rows('stop_times.txt'):
    if row['trip_id'] in trips:
        stop_routes.setdefault(row['stop_id'],set()).add(trips[row['trip_id']]['route_id'])
stations = []
for stop in rows('stops.txt'):
    if stop['stop_id'] not in stop_routes:
        continue
    name = stop['stop_name'].split(';')[-1].strip()
    for route_id in sorted(stop_routes[stop['stop_id']]):
        stations.append({'type':'Feature','properties':{'name':name,'route_id':route_id,'color':'#'+routes[route_id]['route_color'].upper()},'geometry':{'type':'Point','coordinates':[round(float(stop['stop_lon']),6),round(float(stop['stop_lat']),6)]}})
feed = next(rows('feed_info.txt'))
network = {'type':'FeatureCollection','metadata':{'source':'Office of Transport and Traffic Policy and Planning, Namtang GTFS','license':'CC BY 4.0','feed_version':feed['feed_version'],'retrieved':'2026-11-06'},'features':features}
for filename,data in [('bangkok-boundary.geojson',city),('bangkok-mask.geojson',mask),('bangkok-rail.geojson',network),('bangkok-stations.geojson',{'type':'FeatureCollection','features':stations})]:
    (root/filename).write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n')
    print(filename, (root/filename).stat().st_size, 'bytes')
print('Rail lines:',len(features),'station platforms:',len(stations),'feed:',feed['feed_version'],'bounds:',bbox)
