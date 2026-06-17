'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function UploadPage() {
  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6">
      <h1 className="mb-6 text-2xl font-bold">데이터 관리</h1>
      <Card>
        <CardHeader>
          <CardTitle>업로드 & DB 현황</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-500">
            데이터 업로드, DB 현황, 공공인허가 조회 기능이 이곳에 구현됩니다.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
