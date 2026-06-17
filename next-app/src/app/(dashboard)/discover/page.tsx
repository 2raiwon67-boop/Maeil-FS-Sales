'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function DiscoverPage() {
  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6">
      <h1 className="mb-6 text-2xl font-bold">시장 분석</h1>
      <Card>
        <CardHeader>
          <CardTitle>상권 인텔리전스</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-500">
            MapLibre GL 기반 상권 분석 지도가 이곳에 구현됩니다.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
