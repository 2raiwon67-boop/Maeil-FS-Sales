// ============================================================
// 인허가 방문 대상 알림 (Vercel Cron Job)
// 매주 월요일 오전 9시 15분 KST (= 00:15 UTC) 자동 실행
// D+14: 인허가 상태 (순위 1, 2)
// D+28: 공사중 상태 (순위 1, 2)
// 환경변수: BREVO_API_KEY, BREVO_FROM_EMAIL,
//           SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================

export default async function handler(req, res) {
    // Vercel Cron 인증
    const authHeader = req.headers['authorization'];
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const BREVO_KEY    = process.env.BREVO_API_KEY;
    const FROM_EMAIL   = process.env.BREVO_FROM_EMAIL || '2raiwon67@gmail.com';
    const FROM_NAME    = 'FS MISO';

    if (!SUPABASE_URL || !SERVICE_KEY || !BREVO_KEY) {
        return res.status(500).json({ error: '환경변수 누락: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BREVO_API_KEY 확인' });
    }

    try {
        const sbHeaders = {
            'apikey': SERVICE_KEY,
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json'
        };

        // ── 1. 데이터 조회 ────────────────────────────────────
        const [licRes, mgrRes] = await Promise.all([
            fetch(`${SUPABASE_URL}/rest/v1/licenses?select=*`, { headers: sbHeaders }).then(r => r.json()),
            fetch(`${SUPABASE_URL}/rest/v1/managers?select=*`,  { headers: sbHeaders }).then(r => r.json())
        ]);

        const allLicenses = Array.isArray(licRes) ? licRes : [];
        const allManagers = Array.isArray(mgrRes) ? mgrRes : [];

        // ── 2. D+14 / D+28 필터링 ────────────────────────────
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const newTargets     = []; // D+14 이상 + 인허가 상태
        const revisitTargets = []; // D+28 이상 + 공사중 상태

        allLicenses.forEach(row => {
            // 순위 1, 2만 대상
            const p = String(row.priority || '').trim();
            if (p !== '1' && p !== '2') return;

            const permitDateStr = row.permit_date;
            if (!permitDateStr) return;

            const permitDate = new Date(permitDateStr);
            if (isNaN(permitDate.getTime())) return;
            permitDate.setHours(0, 0, 0, 0);

            const daysDiff = Math.floor((today - permitDate) / (1000 * 60 * 60 * 24));
            const status   = (row.trade_status || '').trim();

            const item = {
                name:          row.business_name || '',
                pyeong:        row.area          || '',
                permitDate:    permitDateStr,
                address:       row.road_address  || '',
                status,
                manager:       row.manager       || '',
                lat:           row.lat,
                lng:           row.lng,
                business_unit: row.business_unit || ''
            };

            if (daysDiff >= 14 && status === '인허가') {
                newTargets.push(item);
            } else if (daysDiff >= 28 && status === '공사중') {
                revisitTargets.push(item);
            }
        });

        if (newTargets.length === 0 && revisitTargets.length === 0) {
            return res.status(200).json({ success: true, message: '이메일 발송 대상 없음 (D+14, D+28 조건 만족 0건)' });
        }

        // ── 3. business_unit별 담당자 정보 그룹핑 ────────────
        // unitManagers[bu] = { emailMap: { name→email }, branchEmails: [] }
        const unitManagers = {};
        allManagers.forEach(m => {
            const name = (m.manager_name || '').trim();
            const email = (m.email       || '').trim();
            const region = (m.region     || '').trim();
            const bu = (m.business_unit  || '').trim();
            if (!name || !email || !bu) return;

            if (!unitManagers[bu]) unitManagers[bu] = { emailMap: {}, branchEmails: [] };

            if (m.is_branch_manager || region === '지점장' || region === '전체') {
                unitManagers[bu].branchEmails.push(email);
            } else {
                unitManagers[bu].emailMap[name] = email;
            }
        });

        // ── 4. business_unit별 발송 ───────────────────────────
        const results = [];
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));

        const allUnits = [...new Set([
            ...newTargets.map(t => t.business_unit),
            ...revisitTargets.map(t => t.business_unit)
        ])].filter(Boolean);

        for (const bu of allUnits) {
            const unitNew     = newTargets.filter(t => t.business_unit === bu);
            const unitRevisit = revisitTargets.filter(t => t.business_unit === bu);
            const { emailMap = {}, branchEmails = [] } = unitManagers[bu] || {};

            // 4-1. 일반 담당자: 본인 담당 건만
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
                const targets   = { newObj: myNew, revisitObj: myRevisit };
                const routeStops = optimizeRoute(targets);
                const html = buildAlertEmailHtml(managerName, targets, routeStops);

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
                results.push({
                    manager: managerName, bu, email,
                    status:  sendRes.ok ? 'sent' : 'failed',
                    new:     myNew.length, revisit: myRevisit.length,
                    id:      sendData.id || sendData.error
                });
                await sleep(600);
            }

            // 4-2. 지점장: 본인 지점 전체 건
            for (const email of branchEmails) {
                const targets    = { newObj: unitNew, revisitObj: unitRevisit };
                const routeStops = optimizeRoute(targets);
                const html = buildAlertEmailHtml('전체', targets, routeStops);

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
                results.push({
                    manager: '지점장', bu, email,
                    status:  sendRes.ok ? 'sent' : 'failed',
                    new:     unitNew.length, revisit: unitRevisit.length,
                    id:      sendData.id || sendData.error
                });
                await sleep(600);
            }
        }

        return res.status(200).json({
            success:        true,
            newTargets:     newTargets.length,
            revisitTargets: revisitTargets.length,
            sent:           results.filter(r => r.status === 'sent').length,
            failed:         results.filter(r => r.status === 'failed').length,
            results
        });

    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}

// ── Nearest Neighbor TSP 동선 최적화 (최대 5건) ─────────────
function calculateDistance(lat1, lng1, lat2, lng2) {
    if (!lat1 || !lng1 || !lat2 || !lng2) return 9999;
    const R    = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a    = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                 Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                 Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function optimizeRoute(targets) {
    const all = [...targets.newObj, ...targets.revisitObj];
    const valid = all.filter(t => {
        const lat = parseFloat(t.lat), lng = parseFloat(t.lng);
        return !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0;
    });
    if (valid.length === 0) return [];

    // 앵커: D+14(인허가) 우선, 없으면 첫 번째 유효 항목
    const anchor = valid.find(t => t.status === '인허가') || valid[0];
    anchor._routeDist = 0;

    const unvisited = valid.filter(t => t !== anchor).slice(0, 4); // 최대 4개 추가 = 총 5건
    const ordered   = [anchor];
    let   cur       = anchor;

    while (unvisited.length > 0) {
        let minDist = 9999, nearestIdx = -1;
        for (let j = 0; j < unvisited.length; j++) {
            const d = calculateDistance(
                parseFloat(cur.lat), parseFloat(cur.lng),
                parseFloat(unvisited[j].lat), parseFloat(unvisited[j].lng)
            );
            if (d < minDist) { minDist = d; nearestIdx = j; }
        }
        const nearest = unvisited.splice(nearestIdx, 1)[0];
        nearest._routeDist = minDist;
        ordered.push(nearest);
        cur = nearest;
    }
    return ordered;
}

// ── 네이버 지도 경로 URL ────────────────────────────────────
function buildNaverRouteUrl(routeStops) {
    if (!routeStops || routeStops.length === 0) return '';
    const enc  = encodeURIComponent;
    const dest = routeStops[routeStops.length - 1];

    if (routeStops.length === 1) {
        return `https://map.naver.com/p/directions/-/${parseFloat(dest.lng).toFixed(6)},${parseFloat(dest.lat).toFixed(6)},${enc(dest.name || '목적지')}/-/car`;
    }

    const waypoints = routeStops.slice(0, -1);
    let params = `dlat=${parseFloat(dest.lat).toFixed(6)}&dlng=${parseFloat(dest.lng).toFixed(6)}&dname=${enc(dest.name || '목적지')}`;
    waypoints.forEach((wp, i) => {
        params += `&v${i+1}lat=${parseFloat(wp.lat).toFixed(6)}&v${i+1}lng=${parseFloat(wp.lng).toFixed(6)}&v${i+1}name=${enc(wp.name || `경유지${i+1}`)}`;
    });
    return `nmap://route/car?${params}`;
}

// ── 이메일 HTML 생성 (Outlook 호환 테이블 기반 레이아웃) ────
function buildAlertEmailHtml(managerName, targets, routeStops) {
    const today = new Date().toLocaleDateString('ko-KR');

    const TH_CENTER = 'background-color:#f1f3f5; color:#495057; font-weight:bold; padding:10px 12px; text-align:center; border:1px solid #dee2e6; white-space:nowrap;';
    const TH_LEFT   = 'background-color:#f1f3f5; color:#495057; font-weight:bold; padding:10px 12px; text-align:left; border:1px solid #dee2e6; white-space:nowrap;';
    const TD        = 'padding:10px 12px; border:1px solid #e9ecef; color:#212529; vertical-align:middle;';

    const createRows = (list) => list.map(t => {
        const searchQuery = encodeURIComponent(`${t.name || ''} ${t.address || ''}`);
        const naverUrl    = `https://map.naver.com/v5/search/${searchQuery}`;
        const isConst     = t.status === '공사중';
        const bdgBg       = isConst ? '#fff3bf' : '#dbeafe';
        const bdgColor    = isConst ? '#b45309' : '#1a56db';
        return `<tr>
<td style="${TD} font-weight:bold; color:#2c3e50;">${t.name || '-'}</td>
<td style="${TD} text-align:center; white-space:nowrap;">${t.pyeong || '-'}&#xD3C9;</td>
<td style="${TD} text-align:center; color:#868e96; white-space:nowrap;">${t.permitDate || '-'}</td>
<td style="${TD} text-align:center; white-space:nowrap;" align="center"><span style="background-color:${bdgBg}; color:${bdgColor}; padding:3px 10px; font-size:11px; font-weight:bold; white-space:nowrap;">${t.status || '-'}</span></td>
<td style="${TD}">${t.address || '-'}</td>
<td style="${TD} text-align:center; white-space:nowrap; color:#555;">${t.manager || '-'}</td>
<td style="${TD} text-align:center; white-space:nowrap;" align="center"><a href="${naverUrl}" style="background-color:#03C75A; color:#ffffff; padding:5px 12px; text-decoration:none; font-size:11px; font-weight:bold;">N &#xC9C0;&#xB3C4;</a></td>
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

    // 동선 최적화 섹션
    let routeSection = '';
    if (routeStops.length > 0) {
        const totalDist = routeStops.reduce((sum, s) => sum + (s._routeDist || 0), 0);
        const naverUrl  = buildNaverRouteUrl(routeStops);

        const routeRows = routeStops.map((s, idx) => {
            const isConst  = s.status === '공사중';
            const bdgBg    = isConst ? '#fff3bf' : '#dbeafe';
            const bdgColor = isConst ? '#b45309' : '#1a56db';
            const distTxt  = idx === 0
                ? '<span style="color:#03C75A; font-weight:bold;">&#xCD9C;&#xBC1C;</span>'
                : `+ ${(s._routeDist || 0).toFixed(1)}km`;
            return `<tr>
<td style="${TD} text-align:center; font-weight:bold; color:#1a56db; width:36px;">${idx + 1}</td>
<td style="${TD} font-weight:600;">${s.name || '-'}</td>
<td style="${TD} text-align:center; white-space:nowrap;"><span style="background-color:${bdgBg}; color:${bdgColor}; padding:3px 10px; font-size:11px; font-weight:bold; white-space:nowrap;">${s.status || '-'}</span></td>
<td style="${TD} color:#555; font-size:12px;">${s.address || '-'}</td>
<td style="${TD} text-align:center; color:#868e96; font-size:12px; white-space:nowrap;">${distTxt}</td>
</tr>`;
        }).join('');

        const naverBtn = naverUrl
            ? `<a href="${naverUrl}" style="background-color:#03C75A; color:#ffffff; padding:7px 16px; text-decoration:none; font-size:12px; font-weight:bold;">&#128205; &#xB124;&#xC774;&#xBC84; &#xC9C0;&#xB3C4;&#xB85C; &#xC5F4;&#xAE30;</a>`
            : '';

        routeSection =
            sectionTitle('#2c3e50', '&#128506; &#xC624;&#xB298;&#xC758; &#xCD94;&#xCC9C; &#xB3D9;&#xC120; (' + routeStops.length + '&#xAC74;)') +
            '<p style="font-size:12px; color:#868e96; margin:0 0 8px 0;">&#xCCAB; &#xBC88;&#xC9F8; &#xB300;&#xC0C1; &#xAE30;&#xC900;&#xC73C;&#xB85C; &#xC774;&#xB3D9;&#xAC70;&#xB9AC;&#xB97C; &#xCD5C;&#xC18C;&#xD654;&#xD55C; &#xBC29;&#xBB38; &#xC21C;&#xC11C;&#xC785;&#xB2C8;&#xB2E4;. (&#xC9C1;&#xC120;&#xAC70;&#xB9AC; &#xAE30;&#xC900;, &#xCD5C;&#xB300; 5&#xAC74;)</p>' +
            `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; margin:8px 0 12px 0; font-size:13px;">
<thead><tr>
<th style="${TH_CENTER} width:36px;">&#xC21C;&#xC11C;</th>
<th style="${TH_LEFT}">&#xC0AC;&#xC5C5;&#xC7A5;&#xBA85;</th>
<th style="${TH_CENTER}">&#xC0C1;&#xD0DC;</th>
<th style="${TH_LEFT}">&#xC8FC;&#xC18C;</th>
<th style="${TH_CENTER}">&#xAD6C;&#xAC04;&#xAC70;&#xB9AC;</th>
</tr></thead>
<tbody>${routeRows}</tbody>
</table>` +
            `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
<tr>
<td style="padding:6px 0; font-size:12px; color:#555;">&#8251; &#xCD1D; &#xC608;&#xC0C1; &#xC774;&#xB3D9;&#xAC70;&#xB9AC; (&#xC9C1;&#xC120;): <strong>&#xC57D; ${totalDist.toFixed(1)}km</strong></td>
<td align="right">${naverBtn}</td>
</tr>
</table>`;
    }

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
    ${routeSection}
    ${newSection}
    ${revisitSection}
  </td>
</tr>
<tr>
  <td bgcolor="#f8f9fa" style="background-color:#f8f9fa; padding:18px 30px; border-top:1px solid #dee2e6; text-align:center;">
    <p style="margin:0 0 4px 0; font-size:12px; color:#868e96;">&#xACBD;&#xAE30;&#xBD81;&#xBD80; FS &#xC601;&#xC5C5;&#xD300; | &#xC790;&#xB3D9; &#xBC1C;&#xC1A1; &#xC2DC;&#xC2A4;&#xD15C;</p>
    <p style="margin:0; font-size:11px; color:#adb5bd;">&#xBCF8; &#xC774;&#xBA54;&#xC77C;&#xC740; FS MISO AI&#xC2DC;&#xC2A4;&#xD15C;&#xC5D0; &#xC758;&#xD574; &#xBC1C;&#xC1A1;&#xB418;&#xC5C8;&#xC2B5;&#xB2C8;&#xB2E4;.</p>
  </td>
</tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
