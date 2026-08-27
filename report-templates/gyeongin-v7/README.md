# 경인특판 보고서 v7 템플릿 (2026-08-26 발송본)

월별·지역 보고서의 **문체·구조·디자인 기준본**. 새 보고서는 이 폴더를 복사해 숫자·지역만 갈아끼운다.
(원본은 세션 스크래치패드에 있었음 — 소멸 방지용으로 리포지토리에 박제, 2026-08-27)

## 파일

| 파일 | 역할 |
|---|---|
| `report-print.html` | 인쇄 원본(=PDF 소스). **문장·논증·표·레이아웃의 단일 소스** — 문체 기준이 필요하면 이 파일을 읽을 것 |
| `build-docx.js` | HTML을 미러링한 Word 생성기(docx 라이브러리). ⚠️**출력이 `process.argv[2] \|\| 'out.docx'`** — 인자 없이 돌리면 out.docx에만 쓰고 본 파일명은 갱신 안 됨(구버전 발송 사고 원인). 반드시 `node build-docx.js 최종파일명.docx` |
| `gen-charts.py` | matplotlib 차트 6종 생성(chart-*.png). 데이터는 스크립트에 인라인 — 새 달 숫자로 교체 |
| `compute-v5.py` | 육성 플랜 시뮬레이션 수치 계산 |
| `gen-maplibre.py` | MapLibre 우선순위 지도 HTML 생성(대시보드와 동일 MapTiler 스타일) |
| `compose-map.py` | 캔버스 캡처(chart-map-raw.png)에 제목·범례 카드 PIL 합성 → chart-map.png |
| `upload-server.py` | 지도 캡처 수신용 로컬 서버(127.0.0.1:8901) |
| `chart-map.png` | 완성된 동 단위 우선순위 지도(재생성엔 아래 파이프라인 필요) |

## 지도 파이프라인 (MapTiler 키 origin 제한 대응)

MapTiler 키는 vercel 도메인 origin 제한이라 localhost에서 403. 확립된 우회:
사용자의 크롬 discover 탭(허용 origin)에 unpkg maplibre-gl 주입 → 같은 origin에서
`/geojson/dong/incheon.json` fetch → `preserveDrawingBuffer:true` 오버레이 렌더 →
`canvas.toDataURL()` → `fetch POST(no-cors)`로 localhost:8901 → compose-map.py 합성.
headless 크롬은 WebGL·타일 로딩 문제로 실패함(재시도 금지).

## PDF 빌드

Chrome headless 인쇄: `chrome --headless --print-to-pdf=... report-print.html` (A4, 배경 인쇄 켬).

## 문체 원칙 (v7에서 확정)

- 개조식 불릿 + 굵은 결론 선행, 근거는 괄호 정량("월 4.2백만·연 50백만")
- '적격' 같은 내부 용어 금지 → '타겟업종' 등 외부어
- 상대 기준 프레임: 반박 예상 지점을 먼저 서술하고 소거(2항 대형화 정합성 구조 참고)
- 각주는 ※ 접두, 데이터 출처·기준일 명기
