'use client';
import { useState } from 'react';
import { readPerformanceSamples } from '@/lib/performance-diagnostics';

export function PerformanceDiagnosticsPanel() {
  const [samples, setSamples] = useState(() => readPerformanceSamples());
  const ms = (n: number | null) => n === null ? '미측정' : `${(n / 1000).toFixed(2)}초`;
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(samples, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'miso-performance.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <details className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-600">
    <summary className="cursor-pointer font-medium">앱 속도 진단 · 이 기기 최근 {samples.length}회</summary>
    <p className="mt-2 leading-5">화면 진입 후 최대 60초를 기록합니다. 화면 이동·앱 숨김 시에도 저장됩니다. 지도 준비는 SDK 로드 시점이며 모든 마커 완료나 FPS를 뜻하지 않습니다. iPhone에서 긴 작업 측정을 지원하지 않으면 미측정으로 표시합니다.</p>
    <div className="my-2 flex gap-4"><button className="text-blue-600" onClick={() => setSamples(readPerformanceSamples())}>새로고침</button><button disabled={!samples.length} className="text-blue-600 disabled:text-slate-400" onClick={download}>진단 내려받기</button></div>
    <div className="max-h-48 overflow-y-auto">{samples.slice(-5).reverse().map((s, i) => <div key={`${s.at}-${i}`} className="border-t border-slate-100 py-2 leading-5">
      <b>{s.route === '/' ? '거래처' : s.route === '/discover' ? '시장분석' : s.route} · {s.platform} {s.pwa ? 'PWA' : '브라우저'}</b><br />
      {new Date(s.at).toLocaleString('ko-KR')}<br />지도 준비 {ms(s.mapReadyMs)} · 데이터 준비 {ms(s.dataReadyMs)}<br />긴 작업 {s.longTasks === null ? '미지원' : `${s.longTasks}회`} · 차단시간 {ms(s.blockingMs)} · 오류 {s.errors}회
    </div>)}</div>
    <p className="mt-2 text-slate-400">최근 30회는 이 기기에, 요약은 운영 로그에 기록합니다. 상호·검색어·오류 내용·사용자 식별자는 포함하지 않습니다.</p>
  </details>;
}
