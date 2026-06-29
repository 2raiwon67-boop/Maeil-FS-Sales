'use client';

// 방문 코칭 (StoreDetail 안에 삽입) — 최근 방문 이력(타임라인) + 방문 전 AI 코칭.
// 입력은 사내 ERP '활동노트'가 담당 → 여기선 읽기 전용(visit_logs는 엑셀 업로드로 채움).
// 코칭: /api/visit-coach (recipes RAG 근거).
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Sparkles, Loader2, NotebookPen, ChevronDown } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { VisitLog } from '@/types';

const OUTCOME_COLOR: Record<string, string> = { 성공: '#34C759', 보류: '#FF9500', 거절: '#FF3B30', 정상: '#34C759', 중지: '#FF9500', 폐업: '#8E8E93', 일반: '#8E8E93' };

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
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // 이 매장 최근 방문 이력 로드 (RLS가 business_unit 격리). 데이터는 활동노트 엑셀 업로드분.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('visit_logs').select('*')
        .eq('business_name', businessName)
        .order('visit_date', { ascending: false })
        .limit(10);
      if (!cancelled) { setRecent((data as VisitLog[]) || []); setCoaching(null); setExpanded(new Set()); }
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

  const toggle = (id: number) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="space-y-2.5">
      {/* ── 방문 이력 (타임라인) ── */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-1.5 border-b border-gray-100 px-3 py-2">
          <NotebookPen size={13} className="text-blue-600" />
          <span className="text-[12px] font-bold text-gray-700">방문 이력</span>
          {recent.length > 0 && (
            <span className="rounded-full bg-blue-50 px-1.5 py-px text-[10px] font-bold text-blue-600">{recent.length}</span>
          )}
        </div>

        {recent.length === 0 ? (
          <div className="px-3 py-5 text-center text-[11px] leading-relaxed text-gray-400">
            등록된 방문 이력이 없습니다.<br />활동노트 업로드 시 표시됩니다.
          </div>
        ) : (
          <ul className="max-h-[280px] space-y-3 overflow-y-auto px-3 py-3 [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:rounded [&::-webkit-scrollbar-thumb]:bg-gray-200">
            {recent.map((v, i) => {
              const vid = v.id ?? i;
              const content = (v.content || v.next_action || '').trim();
              const isLong = content.length > 90;
              const isOpen = expanded.has(vid);
              return (
                <li key={vid} className="relative pl-3.5">
                  {/* 타임라인 라인 + 점 */}
                  {i < recent.length - 1 && <span className="absolute left-[3px] top-3 bottom-[-12px] w-px bg-gray-100" />}
                  <span className="absolute left-0 top-[5px] h-[7px] w-[7px] rounded-full bg-blue-500 ring-2 ring-blue-100" />
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <span className="text-[11.5px] font-bold text-gray-800">{v.visit_date}</span>
                    {v.manager && <span className="text-[11px] text-gray-400">· {v.manager}</span>}
                    {v.outcome && (
                      <span className="rounded px-1.5 py-px text-[10px] font-bold text-white" style={{ background: OUTCOME_COLOR[v.outcome] || '#8E8E93' }}>
                        {v.outcome}{v.reject_reason ? `·${v.reject_reason}` : ''}
                      </span>
                    )}
                  </div>
                  {content && (
                    <>
                      <p className={`mt-1 whitespace-pre-wrap text-[12px] leading-[1.55] text-gray-600 ${isOpen || !isLong ? '' : 'line-clamp-3'}`}>
                        {content}
                      </p>
                      {isLong && (
                        <button onClick={() => toggle(vid)} className="mt-0.5 text-[11px] font-semibold text-blue-600 hover:text-blue-700">
                          {isOpen ? '접기' : '더보기'}
                        </button>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ── 방문 전 AI 코칭 ── */}
      <div className="rounded-xl border border-[#5856d6]/15 bg-[#5856d6]/[0.04] p-2.5">
        <button
          onClick={getCoaching}
          disabled={coachLoading}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#5856d6] py-2 text-[13px] font-bold text-white transition-opacity disabled:opacity-60"
        >
          {coachLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {coachLoading ? '코칭 생성 중…' : coaching ? '코칭 다시 받기' : '방문 전 코칭 받기'}
        </button>

        {coaching && (
          <div className="mt-2.5 space-y-2.5 text-[12px]">
            <div>
              <div className="mb-1 flex items-center gap-1 font-bold text-gray-700"><ChevronDown size={12} className="text-[#5856d6]" />다음 액션</div>
              <ul className="space-y-1">
                {coaching.actions?.map((a, i) => (
                  <li key={i} className="flex gap-1.5 leading-relaxed text-gray-800"><span className="text-[#5856d6]">▸</span>{a}</li>
                ))}
              </ul>
            </div>
            {coaching.products?.length > 0 && (
              <div>
                <div className="mb-1 font-bold text-gray-700">추천 제품/샘플</div>
                <div className="flex flex-col gap-1">
                  {coaching.products.map((p, i) => (
                    <div key={i} className="rounded-md bg-white px-2 py-1.5 ring-1 ring-gray-100">
                      <span className="font-semibold text-gray-900">{p.name}</span>
                      <span className="text-gray-500"> · {p.why}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {coaching.objection && (
              <div className="rounded-md bg-amber-50 px-2 py-1.5 ring-1 ring-amber-100">
                <div className="font-bold text-amber-700">예상 거절 <span className="font-normal text-gray-700">{coaching.objection.expected}</span></div>
                <div className="mt-0.5 leading-relaxed text-gray-700">↳ {coaching.objection.rebuttal}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
