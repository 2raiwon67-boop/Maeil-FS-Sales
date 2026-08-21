'use client';

import { useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { ShieldCheck, RefreshCw, Check, X, ArrowRightLeft, Trash2, Clock, Users, MapPin, Crown } from 'lucide-react';
import { PageHeader, headerBtn } from '@/components/layout/page-header';
import { BUSINESS_UNITS } from '@/types';

interface UserRecord {
  id: string;
  email: string;
  full_name?: string;
  business_unit?: string;
  approved?: boolean;
  is_admin?: boolean;
  created_at: string;
}

type Tab = 'pending' | 'all';

export default function AdminPage() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [adminCode, setAdminCode] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [tab, setTab] = useState<Tab>('pending');
  const [busy, setBusy] = useState<string | null>(null);
  // 승인/변경 시 선택한 소속 (userId -> business_unit)
  const [buChoice, setBuChoice] = useState<Record<string, string>>({});

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin-users', {
        headers: { 'X-Admin-Code': adminCode },
      });
      if (!res.ok) throw new Error('인증 실패 — 관리자 코드를 확인해주세요.');
      const data = await res.json();
      setUsers(data.users || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '오류 발생');
      setAuthenticated(false);
    }
    setLoading(false);
  }, [adminCode]);

  const handleAuth = () => {
    if (!adminCode) {
      toast.error('관리자 코드를 입력해주세요.');
      return;
    }
    setAuthenticated(true);
    loadUsers();
  };

  const callAction = async (
    action: 'approve' | 'transfer' | 'reject' | 'delete' | 'set_admin',
    user: UserRecord,
    businessUnit?: string,
    isAdmin?: boolean,
  ) => {
    setBusy(user.id);
    try {
      const res = await fetch('/api/admin-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Code': adminCode },
        body: JSON.stringify({ action, userId: user.id, businessUnit, isAdmin }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || '처리 실패');
      }
      const msg: Record<typeof action, string> = {
        approve: '승인 완료',
        transfer: '소속이 변경되었습니다',
        reject: '거절 및 계정 삭제 완료',
        delete: '계정이 삭제되었습니다',
        set_admin: isAdmin ? '관리자로 지정했습니다 — 재로그인 후 전 지점 열람이 열립니다' : '관리자 지정을 해제했습니다',
      };
      toast.success(msg[action]);
      await loadUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '오류 발생');
    }
    setBusy(null);
  };

  const handleApprove = (user: UserRecord) => {
    const bu = buChoice[user.id] || user.business_unit || BUSINESS_UNITS[0];
    callAction('approve', user, bu);
  };
  const handleTransfer = (user: UserRecord) => {
    const bu = buChoice[user.id] || user.business_unit;
    if (!bu) {
      toast.error('변경할 소속을 선택해주세요.');
      return;
    }
    if (bu === user.business_unit) {
      toast.message('현재 소속과 동일합니다.');
      return;
    }
    callAction('transfer', user, bu);
  };
  const handleReject = (user: UserRecord) => {
    if (!confirm(`'${user.full_name || user.email}' 계정을 거절하고 삭제하시겠습니까?`)) return;
    callAction('reject', user);
  };
  const handleDelete = (user: UserRecord) => {
    if (!confirm(`'${user.full_name || user.email}' 계정을 삭제하시겠습니까?\n\n퇴사 처리 시 해당 계정으로 더 이상 로그인할 수 없습니다.`)) return;
    callAction('delete', user);
  };
  const handleToggleAdmin = (user: UserRecord) => {
    const next = !user.is_admin;
    const q = next
      ? `'${user.full_name || user.email}' 계정을 관리자로 지정하시겠습니까?\n\n지점 소속은 유지되고, 네비에서 다른 지점을 골라 '조회'할 수 있게 됩니다 (다른 지점 수정은 불가).`
      : `'${user.full_name || user.email}' 계정의 관리자 지정을 해제하시겠습니까?`;
    if (!confirm(q)) return;
    callAction('set_admin', user, undefined, next);
  };

  if (!authenticated) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-6 py-16">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#eef3fb] text-[#1B3F82]">
          <ShieldCheck className="h-7 w-7" />
        </div>
        <h1 className="text-lg font-semibold text-[#0f172a]">관리자 인증</h1>
        <p className="mb-5 mt-1 text-sm text-[#94a3b8]">관리자 코드를 입력해 주세요.</p>
        <div className="w-full space-y-3">
          <input
            type="password"
            placeholder="관리자 코드 입력"
            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-600"
            value={adminCode}
            onChange={(e) => setAdminCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
          />
          <button
            onClick={handleAuth}
            className="w-full rounded-lg bg-[#2563eb] py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#1d4fd0]"
          >
            확인
          </button>
        </div>
      </div>
    );
  }

  const pending = users.filter((u) => u.approved === false);
  const shown = tab === 'pending' ? pending : users;

  return (
    <div>
      <PageHeader
        title="관리자"
        subtitle="가입 신청 승인 및 전체 사용자 현황 관리"
        actions={
          <>
            <a href="/geocode-tool" className={headerBtn.outline}>
              <MapPin className="h-3.5 w-3.5" />좌표 보정 도구
            </a>
            <button onClick={loadUsers} disabled={loading} className={headerBtn.outline}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />새로고침
            </button>
          </>
        }
      />
      <div className="mx-auto max-w-5xl px-4 py-5 md:px-6">

      <div className="mb-4 flex gap-1 rounded-xl bg-gray-100 p-1">
        {(['pending', 'all'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition-colors ${
              tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
            }`}
          >
            {t === 'pending'
              ? <><Clock className="h-3.5 w-3.5" />승인 대기 ({pending.length})</>
              : <><Users className="h-3.5 w-3.5" />전체 ({users.length})</>}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-gray-500">로딩 중...</p>
      ) : shown.length === 0 ? (
        <p className="py-10 text-center text-gray-400">
          {tab === 'pending' ? '승인 대기 중인 사용자가 없습니다.' : '등록된 사용자가 없습니다.'}
        </p>
      ) : (
        <div className="space-y-3">
          {shown.map((user) => {
            const isPending = user.approved === false;
            return (
              <Card key={user.id}>
                <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{user.full_name ?? '(이름 없음)'}</p>
                      {isPending ? (
                        <Badge className="bg-amber-100 text-amber-800">승인 대기</Badge>
                      ) : (
                        <Badge className="bg-green-100 text-green-800">승인됨</Badge>
                      )}
                      {user.is_admin && (
                        <Badge className="bg-indigo-100 text-indigo-800"><Crown className="mr-0.5 h-3 w-3" />관리자</Badge>
                      )}
                    </div>
                    <p className="truncate text-sm text-gray-500">{user.email}</p>
                    <p className="text-xs text-gray-400">
                      {user.business_unit || '소속 미지정'} ·{' '}
                      {new Date(user.created_at).toLocaleDateString('ko-KR')}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={buChoice[user.id] ?? user.business_unit ?? BUSINESS_UNITS[0]}
                      onChange={(e) => setBuChoice((c) => ({ ...c, [user.id]: e.target.value }))}
                      className="rounded-lg border border-gray-300 px-2 py-1.5 text-[13px] outline-none"
                    >
                      {BUSINESS_UNITS.map((bu) => (
                        <option key={bu} value={bu}>
                          {bu}
                        </option>
                      ))}
                    </select>

                    {isPending ? (
                      <>
                        <Button size="sm" disabled={busy === user.id} onClick={() => handleApprove(user)}>
                          <Check className="h-3.5 w-3.5" />승인
                        </Button>
                        <Button size="sm" variant="destructive" disabled={busy === user.id} onClick={() => handleReject(user)}>
                          <X className="h-3.5 w-3.5" />거절
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" variant="outline" disabled={busy === user.id} onClick={() => handleTransfer(user)}>
                          <ArrowRightLeft className="h-3.5 w-3.5" />소속 변경
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy === user.id} onClick={() => handleToggleAdmin(user)}>
                          <Crown className="h-3.5 w-3.5" />{user.is_admin ? '관리자 해제' : '관리자 지정'}
                        </Button>
                        <Button size="sm" variant="destructive" disabled={busy === user.id} onClick={() => handleDelete(user)}>
                          <Trash2 className="h-3.5 w-3.5" />삭제
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}
