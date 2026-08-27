# v5 시뮬레이션 — 실측 코호트 파라미터 (개척 단가 μ = ERP 예상매출 실측, 이탈 = 시장/코호트 실측)
Q = ['26.4Q','27.1Q','27.2Q','27.3Q','27.4Q','28.1Q','28.2Q','28.3Q','28.4Q']
CHURN_MATURE = 0.039   # 성숙 거래처 분기 이탈 (15.3%/년 — 인허가 폐업 기준 하한선)
CHURN_YOUNG = 0.06     # 신규 코호트 첫 4분기 (시장 신생 폐업률 ~24%/년 반영)
UPLIFT = [0, .04, .04, .04, .04, .03, .02, .02, .02]  # 기존 단가 품목확대 (27년 집중)
BASE_N, BASE_REV = 190, 27.9  # 개설 시점 (백만원/월)


def run(A, mu):
    """A = 분기 개척 수, mu = 안착 단가(백만/월). 반환: (거래처수, 월매출) 분기별"""
    mature_n, mature_arpu = BASE_N, BASE_REV / BASE_N
    cohorts = []  # [n, mu, age]
    out = []
    for qi in range(len(Q)):
        # 기존 성숙 풀: 이탈 + 품목확대
        mature_n *= (1 - CHURN_MATURE)
        mature_arpu *= (1 + UPLIFT[qi])
        # 기존 코호트 노화·이탈
        for c in cohorts:
            c[2] += 1
            c[0] *= (1 - (CHURN_YOUNG if c[2] <= 4 else CHURN_MATURE))
        # 신규 개척 (당분기, 램프업 50%)
        cohorts.append([A, mu, 0])
        n = mature_n + sum(c[0] for c in cohorts)
        rev = mature_n * mature_arpu + sum(c[0] * c[1] * (0.5 if c[2] == 0 else 1) for c in cohorts)
        out.append((n, rev))
    return out


for name, A, mu in [('S1 현행 페이스(분기12·34만)', 12, 0.34),
                    ('S2 전략개척 볼륨(분기22·18만)', 22, 0.182),
                    ('S3 하이브리드(분기22·34만)', 22, 0.34)]:
    print(f"\n== {name} ==")
    for qi, (n, rev) in enumerate(run(A, mu)):
        print(f"{Q[qi]}: 거래처 {n:5.0f}  침투율 {n/895*100:4.1f}%  월매출 {rev:5.1f}백만")

# 상쇄선/현행 페이스 검증
print('\n상쇄선: 성숙기준 월', round(190*0.153/12, 1), '/ 시장재고기준 월', round(190*0.239/12, 1))
print('실측 페이스: 24년 월', round(88/12, 1), '· 25년 월', round(51/12, 2), '· 26년 월', round(27/7, 2))
print('μ 예상단가: 24년', round(2289/88, 1), '· 25년', round(2407/51, 1), '· 26년', round(1385/27, 1), '· 25~26 가중', round((2407+1385)/(51+27), 1))
