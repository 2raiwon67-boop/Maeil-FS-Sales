import { NextRequest, NextResponse } from 'next/server';

// TODO: 기존 api/naver-reviews.js 로직 마이그레이션
// Gemini API를 사용한 네이버 리뷰 분석

export async function POST(req: NextRequest) {
  const body = await req.json();
  // 기존 로직 이식 예정
  return NextResponse.json({ message: 'Not yet implemented', body }, { status: 501 });
}
