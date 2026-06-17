'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function ProposalPage() {
  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6">
      <h1 className="mb-6 text-2xl font-bold">견적서</h1>
      <Card>
        <CardHeader>
          <CardTitle>매장 맞춤 분석</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-500">
            견적서 작성 및 매장 맞춤 분석 기능이 이곳에 구현됩니다.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
