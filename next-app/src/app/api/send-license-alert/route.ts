import { NextRequest, NextResponse } from 'next/server';

const TH_CENTER =
  'background-color:#f1f3f5; color:#495057; font-weight:bold; padding:10px 12px; text-align:center; border:1px solid #dee2e6; white-space:nowrap;';
const TH_LEFT =
  'background-color:#f1f3f5; color:#495057; font-weight:bold; padding:10px 12px; text-align:left; border:1px solid #dee2e6; white-space:nowrap;';
const TD = 'padding:10px 12px; border:1px solid #e9ecef; color:#212529; vertical-align:middle;';

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
<td style="${TD} font-weight:bold; color:#2c3e50;">${t.name || '-'}</td>
<td style="${TD} text-align:center; white-space:nowrap;">${t.pyeong || '-'}평</td>
<td style="${TD} text-align:center; color:#868e96; white-space:nowrap;">${t.permitDate || '-'}</td>
<td style="${TD} text-align:center; white-space:nowrap;" align="center"><span style="background-color:${bdgBg}; color:${bdgColor}; padding:3px 10px; font-size:11px; font-weight:bold; white-space:nowrap;">${badgeLabel}</span></td>
<td style="${TD}">${t.address || '-'}</td>
<td style="${TD} text-align:center; white-space:nowrap; color:#555;">${t.manager || '-'}</td>
<td style="${TD} text-align:center; white-space:nowrap;" align="center"><a href="${btnUrl}" style="background-color:${btnBg}; color:#ffffff; padding:5px 12px; text-decoration:none; font-size:11px; font-weight:bold;">${btnLabel}</a></td>
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

  return `<!DOCTYPE html>
<html lang="ko">
<head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background-color:#f8f9fa; font-family:'Malgun Gothic','맑은 고딕',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f8f9fa"><tr><td align="center" style="padding:20px 10px;">
<table width="900" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff; border:1px solid #dee2e6;">
<tr><td bgcolor="#2c3e50" style="background-color:#2c3e50; padding:25px 30px; border-bottom:3px solid #34495e;">
<p style="margin:0 0 6px 0; font-size:20px; font-weight:bold; color:#ffffff;">📅 인허가 방문 대상 알림</p>
<p style="margin:0; font-size:13px; color:#bdc3c7;">${today} 기준 방문이 필요한 사업장 리스트입니다.</p>
</td></tr>
<tr><td style="padding:30px; background-color:#ffffff;">
<p style="font-size:14px; color:#2c3e50; margin:0 0 20px 0;">${managerName}님, 안녕하십니까,<br>금일 기준 방문이 필요한 사업장 리스트를 송부드립니다.<br>방문 일정 조율에 참고하시기 바랍니다.</p>
${newSection}
${revisitSection}
</td></tr>
<tr><td bgcolor="#f8f9fa" style="background-color:#f8f9fa; padding:18px 30px; border-top:1px solid #dee2e6; text-align:center;">
<p style="margin:0 0 4px 0; font-size:12px; color:#868e96;">FS MISO | 자동 발송 시스템</p>
<p style="margin:0; font-size:11px; color:#adb5bd;">본 이메일은 FS MISO AI시스템에 의해 발송되었습니다.</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function buildOpenDetectedEmailHtml(managerName: string, items: AlertItem[]): string {
  const today = new Date().toLocaleDateString('ko-KR');

  const rows = items
    .map((t) => {
      const btnUrl = t.naverLink || `https://map.naver.com/v5/search/${encodeURIComponent(t.name)}`;
      return `<tr>
<td style="${TD} font-weight:bold; color:#2c3e50;">${t.name || '-'}</td>
<td style="${TD} text-align:center; white-space:nowrap;">${t.pyeong || '-'}평</td>
<td style="${TD} text-align:center; color:#868e96; white-space:nowrap;">${t.permitDate || '-'}</td>
<td style="${TD}">${t.address || '-'}</td>
<td style="${TD} text-align:center; white-space:nowrap;" align="center"><a href="${btnUrl}" style="background-color:#2b8a3e; color:#ffffff; padding:5px 12px; text-decoration:none; font-size:11px; font-weight:bold;">검색결과</a></td>
</tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="ko">
<head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background-color:#f8f9fa; font-family:'Malgun Gothic','맑은 고딕',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f8f9fa"><tr><td align="center" style="padding:20px 10px;">
<table width="900" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff; border:1px solid #dee2e6;">
<tr><td bgcolor="#2b8a3e" style="background-color:#2b8a3e; padding:25px 30px; border-bottom:3px solid #1e6e2e;">
<p style="margin:0 0 6px 0; font-size:20px; font-weight:bold; color:#ffffff;">🏭 공사중 거래처 오픈 감지</p>
<p style="margin:0; font-size:13px; color:#b2f2bb;">${today} 기준 네이버에 등록된 공사중 거래처입니다.</p>
</td></tr>
<tr><td style="padding:30px; background-color:#ffffff;">
<p style="font-size:14px; color:#2c3e50; margin:0 0 20px 0;">${managerName}님, 안녕하십니까,<br>담당 공사중 거래처 중 네이버 지도에 등록된 곳이 있습니다.<br>방문 후 업데이트 부탁드립니다.</p>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; margin:8px 0 24px 0; font-size:13px;">
<thead><tr>
<th style="${TH_LEFT}">사업장명</th>
<th style="${TH_CENTER}">평형</th>
<th style="${TH_CENTER}">인허가일</th>
<th style="${TH_LEFT}">주소</th>
<th style="${TH_CENTER}">확인</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>
<p style="font-size:12px; color:#868e96; margin:0;">※ 네이버 검색 기반 추정이므로 직접 방문 확인을 권장합니다.</p>
</td></tr>
<tr><td bgcolor="#f8f9fa" style="background-color:#f8f9fa; padding:18px 30px; border-top:1px solid #dee2e6; text-align:center;">
<p style="margin:0 0 4px 0; font-size:12px; color:#868e96;">FS MISO | 자동 발송 시스템</p>
<p style="margin:0; font-size:11px; color:#adb5bd;">본 이메일은 FS MISO AI시스템에 의해 발송되었습니다.</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
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

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const newTargets: AlertItem[] = [];
    const revisitTargets: AlertItem[] = [];
    const constructionAll: AlertItem[] = [];

    allLicenses.forEach((row: any) => {
      const p = String(row.priority || '').trim();
      const rank = p.replace(/[^0-9]/g, '');
      if (rank !== '1' && rank !== '2') return;

      const status = (row.trade_status || '').trim();

      if (status === '공사중' && !row.open_detected_at) {
        constructionAll.push({
          id: row.id,
          name: row.business_name || '',
          pyeong: row.area || '',
          permitDate: row.permit_date || '',
          address: row.road_address || '',
          status,
          manager: row.manager || '',
          business_unit: row.business_unit || '',
        });
      }

      if (!isMonday) return;

      const permitDateStr = row.permit_date;
      if (!permitDateStr) return;
      const permitDate = new Date(permitDateStr);
      if (isNaN(permitDate.getTime())) return;
      permitDate.setHours(0, 0, 0, 0);
      const daysDiff = Math.floor((today.getTime() - permitDate.getTime()) / (1000 * 60 * 60 * 24));

      const item: AlertItem = {
        id: row.id,
        name: row.business_name || '',
        pyeong: row.area || '',
        permitDate: permitDateStr,
        address: row.road_address || '',
        status,
        manager: row.manager || '',
        business_unit: row.business_unit || '',
      };

      if (daysDiff >= 14 && status === '인허가') {
        newTargets.push(item);
      } else if (daysDiff >= 28 && status === '공사중' && !row.open_detected_at) {
        revisitTargets.push(item);
      } else if (status === '공사중' && row.open_detected_at) {
        revisitTargets.push({
          ...item,
          openExpected: true,
          naverLink: `https://map.naver.com/v5/search/${encodeURIComponent(row.business_name || '')}`,
        });
      }
    });

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
        diagByUnit,
      });
    }

    if (!hasMonday && !hasDailyOpen) {
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
          const sendRes = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sender: { name: FROM_NAME, email: FROM_EMAIL },
              to: [{ email }],
              subject: `[인허가 알림] 신규 ${myNew.length}건 / 재확인 ${myRevisit.length}건`,
              htmlContent: html,
            }),
          });
          const sendData = await sendRes.json();
          results.push({
            type: 'monday',
            manager: managerName,
            bu,
            email,
            status: sendRes.ok ? 'sent' : 'failed',
            id: sendData.messageId || sendData.error || 'unknown',
          });
          await sleep(200);
        }

        for (const email of branchEmails) {
          const html = buildAlertEmailHtml('전체', { newObj: unitNew, revisitObj: unitRevisit }, false);
          const sendRes = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sender: { name: FROM_NAME, email: FROM_EMAIL },
              to: [{ email }],
              subject: `[인허가 알림] 신규 ${unitNew.length}건 / 재확인 ${unitRevisit.length}건 (${bu} 전체)`,
              htmlContent: html,
            }),
          });
          const sendData = await sendRes.json();
          results.push({
            type: 'monday',
            manager: '지점장',
            bu,
            email,
            status: sendRes.ok ? 'sent' : 'failed',
            id: sendData.messageId || sendData.error || 'unknown',
          });
          await sleep(200);
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
          const sendRes = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sender: { name: FROM_NAME, email: FROM_EMAIL },
              to: [{ email }],
              subject: `[오픈 감지] 공사중 거래처 ${managerItems.length}건 오픈 추정`,
              htmlContent: html,
            }),
          });
          const sendData = await sendRes.json();
          results.push({
            type: 'open-detected',
            manager: managerName,
            bu,
            email,
            status: sendRes.ok ? 'sent' : 'failed',
            id: sendData.messageId || sendData.error || 'unknown',
          });
          await sleep(200);
        }
      }
    }

    return NextResponse.json({
      success: true,
      isMonday,
      newTargets: newTargets.length,
      revisitTargets: revisitTargets.length,
      newlyDetected: newlyDetected.length,
      sent: results.filter((r) => r.status === 'sent').length,
      failed: results.filter((r) => r.status === 'failed').length,
      results,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
