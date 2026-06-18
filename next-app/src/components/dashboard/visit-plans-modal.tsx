'use client';

// 방문 일정 — 달력 + 일정 조회/삭제/불러오기 (visit_plans)
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';

export interface PlanItem {
  name: string;
  address?: string;
  lat: number;
  lng: number;
  type?: string;
}
interface Plan {
  visit_date: string;
  items: PlanItem[];
}

interface Props {
  onClose: () => void;
  businessUnit: string | null;
  myManagerName: string | null;
  onLoadToCart: (items: PlanItem[]) => void;
}

const MONTH_NAMES = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

export function VisitPlansModal({ onClose, businessUnit, myManagerName, onLoadToCart }: Props) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);

  // 마운트 시 1회 조회 (부모가 plansOpen일 때만 렌더하므로 열 때마다 새로 마운트됨)
  useEffect(() => {
    if (!myManagerName) return;
    let cancelled = false;
    const supabase = createClient();
    const today = todayStr();
    const twoMonths = new Date();
    twoMonths.setMonth(twoMonths.getMonth() + 2);
    (async () => {
      try {
        await supabase.from('visit_plans').delete().eq('business_unit', businessUnit).eq('manager', myManagerName).lt('visit_date', today);
      } catch { /* ignore */ }
      try {
        const { data } = await supabase
          .from('visit_plans')
          .select('visit_date, items')
          .eq('business_unit', businessUnit)
          .eq('manager', myManagerName)
          .gte('visit_date', today)
          .lte('visit_date', twoMonths.toISOString().split('T')[0])
          .order('visit_date', { ascending: true });
        if (!cancelled) setPlans((data as Plan[]) || []);
      } catch {
        if (!cancelled) setPlans([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [businessUnit, myManagerName]);

  const planDates = new Set(plans.map((p) => p.visit_date));
  const today = todayStr();

  const minY = now.getFullYear();
  const minM = now.getMonth();
  const maxDay = new Date(minY, minM + 2, 0);
  const canPrev = !(year === minY && month === minM);
  const canNext = !(year === maxDay.getFullYear() && month === maxDay.getMonth());

  const nav = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    setMonth(m);
    setYear(y);
    setSelectedDate(null);
  };

  const firstDay = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();
  const cells: React.ReactNode[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(<div key={`e${i}`} />);
  for (let d = 1; d <= lastDate; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isPast = dateStr < today;
    const isToday = dateStr === today;
    const isSelected = dateStr === selectedDate;
    const hasPlan = planDates.has(dateStr);
    const dow = (firstDay + d - 1) % 7;
    const numColor = isPast ? '#c7c7cc' : dow === 0 ? '#ff3b30' : dow === 6 ? '#5856d6' : '#1d1d1f';
    const circleBg = isSelected ? '#1d1d1f' : isToday ? '#5856d6' : 'transparent';
    cells.push(
      <div
        key={d}
        className="cursor-pointer py-0.5 text-center"
        onClick={() =>
          isPast
            ? toast.warning('이전 날짜는 계획 수립이 불가합니다')
            : setSelectedDate((s) => (s === dateStr ? null : dateStr))
        }
      >
        <div
          className="mx-auto flex h-[30px] w-[30px] items-center justify-center rounded-full text-[13px]"
          style={{ background: circleBg, color: isToday || isSelected ? 'white' : numColor, fontWeight: isToday || isSelected ? 700 : 400 }}
        >
          {d}
        </div>
        <div className="mt-px flex h-[5px] items-center justify-center">
          {hasPlan && <div className="h-[5px] w-[5px] rounded-full" style={{ background: isToday || isSelected ? 'white' : '#5856d6' }} />}
        </div>
      </div>,
    );
  }

  const selPlan = plans.find((p) => p.visit_date === selectedDate);

  const deletePlan = async (dateStr: string) => {
    const supabase = createClient();
    try {
      await supabase.from('visit_plans').delete().eq('business_unit', businessUnit).eq('manager', myManagerName).eq('visit_date', dateStr);
      setPlans((ps) => ps.filter((p) => p.visit_date !== dateStr));
      setSelectedDate(null);
      toast.success('일정이 삭제되었습니다');
    } catch {
      toast.error('일정 삭제에 실패했습니다');
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/55 sm:items-center" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-[480px] flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between px-5 pt-4">
          <div className="text-[17px] font-bold text-gray-900">📅 내 일정</div>
          <button onClick={onClose} className="text-2xl leading-none text-gray-400">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {!myManagerName ? (
            <div className="py-8 text-center text-sm text-gray-500">지점장 계정은 일정 기능을 사용할 수 없습니다.</div>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between">
                <button onClick={() => canPrev && nav(-1)} disabled={!canPrev} className="px-2.5 text-2xl text-[#5856d6] disabled:text-gray-300">‹</button>
                <div className="text-[15px] font-bold text-gray-900">{year}년 {MONTH_NAMES[month]}</div>
                <button onClick={() => canNext && nav(1)} disabled={!canNext} className="px-2.5 text-2xl text-[#5856d6] disabled:text-gray-300">›</button>
              </div>
              <div className="mb-1.5 grid grid-cols-7">
                {DAY_NAMES.map((n, i) => (
                  <div key={n} className="py-0.5 text-center text-[11px] font-semibold" style={{ color: i === 0 ? '#ff3b30' : i === 6 ? '#5856d6' : '#86868b' }}>
                    {n}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">{cells}</div>

              {selectedDate && (
                <div className="mt-4 border-t border-gray-200 pt-4">
                  {selPlan ? (
                    <>
                      <div className="mb-2.5 flex items-center justify-between">
                        <div className="text-sm font-bold text-gray-900">{selectedDate}</div>
                        <button onClick={() => deletePlan(selectedDate)} className="rounded-md border border-red-500 px-2.5 py-1 text-xs text-red-500">삭제</button>
                      </div>
                      <div className="mb-3 rounded-lg bg-gray-50 px-3 py-2.5">
                        {selPlan.items.map((it, i) => (
                          <div key={i} className="py-0.5 text-[13px] text-gray-700">• {it.name}</div>
                        ))}
                      </div>
                      <button
                        onClick={() => { onLoadToCart(selPlan.items); onClose(); }}
                        className="w-full rounded-xl bg-[#5856d6] py-2.5 text-sm font-semibold text-white"
                      >
                        경유지 불러오기 + 동선 최적화
                      </button>
                    </>
                  ) : (
                    <div className="text-center text-sm text-gray-500">저장된 일정이 없습니다.</div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
