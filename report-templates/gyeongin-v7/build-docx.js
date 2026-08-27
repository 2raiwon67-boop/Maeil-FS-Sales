const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, HeadingLevel, BorderStyle, ShadingType, LevelFormat, ImageRun,
} = require('docx');
const fs = require('fs');

// 차트 PNG(180dpi 렌더)를 본문 폭(약 620px @96dpi)에 맞춰 삽입
function img(file, wIn, hIn) {
  return new Paragraph({
    spacing: { before: 120, after: 120 },
    children: [new ImageRun({
      type: 'png',
      data: fs.readFileSync(file),
      transformation: { width: 620, height: Math.round(620 * hIn / wIn) },
    })],
  });
}

const NAVY = '1B3F82';
const GRAY = '595959';
const LIGHT = 'EEF3FB';
const FONT = '맑은 고딕';

const t = (text, opts = {}) => new TextRun({ text, font: FONT, size: 20, ...opts });
const p = (children, opts = {}) => new Paragraph({ children: Array.isArray(children) ? children : [children], spacing: { after: 120 }, ...opts });

function heading(no, text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 160 },
    children: [
      new TextRun({ text: `${no}. `, font: FONT, size: 26, bold: true, color: NAVY }),
      new TextRun({ text, font: FONT, size: 26, bold: true, color: NAVY }),
    ],
  });
}

// 사내 개조식 불릿 "-." (기획팀 이메일 표기 준용)
function bullet(text) {
  const runs = typeof text === 'string' ? [t(text)] : text;
  return new Paragraph({
    children: [new TextRun({ text: '-. ', font: FONT, size: 20, color: GRAY }), ...runs],
    spacing: { after: 80 },
    indent: { left: 240, hanging: 240 },
  });
}

const CELL_MARGIN = { top: 60, bottom: 60, left: 100, right: 100 };

function cell(text, { width, bold = false, shade = null, align = AlignmentType.LEFT, color } = {}) {
  // '\n' 금지(docx에서 무시됨) — 줄 배열로 받으면 문단을 나눠 렌더
  const lines = Array.isArray(text) ? text : [text];
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    margins: CELL_MARGIN,
    shading: shade ? { type: ShadingType.CLEAR, fill: shade } : undefined,
    children: lines.map((ln) => new Paragraph({
      alignment: align,
      children: [new TextRun({ text: String(ln), font: FONT, size: 18, bold, color })],
    })),
  });
}

// 셀 내 개조식 불릿 줄 — 각 줄은 TextRun 배열(사이즈 18 기준)
const tt = (text, opts = {}) => new TextRun({ text, font: FONT, size: 18, ...opts });
function bcell(lines, { width } = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    margins: CELL_MARGIN,
    children: lines.map((runs) => new Paragraph({
      indent: { left: 200, hanging: 200 },
      spacing: { after: 40 },
      children: [new TextRun({ text: '-. ', font: FONT, size: 18, color: GRAY }), ...(Array.isArray(runs) ? runs : [runs])],
    })),
  });
}

function table(colWidths, rows) {
  return new Table({
    width: { size: colWidths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: colWidths,
    rows,
  });
}

function headerRow(cols, widths) {
  return new TableRow({
    tableHeader: true,
    children: cols.map((c, i) => cell(c, { width: widths[i], bold: true, shade: LIGHT, align: AlignmentType.CENTER })),
  });
}

const doc = new Document({
  numbering: { config: [] },
  styles: {
    default: { document: { run: { font: FONT, size: 20 } } },
  },
  sections: [{
    properties: { page: { margin: { top: 1100, bottom: 1100, left: 1250, right: 1250 } } },
    children: [
      // ── 표지부 ──
      new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text: '경기북부FS/특수지점 · 내부 검토자료 · v7', font: FONT, size: 17, color: GRAY })],
      }),
      new Paragraph({
        spacing: { after: 80 },
        children: [new TextRun({ text: '경인특판대리점 지역 운영 플랜 및 육성 계획 (보완자료)', font: FONT, size: 32, bold: true, color: NAVY })],
      }),
      new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text: '영업지역: 인천 남동구/미추홀구/제물포구  |  대리점장 교체 검토 건 (26.09월부 개설 목표)', font: FONT, size: 20, color: GRAY })],
      }),
      new Paragraph({
        spacing: { after: 240 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: NAVY } },
        children: [new TextRun({ text: '기준일 2026-08-26  |  인구: 행정안전부 주민등록(22.10~26.07)  |  시장: 지방행정 인허가 — FS 타겟업종 13종(무인점포·기타 휴게음식점 제외)  |  거래율/매출: FS채널기획팀 표(26.3.15)  |  개척 실적: ERP 예상매출 집계(24년~26.7월, 인천 3구 대리점 합)', font: FONT, size: 16, color: GRAY })],
      }),

      p([
        t('본 자료는 FS채널기획팀 보완 요청 사항(① 주요 대리점 운영 현황 및 통합 가능성 검토 ② 지역도 기반 운영 플랜 ③ 거래율/매출액 기반 단계별 육성 플랜)에 대해 당 지점 수집 데이터와 최근 3개년 개척 실적(ERP)으로 근거를 보완한 자료입니다. 핵심 검토 결과는 다음과 같습니다.'),
      ]),
      bullet([t('타겟업종 기준 해당 지역 시장은 신규 개업 연평균 -1.6%(22→25년)로 '), t('시장 규모는 정체 상태이나, 개·폐업 교체가 활발한 시장', { bold: true }), t('임.')]),
      bullet([t('현행 개척 수준(월 4곳)은 거래처 자연 감소분을 겨우 상쇄하는 수준으로, '), t('거래처 저변이 확대되지 못한 구조적 원인이 확인됨.', { bold: true })]),
      bullet([t('총무 운영 요건(70~80백만원) 도달을 위해서는 '), t('거래처 개척 확대(24년 전략개척으로 검증)와 품목 확대를 통한 거래처당 매출 확보(25~26년 실적으로 검증)의 병행이 필요', { bold: true }), t('하며, 병행 시 28년 3분기 도달 가능할 것으로 판단됨.')]),
      bullet([t('본 안은 대리점 대형화 방향과 상충하지 않음 — 3개 구 광역 단일 대리점 1곳을 '), t('대형 대리점 기준(70~80백만원)까지 육성하는 안', { bold: true }), t('으로, 육성 완료 시 인접 지역 통합의 주체로 활용 가능함 (2항).')]),

      // ── 1. 검토 요약 ──
      heading(1, '검토 요약'),
      table([2500, 1700, 4800], [
        headerRow(['지표', '수치', '비고'], [2500, 1700, 4800]),
        new TableRow({ children: [cell('3구 인구 합 (26.07)', { width: 2500 }), cell('99.7만 명', { width: 1700, bold: true, align: AlignmentType.RIGHT }), cell('인천 306만의 32.6% 점유. 미추홀 증가 전환·제물포 26.01월 저점 후 반등', { width: 4800 })] }),
        new TableRow({ children: [cell('타겟업종 운영 매장 (실측)', { width: 2500 }), cell('895곳', { width: 1700, bold: true, align: AlignmentType.RIGHT }), cell('미추홀 409 / 남동 364 / 제물포 122 (무인점포·기타휴게 제외)', { width: 4800 })] }),
        new TableRow({ children: [cell('타겟업종 신규 개업 추이', { width: 2500 }), cell('연평균 -1.6%', { width: 1700, bold: true, align: AlignmentType.RIGHT }), cell('연도별 308→295→271→293곳(22→25년) — 규모 정체. 25년 폐업 333곳(교체 활발)', { width: 4800 })] }),
        new TableRow({ children: [cell('거래율 / 시장 입점율', { width: 2500 }), cell('25.8% / 21.2%', { width: 1700, bold: true, align: AlignmentType.RIGHT }), cell('거래 190곳. 거래율 분모 = 본사 전수 737곳 · 입점율 분모 = 당사 실측 895곳', { width: 4800 })] }),
        new TableRow({ children: [cell('개척 실적 (24년~26.7월)', { width: 2500 }), cell('166곳', { width: 1700, bold: true, align: AlignmentType.RIGHT }), cell('월평균 3.9~7.3곳 · 거래처당 월평균 예상매출 26.0~51.3만원 (6항)', { width: 4800 })] }),
        new TableRow({ children: [cell('경인특판 월평균 매출액', { width: 2500 }), cell('27.9백만원', { width: 1700, bold: true, align: AlignmentType.RIGHT }), cell('25년 실적. 26년 본사 타겟 28.9백만원 · 총무 운영 요건 70~80백만원', { width: 4800 })] }),
      ]),

      // ── 2. 교체 타당성 ──
      heading(2, '대리점 교체 타당성 검토 — 통합이 아닌 유지·교체 (보완요청 ① 대응)'),
      p([t('검토 순서: 대리점 대형화 방향과의 정합성을 먼저 확인하고, 지역 내 주요 플레이어와의 통합 가능성을 대리점별로 검토·소거한 후, 대리점 유지·교체의 타당성 및 필요성을 정리함. 수치 출처는 기획팀 "FS 지역 경쟁력 강화" 표.')]),
      p([t('2-1. 대리점 대형화 방향과의 정합성 — 본 안은 대리점 수 축소 방향과 상충하지 않음', { bold: true })]),
      bullet([t('경인특판은 지역 단위로는 이미 대형화가 완료된 구조임', { bold: true }), t(' — 3개 구(인구 99.7만 명, 타겟업종 895곳)를 묶은 광역 단일 대리점으로, 본 안은 대리점 수를 늘리는 안이 아니라 1곳을 대형 대리점 기준까지 육성하는 안임.')]),
      bullet([t('본 육성 플랜의 목표가 곧 대형화 기준임', { bold: true }), t(' — 6항 육성 플랜의 도달 목표(28년 75.5백만원)는 총무 운영 요건(70~80백만원)과 동일. 즉 "대리점 수 유지 + 대리점당 규모 확대"로 대형화 방향의 실행 사례에 해당함.')]),
      bullet([t('통합 시 합산 수치는 서류상 대형화에 그침', { bold: true }), t(' — 대창상사(69.5백만원)와 합산 시 97.4백만원으로 즉시 대형화로 보이나, 강화군~남동구 간 일일 배송·방문 동선이 성립하지 않아 합산 매출이 유지되지 않는 결합임. 대형화의 실익(배송 밀도·관리 효율)은 지리적으로 연속된 지역에서만 발생함.')]),
      p([t('2-2. 통합 대안 검토 (소거)', { bold: true })]),
      table([2200, 6800], [
        headerRow(['통합 대안', '검토 결과 (기각 사유)'], [2200, 6800]),
        new TableRow({ children: [
          cell(['대창상사와 통합', '(FS 육성, 제물포 서브)'], { width: 2200, bold: true }),
          cell('주력 운영 지역이 강화군으로 강화~남동 간 일일 배송·방문 동선이 성립하지 않음. 월 69.5백만원 규모로 26년 성장 타겟(71.7→77.2)까지 기배정되어 자기 지역 육성에 여력 소진. 3구(인구 99.7만) 추가 시 양쪽 모두 관리 희석 우려.', { width: 6800 }),
        ] }),
        new TableRow({ children: [
          cell(['GT 대리점과 통합', '(남인천/동인천/삼성에프에스)'], { width: 2200, bold: true }),
          cell('본사 표 기준 전원 유지대리점으로 지역 내 육성급 대리점 부재 — 성장 투자 여력이 없는 대리점에 성장 지역을 맡기는 구조적 한계. 채널 특성도 상이(GT 소매유통 vs FS 업소직납). 인접 서부천대리점은 월매출 -14% 역성장 중.', { width: 6800 }),
        ] }),
      ]),
      p([t('→ 검토 결과: 지역 내 인수 여력이 있는 통합 상대가 없어, 대리점 유지 + 대리점장 교체가 지역 내 자사 경쟁력 강화의 유일한 경로로 판단됨. 유지·교체의 적극적 근거는 아래와 같음.', { bold: true })]),
      p([t('2-3. 유지·교체의 적극적 근거', { bold: true })]),
      bullet([t('영업활동 강화가 성과를 결정한다는 자체 실증 (24년 전략지역 개척활동)', { bold: true }), t(' — 지점 인원 투입으로 직접 방문 개척한 24년, 3구 개척이 월 7.3곳(남동 52곳/년)으로 평시(월 4곳 수준)의 약 2배. 성과 차이가 지역이나 대리점 역량이 아닌 활동량과 지원에서 발생함을 보여줌 — 신규 대리점장 + 전략개척 프로그램 병행 시 재현 가능할 것으로 판단됨.')]),
      bullet([t('축소(통합 이관) 시 비용은 확정적, 유지·교체 시 비용은 없음', { bold: true }), t(' — 거래 190곳·월 27.9백만원은 장기 운영으로 축적된 자산. 이관 혼선으로 보수적으로 15%만 이탈해도 월 4.2백만원(연 50백만원 수준)이 경쟁사로 이전되며, 연 폐업 333곳·개업 293곳이 교차하는 시장 특성상 회수가 어려움. 반면 유지·교체는 후보자가 연초부터 당 대리점 총무로 활동 중이어서 이관 비용·영업 공백이 발생하지 않음.')]),
      bullet([t('선점 시기를 놓치면 회복 불가', { bold: true }), t(' — 미추홀 인구 증가 전환·제물포 7개월 연속 반등은 재개발 입주로 시장이 확대되기 직전의 신호. 전담 대리점 부재 시 신규 개업(연 293곳)을 경쟁사가 선점하며, 이후 대형 대리점을 구성하려 해도 인수할 거래 기반이 남지 않음. 축소는 육성 이후에도 가능하나 잃은 거래 기반은 되돌릴 수 없음.')]),
      bullet([t('거래율 25.8%는 상한이 아님', { bold: true }), t(' — 인천 전체 입점율 수준이며, 연수구 30%·계양구 32% 사례가 상방 여지의 근거.')]),
      bullet([t('미개척 여지 존재', { bold: true }), t(' — 당사 실측 타겟업종 895곳 vs 본사 전수 737곳으로 전수 미등록 매장 약 160곳 + 신규 개업 연 293곳 발생. 전담 대리점 체제여야 개척이 우선순위 유지.')]),
      p([t('→ 본 안은 대형화의 예외가 아니라 수순임: 육성 완료 시 경인특판이 운영 요건(70~80백만원)을 충족하는 대형 대리점이 되며, 이후 인접 지역 통합의 주체로 활용 가능. 분기 지표 점검에서 미달 시 그 시점에 축소·통합을 재검토할 수 있어 하방 리스크도 제한적임.', { bold: true })]),
      p([t('리스크 관리: ① 분기 관리 지표(개척 곳수/거래처당 매출/거래율) 6개월 점검 후 미달 시 재검토 ② 제물포 확장은 대창상사 경계 협의 완료 조건 ③ 27년 총무 증원 로드맵으로 세대 연속성 확보.', { size: 18 })]),

      // ── 3. 영업지역 운영 현황 ──
      heading(3, '영업지역 운영 현황 — 남동구/미추홀구/제물포구'),
      table([1400, 1800, 1200, 2600, 1200, 1800], [
        headerRow(['구분', '인구 (4년 추이)', '운영 매장', '신규 개업 (22→25년)', '25년 폐업', '운영 방향'], [1400, 1800, 1200, 2600, 1200, 1800]),
        new TableRow({ children: [
          cell('미추홀구', { width: 1400, bold: true }), cell('41.9만 (+2.8%)', { width: 1800, align: AlignmentType.RIGHT }),
          cell('409곳', { width: 1200, align: AlignmentType.RIGHT }), cell('142→126 (연평균 -3.9%)', { width: 2600, align: AlignmentType.RIGHT }),
          cell('133', { width: 1200, align: AlignmentType.RIGHT }), cell('공략 (선별)', { width: 1800, bold: true, color: NAVY }),
        ] }),
        new TableRow({ children: [
          cell('남동구', { width: 1400, bold: true }), cell('47.9만 (-5.7%)', { width: 1800, align: AlignmentType.RIGHT }),
          cell('364곳', { width: 1200, align: AlignmentType.RIGHT }), cell('124→133 (연평균 +2.4%)', { width: 2600, align: AlignmentType.RIGHT }),
          cell('151', { width: 1200, align: AlignmentType.RIGHT }), cell('유지·방어 + 성장 상권', { width: 1800, bold: true }),
        ] }),
        new TableRow({ children: [
          cell('제물포구', { width: 1400, bold: true }), cell('9.9만 (-3.1%)', { width: 1800, align: AlignmentType.RIGHT }),
          cell('122곳', { width: 1200, align: AlignmentType.RIGHT }), cell('42→34 (연평균 -6.8%)', { width: 2600, align: AlignmentType.RIGHT }),
          cell('49', { width: 1200, align: AlignmentType.RIGHT }), cell('선점 (27년 확장)', { width: 1800, bold: true, color: NAVY }),
        ] }),
      ]),
      img('chart-pop.png', 10.4, 2.5),
      bullet([t('미추홀구', { bold: true }), t(' — 재개발 입주로 인구 증가 전환, 3구 중 최대 시장(409곳). 다만 신규 개업 총량은 연평균 -3.9%로 감소 추세여서 개척은 성장 상권 선별 집중이 필요함. 학익동이 인구(+19%/2년)와 신규 개업(연평균 +12.3%)이 동반 증가하는 유일한 동.')]),
      bullet([t('남동구', { bold: true }), t(' — 인구는 감소하나 타겟업종 신규 개업이 증가(연평균 +2.4%)하는 유일한 구. 구월(+6.5%)·논현(+5.7%)이 견인하며 카페 채널 밀도 3구 중 최고 — 주거 인구와 상권 흐름이 반대로 움직이는 지역.')]),
      bullet([t('제물포구', { bold: true }), t(' — 인구 26.01월 저점(98,072명) 후 7개월 연속 반등(원도심 재개발 입주 신호). 시장 규모는 작으나(122곳) 북성동1가가 연 1곳→9곳으로 회복(월미도·개항로 관광상권). GT 동인천·FS 대창상사 모두 서브 수준이어서 선점 여지가 큰 것으로 판단됨.')]),
      img('chart-mkt.png', 10.4, 2.6),
      p([
        t('타겟업종 시장은 규모는 정체, 개·폐업 교체는 활발한 시장임', { bold: true }),
        t(' — 신규 개업이 연 271~308곳 범위(연평균 -1.6%)로 유지되는 한편 폐업이 연 284~400곳 발생. 시사점은 두 가지: ① 개척은 거래처 자연 감소분을 초과해야 순증 가능 ② 매장 교체가 빠른 만큼 신규 오픈 감지를 통한 초기 방문 선점이 유효한 영업 수단임.'),
      ]),
      p([t('※ 전체 업종 기준 순감(-206곳/년)은 무인점포·기타 휴게음식점 감소에 따른 것으로 당사 영업 대상 시장과 무관. 제물포구 인구는 26.07월 행정구역 개편 이전 구간을 "동구 전체 + 옛 중구의 제물포 소속 법정동" 합산으로 산출(영종 제외).', { size: 16, color: GRAY })]),

      // ── 4. 지역도 기반 개척 우선순위 ──
      heading(4, '지역도 기반 개척 우선순위 — 동 단위'),
      img('chart-map.png', 10.4, 7.4),
      p([t('※ 행정동 경계 기준(북성동1가는 개항동, 신흥동3가는 신흥동 관할 표시). 배경 지도는 시장분석 대시보드와 동일(MapTiler).', { size: 16, color: GRAY })]),
      img('chart-dong.png', 10.4, 2.9),
      bullet([t('개척 집중 지역 (1순위)', { bold: true }), t(' — 학익동(연평균 +12.3%, 인구 +19% 동반)·구월동(+6.5%)·논현동(+5.7%): 신규 개업이 구조적으로 증가하는 동으로 개척 활동의 중심.')]),
      bullet([t('유지·방어 + 선별 개척 지역', { bold: true }), t(' — 주안동(25년 신규 42곳으로 절대량 1위, 단 연평균 -6.3% 감소)·관교동(23곳, 보합): 기존 거래처 방어와 신규 오픈 선별 대응.')]),
      bullet([t('거래처 유지 관리 지역 (후순위)', { bold: true }), t(' — 용현동(-13.2%)·숭의동(-7.7%)·간석동(-7.6%): 신규 개척보다 기존 거래처 유지 관리 중심.')]),
      bullet([t('확장 후보 지역 (제물포)', { bold: true }), t(' — 북성동1가(연 1→9곳 회복, 관광상권)·송림동(인구 +7% 입주 시작): 27년 진입 검토.')]),
      p([t('※ 이전 버전의 "관교동 1위(신규 138곳)"는 무인점포 포함 전체 업종 집계에 따른 부풀림으로, 타겟업종 기준 연 23곳(보합)으로 교정함. 후보자 강점(베이커리 채널)은 주안·구월 상권과 부합.', { size: 16, color: GRAY })]),

      // ── 5. 단계별 운영 플랜 ──
      heading(5, '지역도 기반 단계별 운영 플랜 (보완요청 ② 대응)'),
      table([1900, 7100], [
        headerRow(['단계', '내용'], [1900, 7100]),
        new TableRow({ children: [
          cell(['Phase 1', '26.09~26.12'], { width: 1900, bold: true }),
          cell('안착 + 전략개척 재개 — 기존 거래처(190곳) 전수 인수인계 방문으로 이탈 최소화. 개척은 24년 검증된 수준(월 7~8곳)으로 재가동하되 개척 집중 지역(구월/논현/학익) + 신규 오픈 감지 대응. 개척 시점부터 품목 세트 진입(우유+가공유+휘핑)으로 거래처당 월평균 매출 34만원 수준 확보.', { width: 7100 }),
        ] }),
        new TableRow({ children: [
          cell(['Phase 2', '27.01~27.06'], { width: 1900, bold: true }),
          cell('유지 지역 선별 확대 + 품목 확대 (총무 투입 예정 시점) — 주안/관교 신규 오픈 선별 개척, 기존 카페 거래처 품목 확대(우유 단일 → 가공유·휘핑·베이커리 유지류)로 거래처당 매출 인상. 거래율 31% 도달 목표 = 27년 2분기 (6항 참조 — 26년 내 31%는 실적 대비 무리한 목표로 판단됨).', { width: 7100 }),
        ] }),
        new TableRow({ children: [
          cell(['Phase 3', '27.07~'], { width: 1900, bold: true }),
          cell('제물포 확장 — 인구 반등 1년 이상 확인 시점에 북성동1가(월미도·개항로 회복 상권)·송림동(입주) 진입. 대창상사(주력 강화도)와 경계 협의 병행. 100평 이상 대형 신규는 오픈 감지 시스템으로 전담 관리.', { width: 7100 }),
        ] }),
      ]),

      // ── 6. 거래율/매출액 기반 단계별 육성 플랜 ──
      heading(6, '거래율/매출액 기반 단계별 육성 플랜 (보완요청 ③ 대응)'),
      new Paragraph({
        spacing: { before: 60, after: 140 },
        shading: { type: ShadingType.CLEAR, fill: LIGHT },
        border: { left: { style: BorderStyle.SINGLE, size: 24, color: NAVY } },
        children: [
          new TextRun({ text: '단계별 육성 목표 (병행안 기준):  ', font: FONT, size: 19, bold: true }),
          new TextRun({ text: "현 거래율 25.8% · 월평균 매출액 27.9백만원 > '26년말 27.8% · 30.6백만원 > ", font: FONT, size: 19 }),
          new TextRun({ text: "'27년 2분기 31.3% (거래율 31% 목표 도달)", font: FONT, size: 19, bold: true }),
          new TextRun({ text: " > '27년말 34.3% · 56.2백만원 > ", font: FONT, size: 19 }),
          new TextRun({ text: "'28년 3분기 총무 운영 요건 도달 (71.1백만원)", font: FONT, size: 19, bold: true, color: NAVY }),
          new TextRun({ text: " > '28년말 39.8% · 75.5백만원", font: FONT, size: 19 }),
        ],
      }),
      p([t('추정 계수는 가정이 아닌 최근 3개년 개척 실적(ERP 예상매출, 인천 3구 활동 대리점 합계)을 사용함.')]),
      table([1500, 1200, 1700, 1400, 1400, 1800], [
        headerRow(['연도', '개척 수', '월 예상매출 합', '거래처당', '월평균 개척', '비고'], [1500, 1200, 1700, 1400, 1400, 1800]),
        new TableRow({ children: [cell('2024', { width: 1500, bold: true }), cell('88곳', { width: 1200, align: AlignmentType.RIGHT }), cell('2,289만원', { width: 1700, align: AlignmentType.RIGHT }), cell('26.0만원', { width: 1400, align: AlignmentType.RIGHT }), cell('7.3곳', { width: 1400, bold: true, align: AlignmentType.RIGHT }), cell('전략지역 개척활동 — 지점 인원 투입 (개척 수 우위)', { width: 1800 })] }),
        new TableRow({ children: [cell('2025', { width: 1500, bold: true }), cell('51곳', { width: 1200, align: AlignmentType.RIGHT }), cell('2,407만원', { width: 1700, align: AlignmentType.RIGHT }), cell('47.2만원', { width: 1400, align: AlignmentType.RIGHT }), cell('4.3곳', { width: 1400, align: AlignmentType.RIGHT }), cell('평시 선별 개척 (거래처당 매출 우위)', { width: 1800 })] }),
        new TableRow({ children: [cell('2026 (1~7월)', { width: 1500, bold: true }), cell('27곳', { width: 1200, align: AlignmentType.RIGHT }), cell('1,385만원', { width: 1700, align: AlignmentType.RIGHT }), cell('51.3만원', { width: 1400, align: AlignmentType.RIGHT }), cell('3.9곳', { width: 1400, align: AlignmentType.RIGHT }), cell('연환산 46곳 수준', { width: 1800 })] }),
      ]),
      img('chart-cohort.png', 10.4, 2.6),
      bullet([t('거래처 저변이 확대되지 못한 원인', { bold: true }), t(' — 거래 190곳은 시장 폐업률만큼 자연 감소함(연 15.3~24% 수준, 월 2.4~3.8곳). 현행 개척 월 3.9~4.3곳은 이 감소분을 겨우 상쇄하는 수준으로 활동을 해도 제자리인 구조. 24년 전략개척(월 7.3곳)만이 감소분을 확실히 초과함.')]),
      bullet([t('개척 수와 거래처당 매출은 반비례', { bold: true }), t(' — 대량 개척한 24년은 거래처당 26만원, 선별 개척한 25~26년은 47~51만원. 플랜의 기준값 34만원 = 선별 개척 예상매출(48.6만원)에 실현율 70%를 적용한 보수적 수치.')]),
      p([
        t('위 계수로 개설(26.09월) 이후를 분기 단위로 추정함. 공통 가정: 기존 거래처 자연 감소 연 15.3%(폐업 기준 하한) · 신규 거래처 첫 1년 연 24% 수준 감소 · 개척 첫 분기는 정착 기간으로 매출의 절반만 반영 · 기존 거래처는 품목 확대로 27년 분기당 +4%(28년 +3→+2%) 매출 인상.', { size: 18 }),
      ]),
      table([3100, 1100, 1200, 1500, 2300, 1600], [
        headerRow(['육성 방안', '개척/월', '거래처당', '27년 4분기', '28년 4분기 (입점율)', '요건 도달'], [3100, 1100, 1200, 1500, 2300, 1600]),
        new TableRow({ children: [cell('① 현행 수준 유지 시', { width: 3100 }), cell('4곳', { width: 1100, align: AlignmentType.RIGHT }), cell('34만원', { width: 1200, align: AlignmentType.RIGHT }), cell('42.8백만원', { width: 1500, align: AlignmentType.RIGHT }), cell('52.5백만원 (24.6%)', { width: 2300, align: AlignmentType.RIGHT }), cell('미도달', { width: 1600, bold: true, align: AlignmentType.CENTER })] }),
        new TableRow({ children: [cell('② 개척 확대 단독 시 (24년식 대량 개척)', { width: 3100 }), cell('7곳', { width: 1100, align: AlignmentType.RIGHT }), cell('18만원', { width: 1200, align: AlignmentType.RIGHT }), cell('42.5백만원', { width: 1500, align: AlignmentType.RIGHT }), cell('52.0백만원 (32.7%)', { width: 2300, align: AlignmentType.RIGHT }), cell('미도달', { width: 1600, bold: true, align: AlignmentType.CENTER })] }),
        new TableRow({ children: [cell('③ 개척 확대 + 품목 확대 병행 시 (권장)', { width: 3100, bold: true, color: NAVY }), cell('7곳', { width: 1100, bold: true, align: AlignmentType.RIGHT }), cell('34만원', { width: 1200, bold: true, align: AlignmentType.RIGHT }), cell('56.2백만원', { width: 1500, bold: true, align: AlignmentType.RIGHT }), cell('75.5백만원 (32.7%)', { width: 2300, bold: true, align: AlignmentType.RIGHT }), cell('28년 3분기 (71.1)', { width: 1600, bold: true, color: NAVY, align: AlignmentType.CENTER })] }),
      ]),
      img('chart-sim.png', 10.4, 3.0),
      bullet([t('①과 ②는 28년말 매출이 동일(52백만원 수준)', { bold: true }), t(' — 거래처당 매출만 높이면 저변이 확대되지 않고, 개척 수만 늘리면 거래처당 매출이 낮음. 단독으로는 요건 도달 불가하며, 개척 확대와 품목 확대의 병행(③)이 유일한 도달 경로임. 두 요소 모두 자체 실적으로 검증됨(개척 수: 24년 전략개척 월 7.3곳 / 거래처당 매출: 25~26년 선별 개척 47~51만원).')]),
      bullet([t('거래율 31% 도달은 27년 2분기로 판단됨', { bold: true }), t(' — 병행안 기준 26년말 27.8% → 27년 2분기 31.3%(전수 737곳 고정 가정). 26년 내 31%는 실적 수준 대비 무리한 목표로, 27년 상반기 목표가 방어 가능한 수치임.')]),
      bullet([t('관리 지표는 개척 곳수 단독이 아닌 "월 7곳 × 거래처당 34만원"의 조합', { bold: true }), t(' — 거래처당 매출이 25만원 수준에 그치면 28년 4분기 63백만원으로 미도달. 대형 거래처 유치(월 1.5백만원급)는 부족분 보완 수단으로 배치.')]),
      bullet([t('28년말 시장 입점율 32.7%(293곳/895곳)', { bold: true }), t(' — 인천 최고 계양구(32%) 수준으로 실측 시장 기준 상한 안쪽의 현실적 목표.')]),

      // ── 7. 검토 시 유의사항 ──
      heading(7, '검토 시 유의사항 (데이터 기준)'),
      bullet([t('개척 실적(24년~26.7월)은 인천 3구에서 활동한 대리점 합계', { bold: true }), t('로 경인특판 단독 실적이 아님 — 신규 대리점 단독으로 월 7곳 수행 시 24년식 지점 인원 투입(전략개척 프로그램) 병행이 전제.')]),
      bullet([t('매출액은 ERP 예상매출 기준', { bold: true }), t('으로 실현율(예상 대비 실제 청구)은 미검증 — 플랜은 70%를 적용했으며, 실제 청구 매출 확인 시 재보정 필요(실현율이 가정보다 높으면 도달 시점이 28년 1분기까지 단축).')]),
      bullet([t('거래처 자연 감소율 연 15.3%는 인허가 폐업 기준 하한선', { bold: true }), t(' — 폐업 없이 거래만 중단하는 이탈은 미포함으로, 실제 필요 개척 수는 이보다 많을 수 있음.')]),
      bullet('타겟업종 13종 기준: 유제품을 상시 사용하는 업태(카페·디저트 7종 + 외식 6종)만 집계 — 무인점포·자판기가 집중된 \'기타\'·\'기타 휴게음식점\' 제외. 업종 범위를 넓혀도 동별 순위와 증감 방향은 동일함.'),
      bullet('시장 추이는 완결 연도(2022~2025) 총량의 연평균 증감률 기준 — 2026년은 공공 데이터 수집 지연으로 집계 진행 중이라 추이 판단에서 제외.'),
      bullet('거래율 분모(전수 737곳)는 기획팀 표(26.3.15) 기준으로 분기 갱신 — 보고 시점 최신 표 재확인 요망. 입점율 분모(실측 895곳)는 당사 수집 데이터로 매월 자동 갱신.'),

      new Paragraph({
        spacing: { before: 360 },
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'C9CDD4' } },
        children: [new TextRun({ text: '경기북부FS/특수지점 수집 데이터 + ERP 개척 실적 기반 · 내부 검토용 v7 (대외 공유 전 전수·매출 최신치 재확인 요망)', font: FONT, size: 16, color: GRAY })],
      }),
    ],
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(process.argv[2] || 'out.docx', buf);
  console.log('written', buf.length);
});
