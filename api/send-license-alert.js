// ============================================================
// 인허가 방문 대상 알림 (Vercel Cron Job)
// 월~금 오전 9시 15분 KST (= 00:15 UTC) 매일 실행
// 월요일: D+14 인허가 + D+28 공사중 알림 + 오픈 감지
// 화~금:  공사중 오픈 감지만 (감지된 매장 있을 때만 담당자 이메일)
// 환경변수: BREVO_API_KEY, BREVO_FROM_EMAIL,
//           SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//           NAVER_CLIENT_ID, NAVER_CLIENT_SECRET
// ============================================================

export default async function handler(req, res) {
    // Vercel Cron 인증
    const authHeader = req.headers['authorization'];
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const SUPABASE_URL    = process.env.SUPABASE_URL;
    const SERVICE_KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const BREVO_KEY       = process.env.BREVO_API_KEY;
    const FROM_EMAIL      = process.env.BREVO_FROM_EMAIL || '2raiwon67@gmail.com';
    const FROM_NAME       = 'FS MISO';
    const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
    const NAVER_SECRET    = process.env.NAVER_CLIENT_SECRET;

    if (!SUPABASE_URL || !SERVICE_KEY || !BREVO_KEY) {
        return res.status(500).json({ error: '환경변수 누락: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BREVO_API_KEY 확인' });
    }

    const dryRun = req.query?.dryRun === 'true';

    // KST 기준 요일 (UTC+9)
    const nowKST   = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const isMonday = nowKST.getUTCDay() === 1;

    try {
        const sbHeaders = {
            'apikey': SERVICE_KEY,
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json'
        };

        // ── 1. 데이터 조회 ────────────────────────────────────
        const [licResult, mgrResult] = await Promise.allSettled([
            fetch(`${SUPABASE_URL}/rest/v1/licenses?select=*&limit=10000`, { headers: sbHeaders }).then(r => r.json()),
            fetch(`${SUPABASE_URL}/rest/v1/managers?select=*&limit=10000`,  { headers: sbHeaders }).then(r => r.json())
        ]);

        const allLicenses = licResult.status === 'fulfilled' && Array.isArray(licResult.value) ? licResult.value : [];
        const allManagers = mgrResult.status === 'fulfilled' && Array.isArray(mgrResult.value) ? mgrResult.value : [];

        if (licResult.status === 'rejected') console.error('licenses 조회 실패:', licResult.reason);
        if (mgrResult.status === 'rejected') console.error('managers 조회 실패:', mgrResult.reason);

        // ── 2. 필터링 ─────────────────────────────────────────
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const newTargets      = []; // D+14 이상 + 인허가 (월요일만)
        const revisitTargets  = []; // D+28 이상 + 공사중 (월요일만)
        const constructionAll = []; // 공사중 전체 (오픈감지용 — open_detected_at 없는 것만)

        allLicenses.forEach(row => {
            const p    = String(row.priority || '').trim();
            const rank = p.replace(/[^0-9]/g, '');
            if (rank !== '1' && rank !== '2') return;

            const status = (row.trade_status || '').trim();

            // 오픈 감지 대상: 공사중이고 아직 감지 안 된 것
            if (status === '공사중' && !row.open_detected_at) {
                constructionAll.push({
                    id:            row.id,
                    name:          row.business_name || '',
                    pyeong:        row.area          || '',
                    permitDate:    row.permit_date   || '',
                    address:       row.road_address  || '',
                    status,
                    manager:       row.manager       || '',
                    business_unit: row.business_unit || ''
                });
            }

            // 월요일 전용: D+14/D+28
            if (!isMonday) return;

            const permitDateStr = row.permit_date;
            if (!permitDateStr) return;
            const permitDate = new Date(permitDateStr);
            if (isNaN(permitDate.getTime())) return;
            permitDate.setHours(0, 0, 0, 0);
            const daysDiff = Math.floor((today - permitDate) / (1000 * 60 * 60 * 24));

            const item = {
                id:            row.id,
                name:          row.business_name || '',
                pyeong:        row.area          || '',
                permitDate:    permitDateStr,
                address:       row.road_address  || '',
                status,
                manager:       row.manager       || '',
                business_unit: row.business_unit || ''
            };

            if (daysDiff >= 14 && status === '인허가') {
                newTargets.push(item);
            } else if (daysDiff >= 28 && status === '공사중' && !row.open_detected_at) {
                revisitTargets.push(item);
            }
        });

        // ── 3. 네이버 검색으로 오픈 감지 ─────────────────────
        const newlyDetected = [];

        if (NAVER_CLIENT_ID && NAVER_SECRET && constructionAll.length > 0) {
            const naverSearch = async (item) => {
                try {
                    const query = encodeURIComponent(item.name);
                    const r = await fetch(
                        `https://openapi.naver.com/v1/search/local.json?query=${query}&display=3`,
                        { headers: { 'X-Naver-Client-Id': NAVER_CLIENT_ID, 'X-Naver-Client-Secret': NAVER_SECRET } }
                    );
                    if (!r.ok) return;
                    const data = await r.json();
                    const matched = (data.items || []).find(i => {
                        const title = i.title.replace(/<[^>]+>/g, '');
                        return title.includes(item.name) || item.name.includes(title);
                    });
                    if (matched) {
                        item.openExpected = true;
                        item.naverLink = matched.link || `https://map.naver.com/v5/search/${encodeURIComponent(item.name)}`;
                        newlyDetected.push(item);
                    }
                } catch (e) {
                    console.error('네이버 검색 오류:', item.name, e.message);
                }
            };

            for (let i = 0; i < constructionAll.length; i += 5) {
                await Promise.all(constructionAll.slice(i, i + 5).map(naverSearch));
                if (i + 5 < constructionAll.length) await new Promise(r => setTimeout(r, 300));
            }

            // 감지된 항목 open_detected_at DB 저장
            if (!dryRun && newlyDetected.length > 0) {
                await Promise.allSettled(newlyDetected.map(item =>
                    fetch(`${SUPABASE_URL}/rest/v1/licenses?id=eq.${item.id}`, {
                        method: 'PATCH',
                        headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
                        body: JSON.stringify({ open_detected_at: new Date().toISOString() })
                    })
                ));
            }

            // 월요일: revisitTargets에 openExpected 반영 후 위로 정렬
            if (isMonday && newlyDetected.length > 0) {
                const detectedIds = new Set(newlyDetected.map(i => i.id));
                revisitTargets.forEach(t => {
                    if (detectedIds.has(t.id)) {
                        t.openExpected = true;
                        t.naverLink = newlyDetected.find(i => i.id === t.id)?.naverLink || null;
                    }
                });
                revisitTargets.sort((a, b) => (b.openExpected ? 1 : 0) - (a.openExpected ? 1 : 0));
            }
        }

        // ── 4. 발송 대상 결정 ─────────────────────────────────
        const hasMonday    = isMonday && (newTargets.length > 0 || revisitTargets.length > 0);
        const hasDailyOpen = newlyDetected.length > 0;

        if (dryRun) {
            const diagByUnit = {};
            allLicenses.forEach(row => {
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
            return res.status(200).json({
                isMonday, newTargets: newTargets.length, revisitTargets: revisitTargets.length,
                constructionAll: constructionAll.length, newlyDetected: newlyDetected.length,
                diagByUnit
            });
        }

        if (!hasMonday && !hasDailyOpen) {
            return res.status(200).json({ success: true, message: '발송 대상 없음' });
        }

        // ── 5. 담당자 정보 그룹핑 ─────────────────────────────
        const unitManagers = {};
        allManagers.forEach(m => {
            const name    = (m.manager_name || '').trim();
            const email   = (m.email        || '').trim();
            const region2 = (m.region2      || '').trim();
            const bu      = (m.business_unit || '').trim();
            if (!name || !email || !bu) return;
            if (!unitManagers[bu]) unitManagers[bu] = { emailMap: {}, branchEmails: [] };
            if (m.is_branch_manager || region2 === '지점장' || region2 === '전체') {
                unitManagers[bu].branchEmails.push(email);
            } else {
                unitManagers[bu].emailMap[name] = email;
            }
        });

        const results = [];
        const sleep   = ms => new Promise(r => setTimeout(r, ms));

        // ── 6-A. 월요일: 인허가 알림 발송 ────────────────────
        if (hasMonday) {
            const allUnits = [...new Set([
                ...newTargets.map(t => t.business_unit),
                ...revisitTargets.map(t => t.business_unit)
            ])].filter(Boolean);

            for (const bu of allUnits) {
                const unitNew     = newTargets.filter(t => t.business_unit === bu);
                const unitRevisit = revisitTargets.filter(t => t.business_unit === bu);
                const { emailMap = {}, branchEmails = [] } = unitManagers[bu] || {};

                // 일반 담당자: 본인 담당 건만
                const activeManagers = new Set([
                    ...unitNew.map(t => t.manager),
                    ...unitRevisit.map(t => t.manager)
                ]);

                for (const managerName of activeManagers) {
                    if (!managerName || managerName === '미지정') continue;
                    const email = emailMap[managerName];
                    if (!email) continue;
                    const myNew     = unitNew.filter(t => t.manager === managerName);
                    const myRevisit = unitRevisit.filter(t => t.manager === managerName);
                    const html = buildAlertEmailHtml(managerName, { newObj: myNew, revisitObj: myRevisit }, true);
                    const sendRes = await fetch('https://api.brevo.com/v3/smtp/email', {
                        method: 'POST',
                        headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            sender:      { name: FROM_NAME, email: FROM_EMAIL },
                            to:          [{ email }],
                            subject:     `[인허가 알림] 신규 ${myNew.length}건 / 재확인 ${myRevisit.length}건`,
                            htmlContent: html
                        })
                    });
                    const sendData = await sendRes.json();
                    results.push({ type: 'monday', manager: managerName, bu, email, status: sendRes.ok ? 'sent' : 'failed', id: sendData.messageId || sendData.error || 'unknown' });
                    await sleep(200);
                }

                // 지점장: 전체 건 (오픈예상 표시 없음)
                for (const email of branchEmails) {
                    const html = buildAlertEmailHtml('전체', { newObj: unitNew, revisitObj: unitRevisit }, false);
                    const sendRes = await fetch('https://api.brevo.com/v3/smtp/email', {
                        method: 'POST',
                        headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            sender:      { name: FROM_NAME, email: FROM_EMAIL },
                            to:          [{ email }],
                            subject:     `[인허가 알림] 신규 ${unitNew.length}건 / 재확인 ${unitRevisit.length}건 (${bu} 전체)`,
                            htmlContent: html
                        })
                    });
                    const sendData = await sendRes.json();
                    results.push({ type: 'monday', manager: '지점장', bu, email, status: sendRes.ok ? 'sent' : 'failed', id: sendData.messageId || sendData.error || 'unknown' });
                    await sleep(200);
                }
            }
        }

        // ── 6-B. 화~금: 오픈 감지 알림 (담당자만) ───────────
        if (hasDailyOpen) {
            // 월요일에는 위 이메일(revisitTargets)에 이미 포함된 항목 제외
            const revisitIds = new Set(revisitTargets.map(t => t.id));
            const toNotify   = isMonday
                ? newlyDetected.filter(item => !revisitIds.has(item.id))
                : newlyDetected;

            const openUnits = [...new Set(toNotify.map(t => t.business_unit))].filter(Boolean);
            for (const bu of openUnits) {
                const unitItems      = toNotify.filter(t => t.business_unit === bu);
                const { emailMap = {} } = unitManagers[bu] || {};
                const activeManagers = new Set(unitItems.map(t => t.manager));
                for (const managerName of activeManagers) {
                    if (!managerName || managerName === '미지정') continue;
                    const email = emailMap[managerName];
                    if (!email) continue;
                    const managerItems = unitItems.filter(t => t.manager === managerName);
                    const html = buildOpenDetectedEmailHtml(managerName, managerItems);
                    const sendRes = await fetch('https://api.brevo.com/v3/smtp/email', {
                        method: 'POST',
                        headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            sender:      { name: FROM_NAME, email: FROM_EMAIL },
                            to:          [{ email }],
                            subject:     `[오픈 감지] 공사중 거래처 ${managerItems.length}건 오픈 추정`,
                            htmlContent: html
                        })
                    });
                    const sendData = await sendRes.json();
                    results.push({ type: 'open-detected', manager: managerName, bu, email, status: sendRes.ok ? 'sent' : 'failed', id: sendData.messageId || sendData.error || 'unknown' });
                    await sleep(200);
                }
            }
        }

        return res.status(200).json({
            success:        true,
            isMonday,
            newTargets:     newTargets.length,
            revisitTargets: revisitTargets.length,
            newlyDetected:  newlyDetected.length,
            sent:           results.filter(r => r.status === 'sent').length,
            failed:         results.filter(r => r.status === 'failed').length,
            results
        });

    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}

// ── 이메일 공통 스타일 ────────────────────────────────────────
const TH_CENTER = 'background-color:#f1f3f5; color:#495057; font-weight:bold; padding:10px 12px; text-align:center; border:1px solid #dee2e6; white-space:nowrap;';
const TH_LEFT   = 'background-color:#f1f3f5; color:#495057; font-weight:bold; padding:10px 12px; text-align:left; border:1px solid #dee2e6; white-space:nowrap;';
const TD        = 'padding:10px 12px; border:1px solid #e9ecef; color:#212529; vertical-align:middle;';

// ── 월요일 인허가 알림 이메일 HTML ──────────────────────────
function buildAlertEmailHtml(managerName, targets, isManager = false) {
    const today = new Date().toLocaleDateString('ko-KR');

    const createRows = (list) => list.map(t => {
        const searchQuery = encodeURIComponent(`${t.name || ''} ${t.address || ''}`);
        const naverUrl    = `https://map.naver.com/v5/search/${searchQuery}`;
        const showOpen    = isManager && t.openExpected;
        const bdgBg       = showOpen ? '#d3f9d8' : (t.status === '공사중' ? '#fff3bf' : '#dbeafe');
        const bdgColor    = showOpen ? '#2b8a3e' : (t.status === '공사중' ? '#b45309' : '#1a56db');
        const badgeLabel  = showOpen ? '&#xC624;&#xD508;&#xC608;&#xC0C1;' : (t.status || '-');
        const btnUrl      = showOpen && t.naverLink ? t.naverLink : naverUrl;
        const btnLabel    = showOpen ? '&#xAC80;&#xC0C9;&#xACB0;&#xACFC;' : 'N &#xC9C0;&#xB3C4;';
        const btnBg       = showOpen ? '#2b8a3e' : '#03C75A';
        return `<tr>
<td style="${TD} font-weight:bold; color:#2c3e50;">${t.name || '-'}</td>
<td style="${TD} text-align:center; white-space:nowrap;">${t.pyeong || '-'}&#xD3C9;</td>
<td style="${TD} text-align:center; color:#868e96; white-space:nowrap;">${t.permitDate || '-'}</td>
<td style="${TD} text-align:center; white-space:nowrap;" align="center"><span style="background-color:${bdgBg}; color:${bdgColor}; padding:3px 10px; font-size:11px; font-weight:bold; white-space:nowrap;">${badgeLabel}</span></td>
<td style="${TD}">${t.address || '-'}</td>
<td style="${TD} text-align:center; white-space:nowrap; color:#555;">${t.manager || '-'}</td>
<td style="${TD} text-align:center; white-space:nowrap;" align="center"><a href="${btnUrl}" style="background-color:${btnBg}; color:#ffffff; padding:5px 12px; text-decoration:none; font-size:11px; font-weight:bold;">${btnLabel}</a></td>
</tr>`;
    }).join('');

    const tableWrap = (rows) =>
        `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; margin:8px 0 24px 0; font-size:13px;">
<thead><tr>
<th style="${TH_LEFT}">&#xC0AC;&#xC5C5;&#xC7A5;&#xBA85;</th>
<th style="${TH_CENTER}">&#xD3C9;&#xD615;</th>
<th style="${TH_CENTER}">&#xC778;&#xD5C8;&#xAC00;&#xC77C;</th>
<th style="${TH_CENTER}">&#xC0C1;&#xD0DC;</th>
<th style="${TH_LEFT}">&#xC8FC;&#xC18C;</th>
<th style="${TH_CENTER}">&#xB2F4;&#xB2F9;&#xC790;</th>
<th style="${TH_CENTER}">&#xC704;&#xCE58;</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>`;

    const sectionTitle = (color, text) =>
        `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 6px 0; border-bottom:2px solid ${color};">
<tr><td style="padding-bottom:6px; font-size:15px; font-weight:bold; color:${color};">${text}</td></tr>
</table>`;

    const newSection = targets.newObj.length > 0
        ? sectionTitle('#1c7ed6', '&#128640; 1. &#xC2E0;&#xADDC; &#xB4F1;&#xB85D; &#xB300;&#xC0C1; (D+14)') +
          '<p style="font-size:12px; color:#868e96; margin:0 0 8px 0;">&#xC778;&#xD5C8;&#xAC00; &#xB4F1;&#xB85D; &#xD6C4; 14&#xC77C;&#xC774; &#xACBD;&#xACFC;&#xD55C; &#xC0AC;&#xC5C5;&#xC7A5; &#xBAA9;&#xB85D;&#xC785;&#xB2C8;&#xB2E4;.</p>' +
          tableWrap(createRows(targets.newObj)) +
          `<p style="font-size:12px; color:#868e96; margin:0 0 10px 0;">&#8251; &#xCD1D; ${targets.newObj.length}&#xAC74;&#xC758; &#xB300;&#xC0C1;&#xC774; &#xD655;&#xC778;&#xB418;&#xC5C8;&#xC2B5;&#xB2C8;&#xB2E4;.</p>`
        : '<p style="color:#868e96; margin:16px 0;">(&#xAE08;&#xC77C; &#xC2E0;&#xADDC; &#xB300;&#xC0C1; &#xC5C6;&#xC74C;)</p>';

    const revisitSection = targets.revisitObj.length > 0
        ? sectionTitle('#f08c00', '&#128296; 2. &#xACF5;&#xC0AC; / &#xC7AC;&#xD655;&#xC778; &#xB300;&#xC0C1; (D+28)') +
          '<p style="font-size:12px; color:#868e96; margin:0 0 8px 0;">&#xACF5;&#xC0AC;&#xC911; &#xC0C1;&#xD0DC;&#xB85C; 28&#xC77C; &#xC774;&#xC0C1; &#xACBD;&#xACFC;&#xD55C; &#xC0AC;&#xC5C5;&#xC7A5; &#xBAA9;&#xB85D;&#xC785;&#xB2C8;&#xB2E4;.</p>' +
          tableWrap(createRows(targets.revisitObj)) +
          `<p style="font-size:12px; color:#868e96; margin:0 0 10px 0;">&#8251; &#xCD1D; ${targets.revisitObj.length}&#xAC74;&#xC758; &#xB300;&#xC0C1;&#xC774; &#xD655;&#xC778;&#xB418;&#xC5C8;&#xC2B5;&#xB2C8;&#xB2E4;.</p>`
        : '<p style="color:#868e96; margin:16px 0;">(&#xAE08;&#xC77C; &#xC7AC;&#xD655;&#xC778; &#xB300;&#xC0C1; &#xC5C6;&#xC74C;)</p>';

    return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:0; background-color:#f8f9fa; font-family:'Malgun Gothic','맑은 고딕',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f8f9fa" style="background-color:#f8f9fa;">
<tr><td align="center" style="padding:20px 10px;">
<table width="900" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff; border:1px solid #dee2e6;">
<tr>
  <td bgcolor="#2c3e50" style="background-color:#2c3e50; padding:25px 30px; border-bottom:3px solid #34495e;">
    <p style="margin:0 0 6px 0; font-size:20px; font-weight:bold; color:#ffffff;">&#128197; &#xC778;&#xD5C8;&#xAC00; &#xBC29;&#xBB38; &#xB300;&#xC0C1; &#xC54C;&#xB9BC;</p>
    <p style="margin:0; font-size:13px; color:#bdc3c7;">${today} &#xAE30;&#xC900; &#xBC29;&#xBB38;&#xC774; &#xD544;&#xC694;&#xD55C; &#xC0AC;&#xC5C5;&#xC7A5; &#xB9AC;&#xC2A4;&#xD2B8;&#xC785;&#xB2C8;&#xB2E4;.</p>
  </td>
</tr>
<tr>
  <td style="padding:30px; background-color:#ffffff;">
    <p style="font-size:14px; color:#2c3e50; margin:0 0 20px 0;">${managerName}&#xB2D8;, &#xC548;&#xB155;&#xD558;&#xC2ED;&#xB2C8;&#xAE4C;,<br>&#xAE08;&#xC77C; &#xAE30;&#xC900; &#xBC29;&#xBB38;&#xC774; &#xD544;&#xC694;&#xD55C; &#xC0AC;&#xC5C5;&#xC7A5; &#xB9AC;&#xC2A4;&#xD2B8;&#xB97C; &#xC1A1;&#xBD80;&#xB4DC;&#xB9BD;&#xB2C8;&#xB2E4;.<br>&#xBC29;&#xBB38; &#xC77C;&#xC815; &#xC870;&#xC728;&#xC5D0; &#xCC38;&#xACE0;&#xD558;&#xC2DC;&#xAE30; &#xBC14;&#xB78D;&#xB2C8;&#xB2E4;.</p>
    ${newSection}
    ${revisitSection}
  </td>
</tr>
<tr>
  <td bgcolor="#f8f9fa" style="background-color:#f8f9fa; padding:18px 30px; border-top:1px solid #dee2e6; text-align:center;">
    <p style="margin:0 0 4px 0; font-size:12px; color:#868e96;">FS MISO | &#xC790;&#xB3D9; &#xBC1C;&#xC1A1; &#xC2DC;&#xC2A4;&#xD15C;</p>
    <p style="margin:0; font-size:11px; color:#adb5bd;">&#xBCF8; &#xC774;&#xBA54;&#xC77C;&#xC740; FS MISO AI&#xC2DC;&#xC2A4;&#xD15C;&#xC5D0; &#xC758;&#xD574; &#xBC1C;&#xC1A1;&#xB418;&#xC5C8;&#xC2B5;&#xB2C8;&#xB2E4;.</p>
  </td>
</tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// ── 화~금 오픈 감지 알림 이메일 HTML ────────────────────────
function buildOpenDetectedEmailHtml(managerName, items) {
    const today = new Date().toLocaleDateString('ko-KR');

    const rows = items.map(t => {
        const btnUrl = t.naverLink || `https://map.naver.com/v5/search/${encodeURIComponent(t.name)}`;
        return `<tr>
<td style="${TD} font-weight:bold; color:#2c3e50;">${t.name || '-'}</td>
<td style="${TD} text-align:center; white-space:nowrap;">${t.pyeong || '-'}&#xD3C9;</td>
<td style="${TD} text-align:center; color:#868e96; white-space:nowrap;">${t.permitDate || '-'}</td>
<td style="${TD}">${t.address || '-'}</td>
<td style="${TD} text-align:center; white-space:nowrap;" align="center"><a href="${btnUrl}" style="background-color:#2b8a3e; color:#ffffff; padding:5px 12px; text-decoration:none; font-size:11px; font-weight:bold;">&#xAC80;&#xC0C9;&#xACB0;&#xACFC;</a></td>
</tr>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:0; background-color:#f8f9fa; font-family:'Malgun Gothic','맑은 고딕',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f8f9fa" style="background-color:#f8f9fa;">
<tr><td align="center" style="padding:20px 10px;">
<table width="900" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff; border:1px solid #dee2e6;">
<tr>
  <td bgcolor="#2b8a3e" style="background-color:#2b8a3e; padding:25px 30px; border-bottom:3px solid #1e6e2e;">
    <p style="margin:0 0 6px 0; font-size:20px; font-weight:bold; color:#ffffff;">&#127981; &#xACF5;&#xC0AC;&#xC911; &#xAC70;&#xB798;&#xCC98; &#xC624;&#xD508; &#xAC10;&#xC9C0;</p>
    <p style="margin:0; font-size:13px; color:#b2f2bb;">${today} &#xAE30;&#xC900; &#xB124;&#xC774;&#xBC84;&#xC5D0; &#xB4F1;&#xB85D;&#xB41C; &#xACF5;&#xC0AC;&#xC911; &#xAC70;&#xB798;&#xCC98;&#xC785;&#xB2C8;&#xB2E4;.</p>
  </td>
</tr>
<tr>
  <td style="padding:30px; background-color:#ffffff;">
    <p style="font-size:14px; color:#2c3e50; margin:0 0 20px 0;">${managerName}&#xB2D8;, &#xC548;&#xB155;&#xD558;&#xC2ED;&#xB2C8;&#xAE4C;,<br>&#xB2F4;&#xB2F9; &#xACF5;&#xC0AC;&#xC911; &#xAC70;&#xB798;&#xCC98; &#xC911; &#xB124;&#xC774;&#xBC84; &#xC9C0;&#xB3C4;&#xC5D0; &#xB4F1;&#xB85D;&#xB41C; &#xACF3;&#xC774; &#xC788;&#xC2B5;&#xB2C8;&#xB2E4;.<br>&#xBC29;&#xBB38; &#xD6C4; &#xC5C5;&#xB370;&#xC774;&#xD2B8; &#xBD80;&#xD0C1;&#xB4DC;&#xB9BD;&#xB2C8;&#xB2E4;.</p>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; margin:8px 0 24px 0; font-size:13px;">
    <thead><tr>
    <th style="${TH_LEFT}">&#xC0AC;&#xC5C5;&#xC7A5;&#xBA85;</th>
    <th style="${TH_CENTER}">&#xD3C9;&#xD615;</th>
    <th style="${TH_CENTER}">&#xC778;&#xD5C8;&#xAC00;&#xC77C;</th>
    <th style="${TH_LEFT}">&#xC8FC;&#xC18C;</th>
    <th style="${TH_CENTER}">&#xD655;&#xC778;</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    </table>
    <p style="font-size:12px; color:#868e96; margin:0;">&#8251; &#xB124;&#xC774;&#xBC84; &#xAC80;&#xC0C9; &#xAE30;&#xBC18; &#xCD94;&#xC815;&#xC774;&#xBBC0;&#xB85C; &#xC9C1;&#xC811; &#xBC29;&#xBB38; &#xD655;&#xC778;&#xC744; &#xAD8C;&#xC7A5;&#xD569;&#xB2C8;&#xB2E4;.</p>
  </td>
</tr>
<tr>
  <td bgcolor="#f8f9fa" style="background-color:#f8f9fa; padding:18px 30px; border-top:1px solid #dee2e6; text-align:center;">
    <p style="margin:0 0 4px 0; font-size:12px; color:#868e96;">FS MISO | &#xC790;&#xB3D9; &#xBC1C;&#xC1A1; &#xC2DC;&#xC2A4;&#xD15C;</p>
    <p style="margin:0; font-size:11px; color:#adb5bd;">&#xBCF8; &#xC774;&#xBA54;&#xC77C;&#xC740; FS MISO AI&#xC2DC;&#xC2A4;&#xD15C;&#xC5D0; &#xC758;&#xD574; &#xBC1C;&#xC1A1;&#xB418;&#xC5C8;&#xC2B5;&#xB2C8;&#xB2E4;.</p>
  </td>
</tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
