# 캔버스 캡처(chart-map-raw.png)에 제목/범례 카드 합성 → chart-map.png
from PIL import Image, ImageDraw, ImageFont

im = Image.open('chart-map-raw.png').convert('RGBA')
W, H = im.size  # 2360x1680
ov = Image.new('RGBA', im.size, (0, 0, 0, 0))
d = ImageDraw.Draw(ov)

TTC = '/System/Library/Fonts/AppleSDGothicNeo.ttc'


def font(sz, bold=True):
    for i in range(12):
        try:
            f = ImageFont.truetype(TTC, sz, index=i)
            name = ' '.join(f.getname())
            if bold and 'Bold' in name:
                return f
            if not bold and 'Regular' in name:
                return f
        except Exception:
            break
    return ImageFont.truetype(TTC, sz)


f_title = font(44, True)
f_sub = font(26, False)
f_leg = font(27, True)

# 제목 카드
pad = 26
t1 = '동 단위 개척 우선순위 지도'
t2 = '타겟업종 신규 개업 연평균 증감률(22→25년) 기준 · 행정동 경계'
w1 = d.textlength(t1, font=f_title)
w2 = d.textlength(t2, font=f_sub)
cw = max(w1, w2) + pad * 2
ch = 44 + 26 + 30 + pad
d.rounded_rectangle([28, 28, 28 + cw, 28 + ch], radius=18, fill=(255, 255, 255, 242))
d.text((28 + pad, 28 + 18), t1, font=f_title, fill=(17, 17, 17, 255))
d.text((28 + pad, 28 + 18 + 52), t2, font=f_sub, fill=(102, 102, 102, 255))

# 범례 카드
LEG = [
    ('#1d6fd1', '개척 집중 (1순위) — 학익·구월·논현'),
    ('#8fc0f2', '유지·방어 + 선별 개척 — 주안·관교'),
    ('#2fbf8b', '확장 후보 (27년 진입) — 북성동1가·송림·신흥'),
    ('#b9b7ae', '거래처 유지 관리 (후순위) — 용현·숭의·간석'),
    ('#e8e6df', '기타 (오픈 감지 대응)'),
]
row_h = 44
lw = max(d.textlength(t, font=f_leg) for _, t in LEG) + 40 + pad * 2
lh = row_h * len(LEG) + pad * 2 - 8
lx, ly = 28, H - lh - 34
d.rounded_rectangle([lx, ly, lx + lw, ly + lh], radius=18, fill=(255, 255, 255, 242))
for i, (c, t) in enumerate(LEG):
    yy = ly + pad - 4 + i * row_h
    d.rounded_rectangle([lx + pad, yy + 8, lx + pad + 30, yy + 30], radius=6, fill=c)
    d.text((lx + pad + 44, yy + 2), t, font=f_leg, fill=(30, 30, 30, 255))

out = Image.alpha_composite(im, ov).convert('RGB')
out.save('chart-map.png', optimize=True)
print('chart-map.png', out.size)
