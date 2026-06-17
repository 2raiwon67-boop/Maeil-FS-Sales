'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

interface UserRecord {
  id: string;
  email: string;
  full_name?: string;
  business_unit?: string;
  approved?: boolean;
  created_at: string;
}

export default function AdminPage() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [adminCode, setAdminCode] = useState('');
  const [authenticated, setAuthenticated] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin-users', {
        headers: { 'X-Admin-Code': adminCode },
      });
      if (!res.ok) throw new Error('인증 실패');
      const data = await res.json();
      setUsers(data.users || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '오류 발생');
    }
    setLoading(false);
  }, [adminCode]);

  const handleAuth = async () => {
    if (!adminCode) {
      toast.error('관리자 코드를 입력해주세요.');
      return;
    }
    setAuthenticated(true);
    loadUsers();
  };

  const handleApprove = async (userId: string, approve: boolean) => {
    try {
      const res = await fetch('/api/admin-users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Code': adminCode,
        },
        body: JSON.stringify({ action: approve ? 'approve' : 'reject', userId }),
      });
      if (!res.ok) throw new Error('처리 실패');
      toast.success(approve ? '승인 완료' : '거절 완료');
      loadUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '오류 발생');
    }
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

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <h1 className="mb-6 text-2xl font-bold">관리자 페이지</h1>

      {loading ? (
        <p className="text-gray-500">로딩 중...</p>
      ) : (
        <div className="space-y-3">
          {users.map((user) => (
            <Card key={user.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium">{user.full_name ?? '(이름 없음)'}</p>
                  <p className="text-sm text-gray-500">{user.email}</p>
                  <p className="text-xs text-gray-400">
                    {user.business_unit} ·{' '}
                    {new Date(user.created_at).toLocaleDateString('ko-KR')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {user.approved === false ? (
                    <>
                      <Button
                        size="sm"
                        onClick={() => handleApprove(user.id, true)}
                      >
                        승인
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleApprove(user.id, false)}
                      >
                        거절
                      </Button>
                    </>
                  ) : (
                    <Badge className="bg-green-100 text-green-800">
                      승인됨
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
