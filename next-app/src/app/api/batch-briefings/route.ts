import { NextResponse } from 'next/server';

// TODO: 기존 api/batch-briefings.js 로직 마이그레이션
// Gemini 야간 배치 + Mother Brain 임베딩

export async function GET() {
  return NextResponse.json({ message: 'Not yet implemented' }, { status: 501 });
}
