// ============================================================
// 월별 보고서 자동 발송 (Vercel Cron Job)
// 매월 3일 오전 9시 KST(= 0시 UTC) 자동 실행
// 환경변수: RESEND_API_KEY, RESEND_FROM_EMAIL,
//           SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================

const SHEETS_ID = '1JnLQVr3JGqZPyvQ6bf8TSl0dNN6_oI05YH7d9zSgsKI';
const SHEETS = {
    visitLogs: '707066983',
    accounts:  '43116531',
    licenses:  '0'
};

export default async function handler(req, res) {
    // Vercel Cron 인증 (자동 실행 시 헤더 검증)
    const authHeader = req.headers['authorization'];
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const RESEND_KEY   = process.env.RESEND_API_KEY;
    const FROM_EMAIL   = process.env.RESEND_FROM_EMAIL || 'FS MISO <onboarding@resend.dev>';

    if (!SUPABASE_URL || !SERVICE_KEY || !RESEND_KEY) {
        return res.status(500).json({ error: '환경변수 누락: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY 확인' });
    }

    try {
        // ── 1. 승인된 사용자 목록 ─────────────────────────────
        const usersRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, {
            headers: {
                'apikey': SERVICE_KEY,
                'Authorization': `Bearer ${SERVICE_KEY}`
            }
        });
        const usersData = await usersRes.json();
        const approvedUsers = (usersData.users || []).filter(u =>
            u.user_metadata?.approved !== false &&
            u.email &&
            u.user_metadata?.full_name
        );

        if (approvedUsers.length === 0) {
            return res.status(200).json({ success: true, message: '발송할 사용자 없음' });
        }

        // ── 2. Google Sheets 데이터 ───────────────────────────
        const sheetUrl = (gid) =>
            `https://docs.google.com/spreadsheets/d/${SHEETS_ID}/export?format=csv&gid=${gid}`;

        const [visitText, accountText, licenseText] = await Promise.all([
            fetch(sheetUrl(SHEETS.visitLogs)).then(r => r.text()),
            fetch(sheetUrl(SHEETS.accounts)).then(r => r.text()),
            fetch(sheetUrl(SHEETS.licenses)).then(r => r.text())
        ]);

        const allVisitLogs = parseCSV(visitText).filter(r => r['작성자']?.trim());
        const allAccounts  = parseCSV(accountText).filter(r =>
            (r['거래처명'] || r['매장명'] || r['사업장명'] || r['상호'])?.trim()
        );
        const allLicenses  = parseCSV(licenseText).filter(r =>
            (r['사업장명'] || r['업소명'] || r['상호명'] || r['거래처명'])?.trim()
        );

        // ── 3. 이전 달 계산 ───────────────────────────────────
        const now      = new Date();
        const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const year     = prevDate.getFullYear();
        const month    = prevDate.getMonth() + 1;
        const monthLabel = `${year}년 ${month}월`;

        // ── 4. 거래처 맵 생성 ─────────────────────────────────
        const accountMap = new Map(
            allAccounts.map(a => [
                normalize(a['거래처명'] || a['매장명'] || a['사업장명'] || a['상호']),
                { status: a['거래상태'] || '', type: 'major' }
            ])
        );
        const licenseMap = new Map(
            allLicenses.map(l => [
                normalize(l['사업장명'] || l['업소명'] || l['상호명'] || l['거래처명']),
                { status: l['거래여부(기입예정)'] || l['거래여부'] || l['진행상태'] || l['거래상태'] || '', type: 'license' }
            ])
        );

        // 공사중 거래처 전체 맵
        const constructionMap = new Map();
        [...allAccounts, ...allLicenses].forEach(a => {
            const name = a['거래처명'] || a['매장명'] || a['사업장명'] || a['상호'] || a['업소명'] || a['상호명'] || '';
            const s    = a['거래상태'] || a['거래여부(기입예정)'] || a['거래여부'] || a['진행상태'] || '';
            if (name.trim() && s.trim() === '공사중') {
                constructionMap.set(normalize(name), name.trim());
            }
        });

        // ── 5. 담당자별 보고서 생성 및 이메일 발송 ───────────
        const results = [];

        for (const user of approvedUsers) {
            const managerName = user.user_metadata.full_name;

            // 이달 해당 담당자 방문 로그
            const monthLogs = allVisitLogs.filter(log => {
                if (normalize(log['작성자']) !== normalize(managerName)) return false;
                const d = parseKorDate(log['작성일'] || log['일정기간'] || '');
                return d && d.getFullYear() === year && d.getMonth() + 1 === month;
            });

            if (monthLogs.length === 0) continue; // 활동 없으면 발송 안 함

            // 거래처별 그룹화
            const grouped = {};
            monthLogs.forEach(log => {
                const rawName = (log['방문처(거래처)'] || '미지정').trim();
                const key = normalize(rawName);
                let type = 'other', status = '';
                if (accountMap.has(key))      { type = 'major';   status = accountMap.get(key).status; }
                else if (licenseMap.has(key)) { type = 'license'; status = licenseMap.get(key).status; }
                else                          { status = log['거래상태'] || ''; }

                if (!grouped[rawName]) {
                    grouped[rawName] = { name: rawName, type, status: status.trim(), visits: [] };
                }
                grouped[rawName].visits.push({
                    date:    log['작성일'] || log['일정기간'] || '-',
                    issue:   log['주요이슈'] || '',
                    content: log['내용'] || ''
                });
            });

            const accounts = Object.values(grouped);

            // 공사중 방문
            const constructionVisited = accounts.filter(a => a.status === '공사중');

            // 공사중 미방문
            const myEverVisited = new Set(
                allVisitLogs
                    .filter(l => normalize(l['작성자']) === normalize(managerName))
                    .map(l => normalize((l['방문처(거래처)'] || '').trim()))
            );
            const visitedThisMonth = new Set(accounts.map(a => normalize(a.name)));
            const noVisitConstruction = [...constructionMap.entries()]
                .filter(([key]) => myEverVisited.has(key) && !visitedThisMonth.has(key))
                .map(([, name]) => name);

            // 주요거래처
            const majorAccounts = accounts.filter(a => a.type === 'major');

            const reportData = {
                managerName, monthLabel,
                totalVisits: monthLogs.length,
                totalAccounts: accounts.length,
                constructionVisited,
                noVisitConstruction,
                majorAccounts
            };

            const html = buildEmailHtml(reportData);

            const sendRes = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${RESEND_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    from: FROM_EMAIL,
                    to:   [user.email],
                    subject: `[FS MISO] ${managerName}님의 ${monthLabel} 활동 보고서`,
                    html
                })
            });

            const sendData = await sendRes.json();
            results.push({
                manager: managerName,
                email:   user.email,
                status:  sendRes.ok ? 'sent' : 'failed',
                id:      sendData.id || sendData.error
            });
        }

        return res.status(200).json({
            success: true,
            period:  monthLabel,
            sent:    results.filter(r => r.status === 'sent').length,
            failed:  results.filter(r => r.status === 'failed').length,
            results
        });

    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}

// ── CSV 파싱 ────────────────────────────────────────────────
function parseCSV(text) {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];
    const headers = parseCSVLine(lines[0]);
    return lines.slice(1).map(line => {
        const values = parseCSVLine(line);
        const obj = {};
        headers.forEach((h, i) => { obj[h.trim()] = (values[i] || '').trim(); });
        return obj;
    });
}

function parseCSVLine(line) {
    const result = [];
    let cur = '', inQuote = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
            if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
            else inQuote = !inQuote;
        } else if (c === ',' && !inQuote) {
            result.push(cur); cur = '';
        } else cur += c;
    }
    result.push(cur);
    return result;
}

function normalize(str) {
    return (str || '').toLowerCase().replace(/\s+/g, '').replace(/[^\w가-힣]/g, '');
}

function parseKorDate(str) {
    if (!str) return null;
    const m = str.match(/(\d{4})[./\-년\s]*(\d{1,2})[./\-월\s]*(\d{1,2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    const m2 = str.match(/(\d{2})[./\-년\s]*(\d{1,2})[./\-월\s]*(\d{1,2})/);
    if (m2) return new Date(2000 + +m2[1], +m2[2] - 1, +m2[3]);
    return null;
}

// ── 이메일 HTML 템플릿 ──────────────────────────────────────
function buildEmailHtml({ managerName, monthLabel, totalVisits, totalAccounts,
                           constructionVisited, noVisitConstruction, majorAccounts }) {

    const today = new Date().toLocaleDateString('ko-KR');

    const sectionConstruction = constructionVisited.length > 0 ? `
        <div class="section">
            <div class="section-title">🚧 공사중 거래처 방문 (${constructionVisited.length}건)</div>
            ${constructionVisited.map(a => `
                <div class="account-card">
                    <div class="account-name">${a.name}</div>
                    ${a.visits.slice(0, 2).map(v => `
                        <div class="visit-row">
                            <span class="visit-date">${v.date}</span>
                            ${v.issue ? `<span class="visit-issue">${v.issue}</span>` : ''}
                            ${v.content ? `<div class="visit-content">${v.content.slice(0, 60)}${v.content.length > 60 ? '…' : ''}</div>` : ''}
                        </div>`).join('')}
                    ${a.visits.length > 2 ? `<div class="more">+ ${a.visits.length - 2}건 더</div>` : ''}
                </div>`).join('')}
        </div>` : '';

    const sectionNoVisit = noVisitConstruction.length > 0 ? `
        <div class="section warning">
            <div class="section-title">⚠️ 이달 미방문 공사중 거래처 (${noVisitConstruction.length}곳)</div>
            <div class="tag-list">
                ${noVisitConstruction.map(n => `<span class="tag">${n}</span>`).join('')}
            </div>
            <p class="warn-note">위 거래처는 공사중 상태이나 이달 방문 기록이 없습니다.</p>
        </div>` : '';

    const sectionMajor = majorAccounts.length > 0 ? `
        <div class="section">
            <div class="section-title">⭐ 주요거래처 활동 (${majorAccounts.length}곳)</div>
            ${majorAccounts.map(a => `
                <div class="account-card">
                    <div class="account-name">${a.name}</div>
                    ${a.visits.slice(0, 2).map(v => `
                        <div class="visit-row">
                            <span class="visit-date">${v.date}</span>
                            ${v.issue ? `<span class="visit-issue">${v.issue}</span>` : ''}
                        </div>`).join('')}
                    ${a.visits.length > 2 ? `<div class="more">+ ${a.visits.length - 2}건 더</div>` : ''}
                </div>`).join('')}
        </div>` : '';

    return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${monthLabel} 활동 보고서</title>
<style>
  body { margin:0; padding:0; background:#f5f5f7; font-family:'Apple SD Gothic Neo',Arial,sans-serif; color:#1d1d1f; }
  .wrap { max-width:600px; margin:0 auto; padding:24px 16px; }
  .header { background:#1d1d1f; border-radius:16px 16px 0 0; padding:28px 32px; }
  .header-logo { color:#a1a1a6; font-size:12px; font-weight:600; letter-spacing:0.08em; margin-bottom:8px; }
  .header-title { color:#fff; font-size:22px; font-weight:700; }
  .header-sub { color:#a1a1a6; font-size:13px; margin-top:4px; }
  .body { background:#fff; padding:24px 32px; }
  .greeting { font-size:15px; margin-bottom:20px; line-height:1.6; color:#3a3a3c; }
  .stats { display:flex; gap:12px; margin-bottom:24px; }
  .stat { flex:1; background:#f5f5f7; border-radius:10px; padding:14px; text-align:center; }
  .stat-num { font-size:24px; font-weight:700; color:#0071e3; }
  .stat-label { font-size:11px; color:#86868b; margin-top:2px; }
  .section { margin-bottom:20px; border:1px solid #e5e5ea; border-radius:12px; overflow:hidden; }
  .section.warning { border-color:#ffd60a; }
  .section-title { background:#f5f5f7; padding:12px 16px; font-size:13px; font-weight:700; color:#1d1d1f; }
  .section.warning .section-title { background:#fffbea; }
  .account-card { padding:12px 16px; border-top:1px solid #f0f0f5; }
  .account-name { font-size:14px; font-weight:600; margin-bottom:6px; }
  .visit-row { display:flex; align-items:center; gap:8px; margin-bottom:4px; }
  .visit-date { font-size:11px; color:#86868b; white-space:nowrap; }
  .visit-issue { background:#e8f0fe; color:#1a73e8; font-size:11px; padding:2px 7px; border-radius:10px; }
  .visit-content { font-size:12px; color:#6e6e73; margin-top:2px; }
  .more { font-size:11px; color:#0071e3; margin-top:4px; }
  .tag-list { padding:12px 16px; display:flex; flex-wrap:wrap; gap:6px; }
  .tag { background:#fff3cd; color:#856404; font-size:12px; padding:3px 10px; border-radius:20px; }
  .warn-note { font-size:11px; color:#86868b; padding:0 16px 12px; margin:0; }
  .footer { background:#f5f5f7; border-radius:0 0 16px 16px; padding:20px 32px; text-align:center; }
  .footer p { font-size:11px; color:#86868b; margin:0; line-height:1.7; }
  .footer a { color:#0071e3; text-decoration:none; }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="header-logo">FS MISO · 월별 활동 보고서</div>
    <div class="header-title">${monthLabel} 활동 요약</div>
    <div class="header-sub">${managerName}님 · 발송일 ${today}</div>
  </div>

  <div class="body">
    <p class="greeting">
      안녕하세요, <strong>${managerName}</strong>님.<br>
      ${monthLabel} 한 달간의 영업 활동 보고서입니다.
    </p>

    <div class="stats">
      <div class="stat">
        <div class="stat-num">${totalVisits}</div>
        <div class="stat-label">총 방문 건수</div>
      </div>
      <div class="stat">
        <div class="stat-num">${totalAccounts}</div>
        <div class="stat-label">방문 거래처 수</div>
      </div>
      <div class="stat">
        <div class="stat-num">${constructionVisited.length}</div>
        <div class="stat-label">공사중 거래처</div>
      </div>
    </div>

    ${sectionConstruction}
    ${sectionNoVisit}
    ${sectionMajor}

    ${(!sectionConstruction && !sectionNoVisit && !sectionMajor) ? `
    <div style="text-align:center;padding:24px;color:#86868b;font-size:13px;">
      이달 특이 활동 내역이 없습니다.
    </div>` : ''}
  </div>

  <div class="footer">
    <p>
      본 메일은 FS MISO 시스템에서 자동 발송되었습니다.<br>
      상세 내용은 <a href="https://2raiwon67-boop.github.io/Maeil-FS-Sales/">FS MISO 대시보드</a>에서 확인하세요.
    </p>
  </div>
</div>
</body>
</html>`;
}
