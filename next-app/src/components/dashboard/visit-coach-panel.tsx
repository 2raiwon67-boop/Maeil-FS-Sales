'use client';

// 방문 코칭 (StoreDetail 안에 삽입) — 방문 전 액션 코칭 + 최근 방문 이력 조회.
// 입력은 사내 ERP '활동노트'가 담당 → 여기선 읽기 전용(visit_logs는 엑셀 업로드로 채움).
// 코칭: /api/visit-coach (recipes RAG 근거).
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Sparkles, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { VisitLog } from '@/types';

const OUTCOME_COLOR: Record<string, string> = { 성공: '#34C759', 보류: '#FF9500', 거절: '#FF3B30', 일반: '#8E8E93' };

interface Coaching {
  actions: string[];
  products: { name: string; why: string }[];
  objection: { expected: string; rebuttal: string };
}

interface Props {
  businessName: string;
  businessType?: string;
  tradeStatus?: string;
  businessUnit: string | null;
}

export function VisitCoachPanel({ businessName, businessType, tradeStatus, businessUnit }: Props) {
  const [recent, setRecent] = useState<VisitLog[]>([]);
  const [coaching, setCoaching] = useState<Coaching | null>(null);
  const [coachLoading, setCoachLoading] = useState(false);

  // 이 매장 최근 방문 이력 로드 (RLS가 business_unit 격리). 데이터는 활동노트 엑셀 업로드분.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('visit_logs').select('*')
        .eq('business_name', businessName)
        .order('visit_date', { ascending: false })
        .limit(5);
      if (!cancelled) setRecent((data as VisitLog[]) || []);
    })();
    return () => { cancelled = true; };
  }, [businessName, businessUnit]);

  async function getCoaching() {
    setCoachLoading(true);
    try {
      const res = await fetch('/api/visit-coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName, businessType, tradeStatus,
          recentVisits: recent.map((v) => ({ visit_date: v.visit_date, outcome: v.outcome, reject_reason: v.reject_reason, content: v.content })),
        }),
      });
      const j = await res.json();
      if (j.coaching) setCoaching(j.coaching);
      else toast.error(j.error || '코칭 생성 실패');
    } catch {
      toast.error('코칭 요청 실패');
    } finally {
      setCoachLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-2.5">
      <button
        onClick={getCoaching}
        disabled={coachLoading}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#5856d6] py-2 text-[13px] font-bold text-white disabled:opacity-60"
      >
        {coachLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
        {coachLoading ? '코칭 생성 중…' : '방문 전 코칭 받기'}
      </button>

      {coaching && (
        <div className="mt-2 space-y-2 text-[12px]">
          <div>
            <div className="mb-1 font-bold text-gray-700">다음 액션</div>
            <ul className="space-y-1">
              {coaching.actions?.map((a, i) => (
                <li key={i} className="flex gap-1.5 text-gray-800"><span className="text-blue-600">▸</span>{a}</li>
              ))}
            </ul>
          </div>
          {coaching.products?.length > 0 && (
            <div>
              <div className="mb-1 font-bold text-gray-700">추천 제품/샘플</div>
              <div className="flex flex-col gap-1">
                {coaching.products.map((p, i) => (
                  <div key={i} className="rounded-md bg-white px-2 py-1 ring-1 ring-gray-100">
                    <span className="font-semibold text-gray-900">{p.name}</span>
                    <span className="text-gray-500"> · {p.why}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {coaching.objection && (
            <div className="rounded-md bg-amber-50 px-2 py-1.5 ring-1 ring-amber-100">
              <div className="font-bold text-amber-700">예상 거절: <span className="font-normal text-gray-700">{coaching.objection.expected}</span></div>
              <div className="mt-0.5 text-gray-700">↳ {coaching.objection.rebuttal}</div>
            </div>
          )}
        </div>
      )}

      {/* 최근 방문 이력 (활동노트 업로드분) */}
      {recent.length > 0 && (
        <div className="mt-2.5">
          <div className="mb-1 text-[11px] font-semibold text-gray-500">최근 방문</div>
          <div className="space-y-1">
            {recent.slice(0, 3).map((v) => (
              <div key={v.id} className="flex items-center gap-1.5 text-[11px]">
                <span className="text-gray-400">{v.visit_date}</span>
                {v.outcome && (
                  <span className="rounded px-1.5 py-px font-bold text-white" style={{ background: OUTCOME_COLOR[v.outcome] || '#8E8E93' }}>
                    {v.outcome}{v.reject_reason ? `·${v.reject_reason}` : ''}
                  </span>
                )}
                <span className="truncate text-gray-600">{v.next_action || v.content || ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
