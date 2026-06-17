'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function LicenseExportPage() {
  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6">
      <h1 className="mb-6 text-2xl font-bold">인허가 추출</h1>
      <Card>
        <CardHeader>
          <CardTitle>공공인허가 조회 & XLSX 다운로드</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-500">
            공공인허가 조회 및 엑셀 다운로드 기능이 이곳에 구현됩니다.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
