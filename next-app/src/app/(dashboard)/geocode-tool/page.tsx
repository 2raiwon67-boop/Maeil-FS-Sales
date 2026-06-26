'use client';

// 시장데이터 좌표 결측 보정 — 일회성 관리자 도구(네비 미노출, URL 직접 접근).
// 네이버 주소 지오코더(클라이언트, 도메인 화이트리스트 키)로 도로명주소→좌표를 채운다.
// 라이브 도메인에서 실행해야 지오코더 키가 동작. 결측 조회/저장은 /api/admin-geocode(admin 코드).
import { useState } from 'react';
import { loadNaverMaps, cachedGeocode } from '@/lib/naver/loader';

type Phase = 'idle' | 'fetching' | 'running' | 'done' | 'error';

export default function GeocodeToolPage() {
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [ok, setOk] = useState(0);
  const [fail, setFail] = useState(0);
  const [msg, setMsg] = useState('');

  async function run() {
    if (!code.trim()) { setMsg('관리자 코드를 입력하세요.'); return; }
    setPhase('fetching'); setMsg('네이버 지도 SDK 로딩…'); setDone(0); setOk(0); setFail(0); setTotal(0);
    try {
      await loadNaverMaps();
    } catch {
      setPhase('error'); setMsg('네이버 SDK 로드 실패. 라이브 도메인에서 실행 중인지 확인하세요.'); return;
    }

    // Phase 1: 결측 행 전부 수집(쓰기 전에 읽어 offset 안정)
    const headers = { 'x-admin-code': code.trim() };
    const rows: { id: number; address: string }[] = [];
    setMsg('결측 목록 조회 중…');
    for (let offset = 0; ; offset += 1000) {
      const r = await fetch(`/api/admin-geocode?offset=${offset}`, { headers });
      if (r.status === 403) { setPhase('error'); setMsg('관리자 인증 실패 — 코드를 확인하세요.'); return; }
      const j = await r.json();
      const batch: { id: number; address: string }[] = j.rows || [];
      rows.push(...batch);
      if (batch.length < 1000) break;
    }
    setTotal(rows.length);
    if (rows.length === 0) { setPhase('done'); setMsg('결측 좌표가 없습니다. 이미 모두 채워졌습니다.'); return; }

    // Phase 2: 지오코딩 + 100건마다 저장
    setPhase('running'); setMsg('지오코딩 진행 중…');
    let buf: { id: number; lat: number; lng: number }[] = [];
    let okN = 0, failN = 0;
    const flush = async () => {
      if (!buf.length) return;
      const r = await fetch('/api/admin-geocode', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ updates: buf }) });
      const j = await r.json().catch(() => ({ saved: 0 }));
      okN += j.saved || 0;
      setOk(okN);
      buf = [];
    };
    // 도로명+번지까지만 사용(쉼표 이후 동/호/괄호는 지오코더 매칭률 저하) → 첫 쉼표 앞만
    const cleanAddr = (a: string) => (a || '').split(',')[0].replace(/\s+/g, ' ').trim();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const c = await cachedGeocode(cleanAddr(row.address));
      if (c && Number.isFinite(c.lat) && Number.isFinite(c.lng)) buf.push({ id: row.id, lat: c.lat, lng: c.lng });
      else { failN++; setFail(failN); }
      setDone(i + 1);
      if (buf.length >= 100) await flush();
      await new Promise((s) => setTimeout(s, 110)); // 지오코더 호출 스로틀
    }
    await flush();
    setPhase('done');
    setMsg(`완료 — 저장 ${okN} / 실패(무매칭) ${failN} / 총 ${rows.length}`);
  }

  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <div className="mx-auto max-w-xl px-6 py-12">
      <h1 className="text-xl font-bold text-gray-900">시장데이터 좌표 보정 도구</h1>
      <p className="mt-2 text-sm text-gray-500">
        도로명주소가 있는 좌표 결측 행을 네이버 주소 지오코더로 채웁니다. <b>라이브 도메인</b>에서 실행하세요.
        탭을 열어둔 채 수 분 소요됩니다.
      </p>

      <div className="mt-6 space-y-3 rounded-xl border border-gray-200 bg-white p-5">
        <label className="block text-sm font-semibold text-gray-700">관리자 코드</label>
        <input
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={phase === 'fetching' || phase === 'running'}
          placeholder="ADMIN_CODE"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
        />
        <button
          onClick={run}
          disabled={phase === 'fetching' || phase === 'running'}
          className="w-full rounded-lg bg-[#2563eb] py-2.5 text-sm font-bold text-white disabled:opacity-50"
        >
          {phase === 'fetching' ? '준비 중…' : phase === 'running' ? '진행 중…' : '좌표 채우기 시작'}
        </button>

        {total > 0 && (
          <div className="pt-2">
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
              <div className="h-full rounded-full bg-[#2563eb] transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-2 flex justify-between text-xs text-gray-600">
              <span>{done.toLocaleString()} / {total.toLocaleString()} ({pct}%)</span>
              <span className="text-green-600">저장 {ok.toLocaleString()}</span>
              <span className="text-gray-400">무매칭 {fail.toLocaleString()}</span>
            </div>
          </div>
        )}
        {msg && <p className={`text-sm ${phase === 'error' ? 'text-red-600' : 'text-gray-600'}`}>{msg}</p>}
      </div>
    </div>
  );
}
