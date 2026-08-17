import { NextRequest, NextResponse } from 'next/server';
import { computeVisitTargets, type LicenseRow } from '@/lib/license-targets';
import { sigunguMatches } from '@/lib/regions';
import { staticMapSig } from '@/lib/staticmap';

export const maxDuration = 60;

const TH_CENTER =
  'background-color:#f1f3f5; color:#495057; font-weight:bold; padding:10px 12px; text-align:center; border:1px solid #dee2e6; white-space:nowrap;';
const TH_LEFT =
  'background-color:#f1f3f5; color:#495057; font-weight:bold; padding:10px 12px; text-align:left; border:1px solid #dee2e6; white-space:nowrap;';
const TD = 'padding:10px 12px; border:1px solid #e9ecef; color:#212529; vertical-align:middle;';

// 이메일 HTML에 들어가는 업로드 데이터(매장명·주소·담당자·링크 등)는 반드시 이스케이프 — HTML 인젝션 차단
const escHtml = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;');

interface AlertItem {
  id: string;
  name: string;
  pyeong: string;
  permitDate: string;
  address: string;
  status: string;
  manager: string;
  business_unit: string;
  openExpected?: boolean;
  naverLink?: string;
}

// 모든 알림 메일이 공유하는 외곽 셸(헤더 바 + 본문 + 푸터). 헤더 색/문구·인사말·본문만 주입.
function emailShell(o: { headerBg: string; headerBorder: string; title: string; subtitle: string; greeting: string; content: string }): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background-color:#f8f9fa; font-family:'Malgun Gothic','맑은 고딕',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f8f9fa"><tr><td align="center" style="padding:20px 10px;">
<table width="900" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff; border:1px solid #dee2e6;">
<tr><td bgcolor="${o.headerBg}" style="background-color:${o.headerBg}; padding:25px 30px; border-bottom:3px solid ${o.headerBorder};">
<p style="margin:0 0 6px 0; font-size:20px; font-weight:bold; color:#ffffff;">${o.title}</p>
<p style="margin:0; font-size:13px; color:#bdc3c7;">${o.subtitle}</p>
</td></tr>
<tr><td style="padding:30px; background-color:#ffffff;">
<p style="font-size:14px; color:#2c3e50; margin:0 0 20px 0;">${o.greeting}</p>
${o.content}
</td></tr>
<tr><td bgcolor="#f8f9fa" style="background-color:#f8f9fa; padding:18px 30px; border-top:1px solid #dee2e6; text-align:center;">
<p style="margin:0 0 4px 0; font-size:12px; color:#868e96;">FS MISO | 자동 발송 시스템</p>
<p style="margin:0; font-size:11px; color:#adb5bd;">본 이메일은 FS MISO AI시스템에 의해 발송되었습니다.</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function buildAlertEmailHtml(managerName: string, targets: { newObj: AlertItem[]; revisitObj: AlertItem[] }, isManager: boolean): string {
  const today = new Date().toLocaleDateString('ko-KR');

  const createRows = (list: AlertItem[]) =>
    list
      .map((t) => {
        const searchQuery = encodeURIComponent(`${t.name || ''} ${t.address || ''}`);
        const naverUrl = `https://map.naver.com/v5/search/${searchQuery}`;
        const showOpen = isManager && t.openExpected;
        const bdgBg = showOpen ? '#d3f9d8' : t.status === '공사중' ? '#fff3bf' : '#dbeafe';
        const bdgColor = showOpen ? '#2b8a3e' : t.status === '공사중' ? '#b45309' : '#1a56db';
        const badgeLabel = showOpen ? '오픈예상' : t.status || '-';
        const btnUrl = showOpen && t.naverLink ? t.naverLink : naverUrl;
        const btnLabel = showOpen ? '검색결과' : 'N 지도';
        const btnBg = showOpen ? '#2b8a3e' : '#03C75A';
        return `<tr>
<td style="${TD} font-weight:bold; color:#2c3e50;">${escHtml(t.name || '-')}</td>
<td style="${TD} text-align:center; white-space:nowrap;">${escHtml(t.pyeong || '-')}평</td>
<td style="${TD} text-align:center; color:#868e96; white-space:nowrap;">${escHtml(t.permitDate || '-')}</td>
<td style="${TD} text-align:center; white-space:nowrap;" align="center"><span style="background-color:${bdgBg}; color:${bdgColor}; padding:3px 10px; font-size:11px; font-weight:bold; white-space:nowrap;">${escHtml(badgeLabel)}</span></td>
<td style="${TD}">${escHtml(t.address || '-')}</td>
<td style="${TD} text-align:center; white-space:nowrap; color:#555;">${escHtml(t.manager || '-')}</td>
<td style="${TD} text-align:center; white-space:nowrap;" align="center"><a href="${escHtml(btnUrl)}" style="background-color:${btnBg}; color:#ffffff; padding:5px 12px; text-decoration:none; font-size:11px; font-weight:bold;">${btnLabel}</a></td>
</tr>`;
      })
      .join('');

  const tableWrap = (rows: string) =>
    `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; margin:8px 0 24px 0; font-size:13px;">
<thead><tr>
<th style="${TH_LEFT}">사업장명</th>
<th style="${TH_CENTER}">평형</th>
<th style="${TH_CENTER}">인허가일</th>
<th style="${TH_CENTER}">상태</th>
<th style="${TH_LEFT}">주소</th>
<th style="${TH_CENTER}">담당자</th>
<th style="${TH_CENTER}">위치</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>`;

  const sectionTitle = (color: string, text: string) =>
    `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 6px 0; border-bottom:2px solid ${color};">
<tr><td style="padding-bottom:6px; font-size:15px; font-weight:bold; color:${color};">${text}</td></tr>
</table>`;

  const newSection =
    targets.newObj.length > 0
      ? sectionTitle('#1c7ed6', '🚀 1. 신규 등록 대상 (D+14)') +
        '<p style="font-size:12px; color:#868e96; margin:0 0 8px 0;">인허가 등록 후 14일이 경과한 사업장 목록입니다.</p>' +
        tableWrap(createRows(targets.newObj)) +
        `<p style="font-size:12px; color:#868e96; margin:0 0 10px 0;">※ 총 ${targets.newObj.length}건의 대상이 확인되었습니다.</p>`
      : '<p style="color:#868e96; margin:16px 0;">(금일 신규 대상 없음)</p>';

  const revisitSection =
    targets.revisitObj.length > 0
      ? sectionTitle('#f08c00', '🔨 2. 공사 / 재확인 대상 (D+28)') +
        '<p style="font-size:12px; color:#868e96; margin:0 0 8px 0;">공사중 상태로 28일 이상 경과한 사업장 목록입니다.</p>' +
        tableWrap(createRows(targets.revisitObj)) +
        `<p style="font-size:12px; color:#868e96; margin:0 0 10px 0;">※ 총 ${targets.revisitObj.length}건의 대상이 확인되었습니다.</p>`
      : '<p style="color:#868e96; margin:16px 0;">(금일 재확인 대상 없음)</p>';

  return emailShell({
    headerBg: '#2c3e50',
    headerBorder: '#34495e',
    title: '📅 인허가 방문 대상 알림',
    subtitle: `${today} 기준 방문이 필요한 사업장 리스트입니다.`,
    greeting: `${escHtml(managerName)}님, 안녕하십니까,<br>금일 기준 방문이 필요한 사업장 리스트를 송부드립니다.<br>방문 일정 조율에 참고하시기 바랍니다.`,
    content: `${newSection}\n${revisitSection}`,
  });
}

function buildOpenDetectedEmailHtml(managerName: string, items: AlertItem[]): string {
  const today = new Date().toLocaleDateString('ko-KR');

  const rows = items
    .map((t) => {
      const btnUrl = t.naverLink || `https://map.naver.com/v5/search/${encodeURIComponent(t.name)}`;
      return `<tr>
<td style="${TD} font-weight:bold; color:#2c3e50;">${escHtml(t.name || '-')}</td>
<td style="${TD} text-align:center; white-space:nowrap;">${escHtml(t.pyeong || '-')}평</td>
<td style="${TD} text-align:center; color:#868e96; white-space:nowrap;">${escHtml(t.permitDate || '-')}</td>
<td style="${TD}">${escHtml(t.address || '-')}</td>
<td style="${TD} text-align:center; white-space:nowrap;" align="center"><a href="${escHtml(btnUrl)}" style="background-color:#2b8a3e; color:#ffffff; padding:5px 12px; text-decoration:none; font-size:11px; font-weight:bold;">검색결과</a></td>
</tr>`;
    })
    .join('');

  const content = `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; margin:8px 0 24px 0; font-size:13px;">
<thead><tr>
<th style="${TH_LEFT}">사업장명</th>
<th style="${TH_CENTER}">평형</th>
<th style="${TH_CENTER}">인허가일</th>
<th style="${TH_LEFT}">주소</th>
<th style="${TH_CENTER}">확인</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>
<p style="font-size:12px; color:#868e96; margin:0;">※ 네이버 검색 기반 추정이므로 직접 방문 확인을 권장합니다.</p>`;

  return emailShell({
    headerBg: '#2b8a3e',
    headerBorder: '#1e6e2e',
    title: '🏭 공사중 거래처 오픈 감지',
    subtitle: `${today} 기준 네이버에 등록된 공사중 거래처입니다.`,
    greeting: `${escHtml(managerName)}님, 안녕하십니까,<br>담당 공사중 거래처 중 네이버 지도에 등록된 곳이 있습니다.<br>방문 후 업데이트 부탁드립니다.`,
    content,
  });
}

// ── 100평+ 대형 신규 인허가 (시장 수집분 기반) ─────────────────────────────
// 데이터 소스는 refresh-market이 매일 새벽 채우는 market_store_records(수집 시점에 이미
// 타겟 업종 필터 적용됨) — 인허가 업로드와 무관하게 완전 자동으로 아침에 감지된다.

interface BigStoreItem {
  id: number;
  name: string;
  category: string;
  pyeong: number;
  address: string;
  sido: string;
  sigungu: string;
  license_date: string;
  lat: number | null;
  lng: number | null;
}

// managers.region1(시도 표기 자유) → market_store_records.sido 표기 정규화
function normRegion1(s: string): string {
  const t = (s || '').trim();
  if (t.startsWith('서울')) return '서울';
  if (t.startsWith('인천')) return '인천';
  if (t.startsWith('경기')) return '경기도';
  if (t.startsWith('강원')) return '강원도';
  return t;
}

function buildBigStoreEmailHtml(recipientName: string, items: BigStoreItem[], mapUrlFor: (it: BigStoreItem) => string | null): string {
  const today = new Date().toLocaleDateString('ko-KR');
  const MAX_MAPS = 8; // 지도 이미지는 상위 N건만 (메일 용량·로딩 보호), 나머지는 표만

  const cards = items
    .map((t, i) => {
      const naverUrl = `https://map.naver.com/v5/search/${encodeURIComponent(`${t.address || t.name}`)}`;
      const mapUrl = i < MAX_MAPS ? mapUrlFor(t) : null;
      const mapBlock = mapUrl
        ? `<tr><td colspan="2" style="padding:0; border:1px solid #e9ecef; border-top:none;"><a href="${escHtml(naverUrl)}"><img src="${escHtml(mapUrl)}" width="100%" alt="${escHtml(t.name)} 위치 지도" style="display:block; width:100%; max-width:840px; height:auto;"/></a></td></tr>`
        : '';
      return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; margin:0 0 22px 0; font-size:13px;">
<tr>
<td style="${TD} font-weight:bold; color:#2c3e50; font-size:14px; background-color:#f8f9fa;">${escHtml(t.name)} <span style="background-color:#fff4e6; color:#d9480f; padding:2px 8px; font-size:11px; font-weight:bold; margin-left:6px;">${escHtml(String(Math.round(t.pyeong)))}평</span> <span style="color:#868e96; font-weight:normal; font-size:12px; margin-left:6px;">${escHtml(t.category || '-')}</span></td>
<td style="${TD} text-align:right; white-space:nowrap; background-color:#f8f9fa;" align="right"><a href="${escHtml(naverUrl)}" style="background-color:#03C75A; color:#ffffff; padding:5px 12px; text-decoration:none; font-size:11px; font-weight:bold;">N 지도</a></td>
</tr>
<tr><td colspan="2" style="${TD} border-top:none;">${escHtml(t.address || '-')} <span style="color:#868e96; font-size:12px;">· ${escHtml(t.sigungu)} · 인허가 ${escHtml(t.license_date || '-')}</span></td></tr>
${mapBlock}
</table>`;
    })
    .join('');

  return emailShell({
    headerBg: '#c2410c',
    headerBorder: '#9a3412',
    title: '🏢 100평 이상 대형 신규 인허가',
    subtitle: `${today} 기준 담당 지역에 새로 확인된 대형 매장입니다.`,
    greeting: `${escHtml(recipientName)}님, 안녕하십니까,<br>담당 지역에 100평 이상 대형 신규 인허가 ${items.length}건이 확인되었습니다.<br>지도에서 위치를 확인하시고 우선 방문을 검토해 주세요.`,
    content: cards + '<p style="font-size:12px; color:#868e96; margin:0;">※ 시장 수집 데이터 기반 자동 감지 — 좌표 미확보 매장은 지도 없이 주소로 안내됩니다.</p>',
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const BREVO_KEY = process.env.BREVO_API_KEY;
  const FROM_EMAIL = process.env.BREVO_FROM_EMAIL || '2raiwon67@gmail.com';
  const FROM_NAME = 'FS MISO';
  const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
  const NAVER_SECRET = process.env.NAVER_CLIENT_SECRET;

  if (!SUPABASE_URL || !SERVICE_KEY || !BREVO_KEY) {
    return NextResponse.json({ error: '환경변수 누락: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BREVO_API_KEY 확인' }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const dryRun = searchParams.get('dryRun') === 'true';

  const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const isMonday = nowKST.getUTCDay() === 1;

  try {
    const sbHeaders: Record<string, string> = {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    };

    const [licResult, mgrResult] = await Promise.allSettled([
      fetch(`${SUPABASE_URL}/rest/v1/licenses?select=*&limit=10000`, { headers: sbHeaders }).then((r) => r.json()),
      fetch(`${SUPABASE_URL}/rest/v1/managers?select=*&limit=10000`, { headers: sbHeaders }).then((r) => r.json()),
    ]);

    const allLicenses = licResult.status === 'fulfilled' && Array.isArray(licResult.value) ? licResult.value : [];
    const allManagers = mgrResult.status === 'fulfilled' && Array.isArray(mgrResult.value) ? mgrResult.value : [];

    // 타겟팅 규칙(14/28일·상태)은 인앱 벨과 공유하는 computeVisitTargets 단일 소스 사용 — 규칙 드리프트 방지.
    const toItem = (t: { licenseId: string; name: string; area: string; permitDate: string; address: string; manager: string; businessUnit: string }, status: string): AlertItem => ({
      id: t.licenseId,
      name: t.name,
      pyeong: t.area,
      permitDate: t.permitDate,
      address: t.address,
      status,
      manager: t.manager,
      business_unit: t.businessUnit,
    });

    // 월요일에만 신규/재확인 다이제스트 산출
    const newTargets: AlertItem[] = [];
    const revisitTargets: AlertItem[] = [];
    if (isMonday) {
      for (const t of computeVisitTargets(allLicenses as LicenseRow[])) {
        if (t.kind === 'new') {
          newTargets.push(toItem(t, '인허가'));
        } else if (t.kind === 'revisit') {
          revisitTargets.push(toItem(t, '공사중'));
        } else if (t.kind === 'open') {
          revisitTargets.push({
            ...toItem(t, '공사중'),
            openExpected: true,
            naverLink: `https://map.naver.com/v5/search/${encodeURIComponent(t.name)}`,
          });
        }
      }
    }

    // 일일 오픈감지 후보: 1·2순위 공사중 + 오픈 미감지 (날짜 무관 — computeVisitTargets 범위 밖이라 별도 집계)
    const constructionAll: AlertItem[] = allLicenses
      .filter((row: any) => {
        const rank = String(row.priority || '').replace(/[^0-9]/g, '');
        return (rank === '1' || rank === '2') && (row.trade_status || '').trim() === '공사중' && !row.open_detected_at;
      })
      .map((row: any) => ({
        id: row.id,
        name: row.business_name || '',
        pyeong: row.area || '',
        permitDate: row.permit_date || '',
        address: row.road_address || '',
        status: '공사중',
        manager: row.manager || '',
        business_unit: row.business_unit || '',
      }));

    const newlyDetected: AlertItem[] = [];

    if (NAVER_CLIENT_ID && NAVER_SECRET && constructionAll.length > 0) {
      const naverSearch = async (item: AlertItem) => {
        try {
          const query = encodeURIComponent(item.name);
          const r = await fetch(`https://openapi.naver.com/v1/search/local.json?query=${query}&display=3`, {
            headers: { 'X-Naver-Client-Id': NAVER_CLIENT_ID, 'X-Naver-Client-Secret': NAVER_SECRET },
          });
          if (!r.ok) return;
          const data = await r.json();
          const matched = (data.items || []).find((i: any) => {
            const title = i.title.replace(/<[^>]+>/g, '');
            return title.includes(item.name) || item.name.includes(title);
          });
          if (matched) {
            item.openExpected = true;
            item.naverLink = matched.link || `https://map.naver.com/v5/search/${encodeURIComponent(item.name)}`;
            newlyDetected.push(item);
          }
        } catch {}
      };

      for (let i = 0; i < constructionAll.length; i += 5) {
        await Promise.all(constructionAll.slice(i, i + 5).map(naverSearch));
        if (i + 5 < constructionAll.length) await sleep(300);
      }

      if (!dryRun && newlyDetected.length > 0) {
        await Promise.allSettled(
          newlyDetected.map((item) =>
            fetch(`${SUPABASE_URL}/rest/v1/licenses?id=eq.${item.id}`, {
              method: 'PATCH',
              headers: { ...sbHeaders, Prefer: 'return=minimal' },
              body: JSON.stringify({ open_detected_at: new Date().toISOString() }),
            }),
          ),
        );
      }

      if (isMonday) {
        if (newlyDetected.length > 0) {
          const detectedIds = new Set(newlyDetected.map((i) => i.id));
          revisitTargets.forEach((t) => {
            if (detectedIds.has(t.id)) {
              t.openExpected = true;
              t.naverLink = newlyDetected.find((i) => i.id === t.id)?.naverLink || undefined;
            }
          });
        }
        revisitTargets.sort((a, b) => (b.openExpected ? 1 : 0) - (a.openExpected ? 1 : 0));
      }
    }

    // ── 100평+ 대형 신규 인허가 감지 (매일, market_store_records 기반) ──
    const BIG_SENT_STORE = '__big_alert_sent__'; // naver_cache 특수 행 — 발송 이력 (DDL 없이 기존 테이블 재활용)
    const BIG_SENT_CAP = 8000;   // 이력 상한 (jsonb 비대 방지 — 14일 창이라 실사용은 수백 건)
    const BIG_WINDOW_DAYS = 14;  // 인허가일 기준 감지 창 — 창을 벗어나면 이력 없이도 자연 만료
    const baseUrl = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || 'maeilfs-sales.vercel.app'}`;

    let bigStores: BigStoreItem[] = [];
    let bigSentRow: { id: string; ids: string[] } | null = null;
    try {
      const since = new Date(Date.now() - BIG_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/market_store_records?status=eq.new&pyeong=gte.100&license_date=gte.${since}` +
          `&select=id,name,category,pyeong,address,sido,sigungu,license_date,lat,lng&order=license_date.desc&limit=200`,
        { headers: sbHeaders, cache: 'no-store' },
      );
      const rows = r.ok ? await r.json() : [];
      const sr = await fetch(
        `${SUPABASE_URL}/rest/v1/naver_cache?store_name=eq.${encodeURIComponent(BIG_SENT_STORE)}&select=id,local_data&limit=1`,
        { headers: sbHeaders, cache: 'no-store' },
      );
      const srRows = sr.ok ? await sr.json() : [];
      const sentIds: string[] = Array.isArray(srRows[0]?.local_data?.ids) ? srRows[0].local_data.ids : [];
      if (srRows.length) bigSentRow = { id: srRows[0].id, ids: sentIds };
      const sentSet = new Set(sentIds);
      bigStores = (rows as BigStoreItem[]).filter((s) => !sentSet.has(String(s.id)));
    } catch {
      /* 대형 감지 실패는 다른 알림을 막지 않음 */
    }

    // 수신자 매칭: 매장 시군구를 맡은 담당자 + 그 지점의 지점장(unit 다이제스트).
    // 담당자가 없는 지역(예: 강원 인원 미등록)은 발송·이력 기록 없이 넘어감 — 14일 창이 지나며
    // 자연 소멸하고, 담당자가 등록되면 창 안의 매장부터 발송이 시작된다.
    const bigByManager = new Map<string, { name: string; bu: string; items: BigStoreItem[] }>();
    const bigByUnit = new Map<string, BigStoreItem[]>();
    const bigMatchedIds = new Set<string>();
    for (const s of bigStores) {
      for (const m of allManagers as Array<Record<string, unknown>>) {
        const email = String(m.email || '').trim();
        const region2 = String(m.region2 || '').trim();
        const bu = String(m.business_unit || '').trim();
        if (!email || !bu || !region2) continue;
        if (m.is_branch_manager || region2 === '지점장' || region2 === '전체') continue;
        if (normRegion1(String(m.region1 || '')) !== s.sido) continue;
        if (!sigunguMatches(s.sido, s.sigungu, region2)) continue;
        bigMatchedIds.add(String(s.id));
        const cur = bigByManager.get(email) || { name: String(m.manager_name || '').trim() || '담당자', bu, items: [] };
        cur.items.push(s);
        bigByManager.set(email, cur);
        if (!bigByUnit.has(bu)) bigByUnit.set(bu, []);
        const unitList = bigByUnit.get(bu)!;
        if (!unitList.some((x) => x.id === s.id)) unitList.push(s);
      }
    }
    const hasBig = bigMatchedIds.size > 0;

    const hasMonday = isMonday && (newTargets.length > 0 || revisitTargets.length > 0);
    const hasDailyOpen = newlyDetected.length > 0;

    if (dryRun) {
      const diagByUnit: Record<string, any> = {};
      allLicenses.forEach((row: any) => {
        const bu = row.business_unit || '미지정';
        if (!diagByUnit[bu]) diagByUnit[bu] = { total: 0, noRank: 0, noDate: 0, statusMap: {} };
        diagByUnit[bu].total++;
        const p = String(row.priority || '').trim();
        const rank = p.replace(/[^0-9]/g, '');
        if (rank !== '1' && rank !== '2') diagByUnit[bu].noRank++;
        if (!row.permit_date) diagByUnit[bu].noDate++;
        const s = (row.trade_status || '없음').trim();
        diagByUnit[bu].statusMap[s] = (diagByUnit[bu].statusMap[s] || 0) + 1;
      });
      return NextResponse.json({
        isMonday,
        newTargets: newTargets.length,
        revisitTargets: revisitTargets.length,
        constructionAll: constructionAll.length,
        newlyDetected: newlyDetected.length,
        bigCandidates: bigStores.length,
        bigNotifiable: bigMatchedIds.size,
        bigManagers: bigByManager.size,
        diagByUnit,
      });
    }

    if (!hasMonday && !hasDailyOpen && !hasBig) {
      return NextResponse.json({ success: true, message: '발송 대상 없음' });
    }

    const unitManagers: Record<string, { emailMap: Record<string, string>; branchEmails: string[] }> = {};
    allManagers.forEach((m: any) => {
      const name = (m.manager_name || '').trim();
      const email = (m.email || '').trim();
      const region2 = (m.region2 || '').trim();
      const bu = (m.business_unit || '').trim();
      if (!name || !email || !bu) return;
      if (!unitManagers[bu]) unitManagers[bu] = { emailMap: {}, branchEmails: [] };
      if (m.is_branch_manager || region2 === '지점장' || region2 === '전체') {
        unitManagers[bu].branchEmails.push(email);
      } else {
        unitManagers[bu].emailMap[name] = email;
      }
    });

    const results: any[] = [];

    // Brevo 발송 단일 헬퍼 — 발송 + 결과 적재(200ms 스로틀)를 일원화.
    const sendBrevo = async (meta: { type: string; manager: string; bu: string }, email: string, subject: string, html: string) => {
      const sendRes = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender: { name: FROM_NAME, email: FROM_EMAIL },
          to: [{ email }],
          subject,
          htmlContent: html,
        }),
      });
      const sendData = await sendRes.json();
      results.push({ ...meta, email, status: sendRes.ok ? 'sent' : 'failed', id: sendData.messageId || sendData.error || 'unknown' });
      await sleep(200);
    };

    if (hasMonday) {
      const allUnits = [...new Set([...newTargets.map((t) => t.business_unit), ...revisitTargets.map((t) => t.business_unit)])].filter(Boolean);

      for (const bu of allUnits) {
        const unitNew = newTargets.filter((t) => t.business_unit === bu);
        const unitRevisit = revisitTargets.filter((t) => t.business_unit === bu);
        const { emailMap = {}, branchEmails = [] } = unitManagers[bu] || {};

        const activeManagers = new Set([...unitNew.map((t) => t.manager), ...unitRevisit.map((t) => t.manager)]);

        for (const managerName of activeManagers) {
          if (!managerName || managerName === '미지정') continue;
          const email = emailMap[managerName];
          if (!email) continue;
          const myNew = unitNew.filter((t) => t.manager === managerName);
          const myRevisit = unitRevisit.filter((t) => t.manager === managerName);
          const html = buildAlertEmailHtml(managerName, { newObj: myNew, revisitObj: myRevisit }, true);
          await sendBrevo(
            { type: 'monday', manager: managerName, bu },
            email,
            `[인허가 알림] 신규 ${myNew.length}건 / 재확인 ${myRevisit.length}건`,
            html,
          );
        }

        for (const email of branchEmails) {
          const html = buildAlertEmailHtml('전체', { newObj: unitNew, revisitObj: unitRevisit }, false);
          await sendBrevo(
            { type: 'monday', manager: '지점장', bu },
            email,
            `[인허가 알림] 신규 ${unitNew.length}건 / 재확인 ${unitRevisit.length}건 (${bu} 전체)`,
            html,
          );
        }
      }
    }

    if (hasDailyOpen) {
      const revisitIds = new Set(revisitTargets.map((t) => t.id));
      const toNotify = isMonday ? newlyDetected.filter((item) => !revisitIds.has(item.id)) : newlyDetected;

      const openUnits = [...new Set(toNotify.map((t) => t.business_unit))].filter(Boolean);
      for (const bu of openUnits) {
        const unitItems = toNotify.filter((t) => t.business_unit === bu);
        const { emailMap = {} } = unitManagers[bu] || {};
        const activeManagers = new Set(unitItems.map((t) => t.manager));
        for (const managerName of activeManagers) {
          if (!managerName || managerName === '미지정') continue;
          const email = emailMap[managerName];
          if (!email) continue;
          const managerItems = unitItems.filter((t) => t.manager === managerName);
          const html = buildOpenDetectedEmailHtml(managerName, managerItems);
          await sendBrevo(
            { type: 'open-detected', manager: managerName, bu },
            email,
            `[오픈 감지] 공사중 거래처 ${managerItems.length}건 오픈 추정`,
            html,
          );
        }
      }
    }

    // ── 100평+ 대형 신규 발송 (담당자 개별 + 지점장 다이제스트) ──
    if (hasBig) {
      const buildMapUrl = (it: BigStoreItem): string | null => {
        if (it.lat == null || it.lng == null || !cronSecret) return null;
        return `${baseUrl}/api/staticmap?lat=${it.lat}&lng=${it.lng}&sig=${staticMapSig(it.lat, it.lng, cronSecret)}`;
      };
      // 지도 소스 헬스체크 — 정적 지도 키(NCP_MAPS_KEY 등)가 아직 없으면 프록시가 404를 내고
      // 메일에 깨진 이미지가 박힌다. 첫 후보로 1회 프로브해서 성공할 때만 이미지를 포함
      // (키가 등록되는 날부터 코드 변경 없이 자동으로 지도가 켜짐).
      let mapsAvailable = false;
      const probe = [...bigByManager.values()].flatMap((g) => g.items).map(buildMapUrl).find(Boolean);
      if (probe) {
        try {
          mapsAvailable = (await fetch(probe)).ok;
        } catch {
          /* 지도 없이 발송 */
        }
      }
      const mapUrlFor = (it: BigStoreItem): string | null => (mapsAvailable ? buildMapUrl(it) : null);

      for (const [email, g] of bigByManager) {
        const html = buildBigStoreEmailHtml(g.name, g.items, mapUrlFor);
        await sendBrevo(
          { type: 'big-store', manager: g.name, bu: g.bu },
          email,
          `[대형 신규] 100평+ 인허가 ${g.items.length}건 — 위치 확인`,
          html,
        );
      }
      for (const [bu, items] of bigByUnit) {
        const { branchEmails = [] } = unitManagers[bu] || {};
        for (const email of branchEmails) {
          const html = buildBigStoreEmailHtml('전체', items, mapUrlFor);
          await sendBrevo(
            { type: 'big-store', manager: '지점장', bu },
            email,
            `[대형 신규] 100평+ 인허가 ${items.length}건 (${bu} 전체)`,
            html,
          );
        }
      }

      // 발송 이력 기록 — 한 건이라도 발송에 성공했을 때만 (전면 실패 시 다음날 재시도)
      const bigSentOk = results.some((r) => r.type === 'big-store' && r.status === 'sent');
      if (bigSentOk) {
        try {
          const merged = [...new Set([...(bigSentRow?.ids ?? []), ...bigMatchedIds])].slice(-BIG_SENT_CAP);
          const payload = { local_data: { ids: merged }, cached_at: new Date().toISOString() };
          if (bigSentRow) {
            await fetch(`${SUPABASE_URL}/rest/v1/naver_cache?id=eq.${bigSentRow.id}`, {
              method: 'PATCH', headers: { ...sbHeaders, Prefer: 'return=minimal' }, body: JSON.stringify(payload),
            });
          } else {
            await fetch(`${SUPABASE_URL}/rest/v1/naver_cache`, {
              method: 'POST', headers: { ...sbHeaders, Prefer: 'return=minimal' },
              body: JSON.stringify({ store_name: BIG_SENT_STORE, ...payload }),
            });
          }
        } catch {
          /* 이력 기록 실패 → 다음날 중복 발송 가능성 — 치명적이지 않아 무시 */
        }
      }
    }

    return NextResponse.json({
      success: true,
      isMonday,
      newTargets: newTargets.length,
      revisitTargets: revisitTargets.length,
      newlyDetected: newlyDetected.length,
      bigNotified: bigMatchedIds.size,
      sent: results.filter((r) => r.status === 'sent').length,
      failed: results.filter((r) => r.status === 'failed').length,
      results,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
