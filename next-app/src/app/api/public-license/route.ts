import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

const API_KEY = process.env.PUBLIC_DATA_API_KEY!;
const BASE_URL = 'https://www.localdata.go.kr/platform/rest/TO0/openDataApi';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const authNo = searchParams.get('authNo') || '';
  const bsnNm = searchParams.get('bsnNm') || '';
  const pageIndex = searchParams.get('pageIndex') || '1';
  const pageSize = searchParams.get('pageSize') || '20';

  if (!authNo && !bsnNm) {
    return NextResponse.json({ error: '검색 조건이 필요합니다.' }, { status: 400 });
  }

  const params = new URLSearchParams({
    authKey: API_KEY,
    resultType: 'json',
    pageIndex,
    pageSize,
    ...(authNo ? { authNo } : {}),
    ...(bsnNm ? { bsnNm } : {}),
  });

  try {
    const response = await fetch(`${BASE_URL}?${params}`, {
      headers: { Accept: 'application/json' },
    });
    const data = await response.json();
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
