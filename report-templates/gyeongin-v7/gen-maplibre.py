# MapLibre + MapTiler(streets-v2, 대시보드 discover와 동일) 기반 개척 우선순위 지도 HTML 생성
import json
import numpy as np

GJ = '/Users/leedo/Downloads/경기북부 인허가/next-app/public/geojson/dong/incheon.json'
ENV = '/Users/leedo/Downloads/경기북부 인허가/next-app/.env.local'

key = ''
for ln in open(ENV):
    if ln.startswith('NEXT_PUBLIC_MAPTILER_KEY='):
        key = ln.split('=', 1)[1].strip()
assert key, 'MAPTILER key not found'

d = json.load(open(GJ))
YEONGJONG = {'영종동', '영종1동', '영종2동', '운서1동', '운서2동', '용유동'}
TARGET_GU = {'미추홀구', '남동구', '중구', '동구'}

FOCUS = ('학익', '구월', '논현')
KEEP = ('주안', '관교')
EXPAND = ('개항', '송림', '신흥')
LOW = ('용현', '숭의', '간석')

C_FOCUS, C_KEEP, C_EXPAND, C_LOW, C_OTHER = '#1d6fd1', '#8fc0f2', '#2fbf8b', '#b9b7ae', '#e8e6df'


def cat(gu, name):
    if any(name.startswith(p) for p in FOCUS):
        return 'focus'
    if any(name.startswith(p) for p in KEEP):
        return 'keep'
    if gu in ('중구', '동구') and any(name.startswith(p) for p in EXPAND):
        return 'expand'
    if any(name.startswith(p) for p in LOW):
        return 'low'
    return 'other'


def rings(geom):
    if geom['type'] == 'Polygon':
        return [geom['coordinates'][0]]
    return [poly[0] for poly in geom['coordinates']]


feats = []
group_pts = {}
xs, ys = [], []
for f in d['features']:
    p = f['properties']
    gu, name = p['sgg'], p['name']
    if gu not in TARGET_GU or name in YEONGJONG:
        continue
    c = cat(gu, name)
    feats.append({'type': 'Feature', 'properties': {'cat': c}, 'geometry': f['geometry']})
    biggest = max(rings(f['geometry']), key=len)
    arr = np.array(biggest)
    xs += list(arr[:, 0]); ys += list(arr[:, 1])
    for pref in FOCUS + KEEP + EXPAND + LOW:
        if name.startswith(pref):
            group_pts.setdefault(pref, []).append(arr.mean(axis=0))

fill_gj = {'type': 'FeatureCollection', 'features': feats}

LABELS = {
    '학익': ('학익 +12.3%/년', '#0d4fa8'),
    '구월': ('구월 +6.5%/년', '#0d4fa8'),
    '논현': ('논현 +5.7%/년', '#0d4fa8'),
    '주안': ('주안 신규 42곳 (-6.3%/년)', '#2a5d94'),
    '관교': ('관교 보합', '#2a5d94'),
    '개항': ('북성동1가 연 1→9곳', '#0a7d55'),
    '송림': ('송림 재개발 입주', '#0a7d55'),
    '신흥': ('신흥동3가 1→4곳', '#0a7d55'),
    '용현': ('용현 -13.2%', '#6b6a64'),
    '숭의': ('숭의 -7.7%', '#6b6a64'),
    '간석': ('간석 -7.6%', '#6b6a64'),
}
pt_feats = []
for pref, (txt, col) in LABELS.items():
    pts = group_pts.get(pref)
    if not pts:
        continue
    cx, cy = np.array(pts).mean(axis=0)
    pt_feats.append({'type': 'Feature', 'properties': {'label': txt, 'col': col},
                     'geometry': {'type': 'Point', 'coordinates': [float(cx), float(cy)]}})
# 구 라벨
GU_LABELS = [('미추홀구', 126.674, 37.4445), ('남동구', 126.732, 37.442), ('제물포구', 126.632, 37.4835)]
gu_feats = [{'type': 'Feature', 'properties': {'label': g}, 'geometry': {'type': 'Point', 'coordinates': [x, y]}}
            for g, x, y in GU_LABELS]

bounds = [[min(xs), min(ys)], [max(xs), max(ys)]]

html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet">
<style>
  html,body{{margin:0;padding:0}} #map{{width:1470px;height:860px}}
  .card{{position:absolute;background:rgba(255,255,255,.94);border-radius:10px;box-shadow:0 1px 6px rgba(0,0,0,.18);
        font-family:"Apple SD Gothic Neo","Malgun Gothic",sans-serif;z-index:10}}
  #title{{top:14px;left:14px;padding:10px 16px;font-size:19px;font-weight:800;color:#111}}
  #title small{{display:block;font-size:12px;font-weight:500;color:#666;margin-top:2px}}
  #legend{{bottom:26px;left:14px;padding:12px 16px;font-size:13px;color:#222}}
  #legend div{{display:flex;align-items:center;margin:3px 0;font-weight:600}}
  #legend i{{width:16px;height:12px;border-radius:3px;margin-right:8px;display:inline-block}}
</style></head><body>
<div id="map"></div>
<div class="card" id="title">동 단위 개척 우선순위 지도<small>타겟업종 신규 개업 연평균 증감률(22→25년) 기준 · 행정동 경계</small></div>
<div class="card" id="legend">
  <div><i style="background:{C_FOCUS}"></i>개척 집중 (1순위) — 학익·구월·논현</div>
  <div><i style="background:{C_KEEP}"></i>유지·방어 + 선별 개척 — 주안·관교</div>
  <div><i style="background:{C_EXPAND}"></i>확장 후보 (27년 진입) — 북성동1가·송림·신흥</div>
  <div><i style="background:{C_LOW}"></i>거래처 유지 관리 (후순위) — 용현·숭의·간석</div>
  <div><i style="background:{C_OTHER};border:1px solid #ccc"></i>기타 (오픈 감지 대응)</div>
</div>
<script>
const FILL = {json.dumps(fill_gj)};
const PTS = {json.dumps(pt_feats, ensure_ascii=False)};
const GUS = {json.dumps(gu_feats, ensure_ascii=False)};
const map = new maplibregl.Map({{
  container:'map',
  style:'https://api.maptiler.com/maps/streets-v2/style.json?key={key}',
  bounds: {json.dumps(bounds)},
  fitBoundsOptions: {{ padding: {{top:56, bottom:36, left:44, right:30}} }},
  attributionControl: false, interactive: false,
}});
map.on('load', () => {{
  map.addSource('dong', {{type:'geojson', data: FILL}});
  map.addLayer({{id:'dong-fill', type:'fill', source:'dong', paint:{{
    'fill-color': ['match',['get','cat'],'focus','{C_FOCUS}','keep','{C_KEEP}','expand','{C_EXPAND}','low','{C_LOW}','{C_OTHER}'],
    'fill-opacity': ['match',['get','cat'],'focus',0.62,'keep',0.55,'expand',0.58,'low',0.42,0.3],
  }}}});
  map.addLayer({{id:'dong-line', type:'line', source:'dong', paint:{{'line-color':'#ffffff','line-width':1.1,'line-opacity':0.9}}}});
  map.addSource('pts', {{type:'geojson', data:{{type:'FeatureCollection', features: PTS}}}});
  map.addLayer({{id:'pt-label', type:'symbol', source:'pts', layout:{{
    'text-field':['get','label'], 'text-font':['Noto Sans Bold'], 'text-size':14.5, 'text-allow-overlap':true,
  }}, paint:{{'text-color':['get','col'], 'text-halo-color':'#ffffff', 'text-halo-width':1.8}}}});
  map.addSource('gus', {{type:'geojson', data:{{type:'FeatureCollection', features: GUS}}}});
  map.addLayer({{id:'gu-label', type:'symbol', source:'gus', layout:{{
    'text-field':['get','label'], 'text-font':['Noto Sans Bold'], 'text-size':22, 'text-allow-overlap':true,
    'text-letter-spacing':0.08,
  }}, paint:{{'text-color':'#33415e', 'text-halo-color':'#ffffff', 'text-halo-width':2.2, 'text-opacity':0.95}}}});
  map.once('idle', () => {{ document.title = 'MAP_READY'; }});
}});
</script></body></html>"""

open('map.html', 'w').write(html)
print('map.html written, features:', len(feats), 'labels:', len(pt_feats))
