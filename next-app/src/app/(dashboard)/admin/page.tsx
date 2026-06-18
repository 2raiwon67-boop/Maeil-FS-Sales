'use client';

import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { BUSINESS_UNITS } from '@/types';

interface UserRecord {
  id: string;
  email: string;
  full_name?: string;
  business_unit?: string;
  approved?: boolean;
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
    action: 'approve' | 'transfer' | 'reject' | 'delete',
    user: UserRecord,
    businessUnit?: string,
  ) => {
    setBusy(user.id);
    try {
      const res = await fetch('/api/admin-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Code': adminCode },
        body: JSON.stringify({ action, userId: user.id, businessUnit }),
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

  if (!authenticated) {
    return (
      <div className="mx-auto max-w-md p-6">
        <Card>
          <CardHeader>
            <CardTitle>관리자 인증</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <input
              type="password"
              placeholder="관리자 코드 입력"
              className="w-full rounded-md border px-3 py-2"
              value={adminCode}
              onChange={(e) => setAdminCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
            />
            <Button onClick={handleAuth} className="w-full">
              확인
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const pending = users.filter((u) => u.approved === false);
  const shown = tab === 'pending' ? pending : users;

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <h1 className="mb-1 text-2xl font-bold">관리자 페이지</h1>
      <p className="mb-5 text-sm text-gray-500">가입 신청 승인 및 전체 사용자 현황을 관리합니다.</p>

      <div className="mb-4 flex gap-1 rounded-xl bg-gray-100 p-1">
        {(['pending', 'all'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
              tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
            }`}
          >
            {t === 'pending' ? `승인 대기 (${pending.length})` : `전체 (${users.length})`}
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
                          승인
                        </Button>
                        <Button size="sm" variant="destructive" disabled={busy === user.id} onClick={() => handleReject(user)}>
                          거절
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" variant="outline" disabled={busy === user.id} onClick={() => handleTransfer(user)}>
                          소속 변경
                        </Button>
                        <Button size="sm" variant="destructive" disabled={busy === user.id} onClick={() => handleDelete(user)}>
                          삭제
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
  );
}
