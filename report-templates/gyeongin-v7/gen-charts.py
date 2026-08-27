# 경인특판 v5 보고서 차트 — 적격 13업종 실측 + 개척 코호트 실측 기반
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter

plt.rcParams['font.family'] = 'Apple SD Gothic Neo'
plt.rcParams['axes.unicode_minus'] = False

BLUE, ORANGE, AQUA, INK, MUTED, GRID = '#2a78d6', '#eb6834', '#1baf7a', '#0b0b0b', '#898781', '#e1e0d9'

def style(ax):
    for s in ['top','right']: ax.spines[s].set_visible(False)
    for s in ['left','bottom']: ax.spines[s].set_color(GRID)
    ax.tick_params(colors=MUTED, labelsize=8)
    ax.grid(axis='y', color=GRID, linewidth=0.6)
    ax.set_axisbelow(True)

# ── 1) 인구 추이 (chart-pop.png) — v4 그대로 유지, 재생성 생략 ──

# ── 2) 개척 코호트 실측 (chart-cohort.png) ──
fig, (a1, a2) = plt.subplots(1, 2, figsize=(10.4, 2.6), dpi=180)
yrs = ['2024\n(전략개척)', '2025', '2026\n(1~7월)']
pace = [7.3, 4.3, 3.9]
a1.axhspan(2.4, 3.8, color=ORANGE, alpha=0.12)
a1.text(2.42, 3.1, '거래처 자연 감소분 월 2.4~3.8곳', fontsize=8, color=ORANGE, va='center', ha='right')
bars = a1.bar(yrs, pace, color=[BLUE, '#9ec5f4', '#9ec5f4'], width=0.55)
for b, v in zip(bars, pace):
    a1.text(b.get_x() + b.get_width()/2, v + 0.15, f"{v}", ha='center', fontsize=9.5, color=INK, fontweight='bold')
style(a1); a1.set_ylim(0, 8.6)
a1.set_title('월평균 개척 수 (곳/월, 인천 3구 대리점 합계)', fontsize=10, color=INK, fontweight='bold', loc='left')

mu = [26.0, 47.2, 51.3]
bars = a2.bar(yrs, mu, color=[BLUE, '#9ec5f4', '#9ec5f4'], width=0.55)
a2.axhline(34, color=AQUA, lw=1.6, ls=(0, (5, 3)))
a2.text(2.42, 36.5, '플랜 기준 34만원 (예상매출 × 실현 70%)', fontsize=8, color=AQUA, ha='right')
for b, v in zip(bars, mu):
    a2.text(b.get_x() + b.get_width()/2, v + 1.5, f"{v}", ha='center', fontsize=9.5, color=INK, fontweight='bold')
style(a2); a2.set_ylim(0, 60)
a2.set_title('개척 거래처당 월평균 예상매출 (만원)', fontsize=10, color=INK, fontweight='bold', loc='left')
fig.suptitle('연도별 개척 실적 (ERP, 24년~26.7월) — 개척 수와 거래처당 매출은 반비례 관계', fontsize=11, color=INK, x=0.005, ha='left', fontweight='bold')
fig.tight_layout(rect=[0, 0, 1, 0.88])
fig.savefig('chart-cohort.png', facecolor='white'); plt.close(fig)

# ── 3) 적격 시장 개업·폐업 연도별 총량 (chart-mkt.png — CAGR 기준) ──
import numpy as np
YRS = ['2022', '2023', '2024', '2025']
YN = [308, 295, 271, 293]   # 3구 합 적격 신규
YC = [284, 400, 393, 333]   # 3구 합 적격 폐업
x = np.arange(4)
fig, ax = plt.subplots(figsize=(10.4, 2.6), dpi=180)
b1 = ax.bar(x - 0.19, YN, width=0.36, color=BLUE, label='개업')
b2 = ax.bar(x + 0.19, YC, width=0.36, color='#f2b49c', label='폐업')
for b, v in zip(b1, YN):
    ax.text(b.get_x() + b.get_width()/2, v + 8, f"{v}", ha='center', fontsize=9, color=INK, fontweight='bold')
for b, v in zip(b2, YC):
    ax.text(b.get_x() + b.get_width()/2, v + 8, f"{v}", ha='center', fontsize=8.5, color=MUTED)
style(ax)
ax.set_xticks(list(x)); ax.set_xticklabels(YRS, fontsize=9)
ax.set_ylim(0, 470)
ax.legend(loc='upper right', fontsize=8.5, frameon=False, ncols=2)
ax.text(0.005, 1.02, '', transform=ax.transAxes)
ax.annotate('개업 연평균 증감률(22→25) -1.6%/년 — 총량 보합', (0.02, 0.9), xycoords='axes fraction', fontsize=9, color=BLUE, fontweight='bold')
ax.set_title('타겟업종 시장 개업·폐업 — 연도별 총량, 3구 합 (2026년은 집계 진행 중으로 제외)', fontsize=11, color=INK, fontweight='bold', loc='left')
fig.tight_layout()
fig.savefig('chart-mkt.png', facecolor='white'); plt.close(fig)

# ── 4) 동 단위 연평균 증감률 (chart-dong.png — CAGR 기준) ──
# (동, 25년 신규, 연평균 증감률 문자열, 성장/축소 부호: 1 성장·-1 축소·0 유지)
GREEN, RED = '#008300', '#e34948'
DONG = {
  '미추홀구': [("주안동",42,"-6.3%/년",-1),("관교동",23,"+1.5%/년",0),("학익동",17,"+12.3%/년",1),("용현동",17,"-13.2%/년",-1),("도화동",12,"0%/년",0),("숭의동",11,"-7.7%/년",-1)],
  '남동구':   [("구월동",52,"+6.5%/년",1),("논현동",26,"+5.7%/년",1),("만수동",16,"-2.0%/년",0),("간석동",15,"-7.6%/년",-1),("서창동",10,"-3.1%/년",0)],
  '제물포구': [("북성동1가",9,"1→9곳",1),("송림동",4,"-7.2%/년",-1),("신흥동3가",4,"1→4곳",1)],
}
fig, axes = plt.subplots(1, 3, figsize=(10.4, 2.9), dpi=180)
for ax, g in zip(axes, ['미추홀구', '남동구', '제물포구']):
    rows = DONG[g][::-1]
    names = [r[0] for r in rows]
    new = [r[1] for r in rows]
    y = np.arange(len(rows))
    bars = ax.barh(y, new, height=0.58, color=BLUE)
    mx = max(new)
    for b, r in zip(bars, rows):
        col = GREEN if r[3] > 0 else RED if r[3] < 0 else MUTED
        ax.text(b.get_width() + mx*0.05, b.get_y() + b.get_height()/2, f"{r[1]}  ({r[2]})", va='center', fontsize=8.5, color=col, fontweight='bold')
    ax.set_yticks(y); ax.set_yticklabels(names)
    ax.set_xlim(0, mx * 1.75)
    for s in ['top','right','left']: ax.spines[s].set_visible(False)
    ax.spines['bottom'].set_color(GRID)
    ax.tick_params(colors=MUTED, labelsize=8.5)
    ax.tick_params(axis='y', colors=INK)
    ax.set_title(g, fontsize=10, color=INK, fontweight='bold', loc='left')
    ax.grid(axis='x', color=GRID, linewidth=0.6); ax.set_axisbelow(True)
fig.suptitle('동 단위 신규 개업 — 막대 = 25년 신규 곳수 · 괄호 = 연평균 증감률(22→25, 타겟업종)', fontsize=11, color=INK, x=0.005, ha='left', fontweight='bold')
fig.tight_layout(rect=[0, 0, 1, 0.90])
fig.savefig('chart-dong.png', facecolor='white'); plt.close(fig)

# ── 5) 시나리오 시뮬레이션 (chart-sim.png — 용어 정제) ──
labels = ['개설\n26.09', '26년\n4분기', '27년\n1분기', '27년\n2분기', '27년\n3분기', '27년\n4분기', '28년\n1분기', '28년\n2분기', '28년\n3분기', '28년\n4분기']
S1 = [27.9, 28.9, 32.7, 36.3, 39.6, 42.8, 45.6, 48.0, 50.3, 52.5]
S2 = [27.9, 28.8, 32.6, 36.1, 39.4, 42.5, 45.2, 47.6, 49.9, 52.0]
S3 = [27.9, 30.6, 37.6, 44.2, 50.4, 56.2, 61.5, 66.4, 71.1, 75.5]
xs = range(10)
fig, ax = plt.subplots(figsize=(10.4, 3.0), dpi=180)
ax.axhspan(70, 80, color=BLUE, alpha=0.08)
ax.text(0.15, 84.5, '총무 운영 요건 70~80백만', fontsize=8.5, color=MUTED, va='center')
ax.plot(xs, S2, color=ORANGE, lw=1.8, ls=(0, (5, 3)), marker='o', ms=4, label='② 개척 확대 단독 시 — 월 7곳 × 거래처당 18만원')
ax.plot(xs, S1, color=BLUE, lw=1.8, marker='o', ms=4, label='① 현행 수준 유지 시 — 월 4곳 × 거래처당 34만원')
ax.plot(xs, S3, color=AQUA, lw=2.4, marker='o', ms=5.5, mfc=AQUA, mec='white', mew=1.2, label='③ 개척 확대 + 품목 확대 병행 시 — 월 7곳 × 거래처당 34만원')
ax.annotate('71.1 — 28년 3분기 요건 도달', (8, 71.1), textcoords='offset points', xytext=(-18, 10), ha='center', fontsize=8.5, color=AQUA, fontweight='bold')
ax.annotate('75.5', (9, 75.5), textcoords='offset points', xytext=(0, 8), ha='center', fontsize=9, color=AQUA, fontweight='bold')
ax.annotate('①·② 겹침 — 단독으로는 52 수준, 요건 미달', (9, 51.8), textcoords='offset points', xytext=(-40, -16), ha='center', fontsize=8.5, color=INK)
style(ax)
ax.legend(loc='center left', bbox_to_anchor=(0.01, 0.72), fontsize=8, frameon=False)
ax.set_xticks(list(xs)); ax.set_xticklabels(labels, fontsize=8)
ax.set_xlim(-0.3, 9.4); ax.set_ylim(0, 96)
ax.set_title('매출 육성 방안별 추정 — 최근 3개년 개척 실적 기반 (백만원/월)', fontsize=11, color=INK, fontweight='bold', loc='left')
fig.tight_layout()
fig.savefig('chart-sim.png', facecolor='white'); plt.close(fig)

print('v5 charts done')
