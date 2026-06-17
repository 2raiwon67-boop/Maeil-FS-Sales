'use client';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

export default function PendingPage() {
  const { metadata, signOut } = useAuth();

  return (
    <Card className="w-full max-w-md text-center shadow-lg">
      <CardHeader>
        <div className="mx-auto mb-4 text-6xl">⏳</div>
        <h1 className="text-2xl font-bold text-gray-800">승인 대기 중</h1>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-gray-600">
          <strong>{metadata?.full_name ?? '사용자'}</strong>님의 계정이 관리자
          승인을 기다리고 있습니다.
        </p>
        <p className="text-sm text-gray-500">
          승인이 완료되면 자동으로 서비스를 이용하실 수 있습니다.
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => window.location.reload()}
          >
            새로고침
          </Button>
          <Button variant="destructive" className="flex-1" onClick={signOut}>
            로그아웃
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
